import { validateConfig, SwitchBotConfig } from './config';
import { CredentialService, MqttCredential } from './credential';
import { createMqttTlsClient } from './mqtt-client';
import { validateDeviceEvent } from './message-handler';
import { getDeviceStore, destroyDeviceStore } from './device-store';
import { SwitchBotDeviceEvent } from './types';

/**
 * 从多种配置结构中提取 SwitchBot 配置
 */
function extractSwitchBotConfig(config: any, globalConfig?: any): any {
  // 优先级顺序：
  // 1. globalConfig.channels.switchbot
  // 2. config.channels.switchbot
  // 3. config (直接配置)

  if (globalConfig?.channels?.switchbot) {
    console.log('[SwitchBot Channel] 从全局配置 channels.switchbot 读取配置');
    return globalConfig.channels.switchbot;
  }

  if (config?.channels?.switchbot) {
    console.log('[SwitchBot Channel] 从配置 channels.switchbot 读取配置');
    return config.channels.switchbot;
  }

  if (config?.token && config?.secret) {
    console.log('[SwitchBot Channel] 从直接配置读取');
    return config;
  }

  // 最后尝试：可能配置在其他地方
  if (typeof globalThis !== 'undefined' && (globalThis as any).openclaw?.config?.channels?.switchbot) {
    console.log('[SwitchBot Channel] 从全局 openclaw.config.channels.switchbot 读取配置');
    return (globalThis as any).openclaw.config.channels.switchbot;
  }

  console.log('[SwitchBot Channel] 使用默认配置结构，配置对象:', config);
  return config;
}

// 模块级单例：防止 OpenClaw auto-restart 创建多个 MQTT 连接
let activeInstance: SwitchBotChannel | null = null;

/**
 * SwitchBot Channel Plugin for OpenClaw
 * 通过 AWS IoT Core MQTT 实时接收 SwitchBot 设备状态变化
 */
class SwitchBotChannel {
  private credentialService: CredentialService | null = null;
  private mqttClient: any = null;
  private config: SwitchBotConfig;
  private isStarted = false;

  constructor(config: any, globalConfig?: any) {
    const channelConfig = extractSwitchBotConfig(config, globalConfig);
    this.config = validateConfig(channelConfig);
  }

  /**
   * 启动渠道连接
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    // 单例保护：如果已有活跃实例，先停掉它
    if (activeInstance && activeInstance !== this) {
      console.log('[SwitchBot Channel] 检测到已有活跃实例，先停止旧实例...');
      await activeInstance.stop();
    }
    activeInstance = this;

    try {
      console.log('[SwitchBot Channel] 开始启动...');

      // 初始化凭证服务 - 使用定时续期而非基于expiration的续期
      this.credentialService = new CredentialService(
        this.config.token,
        this.config.secret,
        this.config.credentialEndpoint || 'https://oqwck99em8.execute-api.us-east-1.amazonaws.com/open/v1.1/iot/credential',
        'openclaw-instance',
        this.config.renewBeforeMs || 3600000, // 默认1小时续期一次
        this.onCredentialsRenewed.bind(this)
      );

      // 获取初始凭证
      const credentials = await this.credentialService.fetch();
      console.log('[SwitchBot Channel] MQTT凭证获取成功:', {
        brokerUrl: credentials.brokerUrl,
        region: credentials.region,
        clientId: credentials.clientId,
        statusTopic: credentials.topics.status,
        qos: credentials.qos
      });

      // 创建并启动 MQTT TLS 客户端
      await this.connectMQTT(credentials);

      this.isStarted = true;
      console.log('[SwitchBot Channel] 启动成功');
    } catch (error) {
      console.error('[SwitchBot Channel] 启动失败:', error);
      throw error;
    }
  }

  /**
   * 停止渠道连接
   */
  async stop(): Promise<void> {
    try {
      console.log('[SwitchBot Channel] 开始停止...');

      if (this.mqttClient) {
        await this.mqttClient.disconnect();
        this.mqttClient = null;
      }

      if (this.credentialService) {
        this.credentialService.destroy();
        this.credentialService = null;
      }

      destroyDeviceStore();

      this.isStarted = false;
      if (activeInstance === this) activeInstance = null;
      console.log('[SwitchBot Channel] 停止完成');
    } catch (error) {
      console.error('[SwitchBot Channel] 停止失败:', error);
    }
  }

  /**
   * 连接 MQTT TLS 客户端（单例：先销毁旧客户端再创建新的）
   */
  private async connectMQTT(credentials: MqttCredential): Promise<void> {
    try {
      // 先彻底销毁旧客户端，防止 clientId 冲突
      if (this.mqttClient) {
        console.log('[SwitchBot Channel] 销毁旧 MQTT 客户端...');
        try { await this.mqttClient.disconnect(); } catch (_) {}
        this.mqttClient = null;
        // 等待 TCP 完全释放
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // 创建新的 MQTT TLS 客户端管理器
      this.mqttClient = createMqttTlsClient(
        credentials,
        {
          debug: (msg) => console.debug(`[SwitchBot Channel] ${msg}`),
          info: (msg) => console.log(`[SwitchBot Channel] ${msg}`),
          warn: (msg) => console.warn(`[SwitchBot Channel] ${msg}`),
          error: (msg) => console.error(`[SwitchBot Channel] ${msg}`),
        }
      );

      // 订阅SwitchBot设备状态消息
      this.mqttClient.subscribe(credentials.topics.status, (topic: string, payload: Buffer) => {
        this.handleDeviceMessage(topic, payload);
      });

      // 连接到MQTT broker
      await this.mqttClient.connect();
      console.log('[SwitchBot Channel] MQTT TLS 连接成功');
    } catch (error) {
      console.error('[SwitchBot Channel] MQTT TLS 连接失败:', error);
      throw error;
    }
  }

  /**
   * 处理凭证续期
   */
  private async onCredentialsRenewed(newCredentials: MqttCredential): Promise<void> {
    console.log('[SwitchBot Channel] 凭证已续期，重新连接 MQTT TLS');

    if (this.mqttClient) {
      // 使用新的updateCredentials方法
      if (this.mqttClient.updateCredentials) {
        await this.mqttClient.updateCredentials(newCredentials);
      } else {
        // 回退到重新连接
        await this.mqttClient.disconnect();
        await this.connectMQTT(newCredentials);
      }
    }
  }

  /**
   * 处理设备消息 — 存储到本地，不推送
   */
  private handleDeviceMessage(topic: string, payload: Buffer): void {
    try {
      const message = payload.toString();
      console.log('[SwitchBot Channel] 收到设备消息:', { topic, message });

      const eventData = JSON.parse(message);
      const deviceEvent = validateDeviceEvent(eventData);

      // 存储到本地
      const store = getDeviceStore();
      store.record({
        deviceMac: deviceEvent.context.deviceMac,
        deviceType: deviceEvent.context.deviceType,
        timestamp: deviceEvent.context.timeOfSample || Date.now(),
        context: deviceEvent.context,
      });

      console.log(`[SwitchBot Channel] 设备状态已存储: ${deviceEvent.context.deviceType} (${deviceEvent.context.deviceMac})`);
    } catch (error) {
      console.error('[SwitchBot Channel] 处理设备消息失败:', error);
    }
  }

  /**
   * 获取渠道状态
   */
  getStatus(): any {
    return {
      started: this.isStarted,
      mqttConnected: this.mqttClient?.isConnected() || false,
      credentialsValid: !!this.credentialService?.getCurrent(),
      config: {
        endpoint: this.config.credentialEndpoint,
      }
    };
  }

  /**
   * 健康检查
   */
  healthCheck(): boolean {
    return this.isStarted && (this.mqttClient?.isConnected() || false);
  }
}

// 创建插件实例的工厂函数
function create(config: any, context?: any): SwitchBotChannel {
  // 传递上下文给构造函数，这样可以访问全局配置
  return new SwitchBotChannel(config, context?.globalConfig || context);
}

// 按照OpenClaw channel插件标准导出
export const switchbotPlugin = {
  id: "switchbot",
  meta: {
    id: "switchbot",
    label: "SwitchBot",
    selectionLabel: "SwitchBot (Smart Home)",
    docsPath: "/channels/switchbot",
    docsLabel: "switchbot",
    blurb: "Real-time SwitchBot device status via AWS IoT Core MQTT",
    aliases: ["switchbot"],
  },
  capabilities: {
    chatTypes: [],  // SwitchBot是IoT设备通道，不支持聊天
    media: false,   // SwitchBot不支持媒体文件
    features: {
      inbound: true,   // 接收SwitchBot设备消息
      outbound: false, // 不支持主动发送
      threading: false,
      reactions: false,
      editing: false,
      deletion: false,
    }
  },
  config: {
    // 账户管理
    // 注意：cfg 参数是完整的 openclaw 配置对象，channel 配置在 cfg.channels.switchbot 下
    listAccountIds: (cfg: any) => {
      const config = cfg?.channels?.switchbot;
      return config?.token ? ['default'] : [];
    },
    resolveAccount: (cfg: any, accountId?: string) => {
      const config = cfg?.channels?.switchbot;
      if (accountId === 'default' && config?.token) {
        return { id: 'default', label: 'SwitchBot Account', configured: true };
      }
      return null;
    },
    defaultAccountId: (cfg: any) => {
      const config = cfg?.channels?.switchbot;
      return config?.token ? 'default' : null;
    },
    isConfigured: (account: any) => {
      // 收到的是 resolveAccount 返回的账户对象
      return !!(account?.configured);
    },
    describeAccount: (account: any, cfg: any) => {
      if (account?.id === 'default') {
        return {
          accountId: 'default',
          id: 'default',
          label: 'SwitchBot IoT devices',
          configured: true
        };
      }
      return {
        accountId: account?.id || 'unknown',
        id: account?.id || 'unknown',
        label: 'Unknown account',
        configured: false
      };
    }
  },
  configSchema: {
    schema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'SwitchBot API token from developer settings'
        },
        secret: {
          type: 'string',
          description: 'SwitchBot API secret from developer settings'
        },
        credentialEndpoint: {
          type: 'string',
          default: 'https://oqwck99em8.execute-api.us-east-1.amazonaws.com/open/v1.1/iot/credential',
          description: 'SwitchBot IoT credential endpoint'
        },
        qos: {
          type: 'number',
          enum: [0, 1, 2],
          default: 1,
          description: 'MQTT QoS level'
        },
        renewBeforeMs: {
          type: 'number',
          default: 3600000,
          description: 'Renew credentials interval (milliseconds, default 1 hour)'
        }
      }
    }
  },
  // 网关配置
  gateway: {
    async startAccount(ctx: any) {
      const { accountId, cfg, runtime, abortSignal } = ctx;
      console.log(`[SwitchBot Channel] Starting account ${accountId}...`);
      console.log(`[SwitchBot Channel] ctx keys: ${Object.keys(ctx).join(', ')}`);
      console.log(`[SwitchBot Channel] runtime type: ${typeof runtime}, keys: ${runtime ? Object.keys(runtime).join(', ') : 'null'}`);

      const switchbotConfig = cfg?.channels?.switchbot;
      if (!switchbotConfig?.token || !switchbotConfig?.secret) {
        throw new Error('SwitchBot channel config missing token/secret');
      }
      const channel = create(switchbotConfig, { runtime });
      await channel.start();

      // 框架用 Promise.resolve(startAccount()) 跟踪生命周期。
      // 如果这个 promise resolve 了，框架认为 channel 退出 → 触发 auto-restart。
      // 所以返回一个挂起的 promise，只在 abortSignal 触发时 resolve。
      return new Promise<void>((resolve) => {
        if (abortSignal) {
          abortSignal.addEventListener('abort', async () => {
            console.log(`[SwitchBot Channel] Stopping account ${accountId} (abort signal)...`);
            await channel.stop();
            resolve();
          }, { once: true });
        }
      });
    }
  },
  // 状态检查
  status: {
    // collectStatusIssues 接收的是账户快照数组 accounts.map(a => a.snapshot)
    collectStatusIssues: (accountSnapshots: any) => {
      const issues: any[] = [];
      // 如果是数组，检查是否有已配置的账户
      if (Array.isArray(accountSnapshots)) {
        const hasConfigured = accountSnapshots.some((a: any) => a.configured);
        if (!hasConfigured && accountSnapshots.length === 0) {
          issues.push({
            type: 'missing-config',
            message: 'SwitchBot: no accounts configured (need token + secret in channels.switchbot)'
          });
        }
        return issues;
      }
      // fallback: 不应该走到这里
      return issues;
    },
    // buildChannelSummary 接收 { account, cfg, defaultAccountId, snapshot }
    buildChannelSummary: (params: any) => {
      const cfg = params?.cfg;
      const config = cfg?.channels?.switchbot;
      const configured = !!(config?.token && config?.secret);
      return {
        configured,
        accountCount: configured ? 1 : 0,
        status: configured ? 'ready' : 'needs-config'
      };
    },
    probeAccount: async (params: { account: any; timeoutMs: number; cfg: any }) => {
      const config = params.cfg?.channels?.switchbot;
      return {
        reachable: true,
        authenticated: !!(config?.token && config?.secret)
      };
    }
  }
};