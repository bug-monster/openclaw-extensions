import { validateConfig, SwitchBotConfig } from './config';
import { CredentialService } from './credential';
import { createIoTMqttClient } from './mqtt-client';
import { toOpenClawMessage, validateDeviceEvent } from './message-handler';
import { SwitchBotDeviceEvent } from './types';
import { getSwitchBotRuntime } from './runtime';

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

    try {
      console.log('[SwitchBot Channel] 开始启动...');

      // 初始化凭证服务
      this.credentialService = new CredentialService(
        this.config.token,
        this.config.secret,
        this.config.credentialEndpoint || 'https://oqwck99em8.execute-api.us-east-1.amazonaws.com/open/v1.1/iot/credential',
        'openclaw-instance',
        this.config.renewBeforeMs || 300000,
        this.onCredentialsRenewed.bind(this)
      );

      // 获取初始凭证
      const credentials = await this.credentialService.fetch();
      console.log('[SwitchBot Channel] 凭证获取成功:', {
        endpoint: credentials.iotEndpoint,
        region: credentials.region,
        clientId: credentials.clientId
      });

      // 创建并启动 MQTT 客户端
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
        await new Promise<void>((resolve) => {
          this.mqttClient.end(() => resolve());
        });
        this.mqttClient = null;
      }

      if (this.credentialService) {
        this.credentialService.destroy();
        this.credentialService = null;
      }

      this.isStarted = false;
      console.log('[SwitchBot Channel] 停止完成');
    } catch (error) {
      console.error('[SwitchBot Channel] 停止失败:', error);
    }
  }

  /**
   * 连接 MQTT 客户端
   */
  private async connectMQTT(credentials: any): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.mqttClient = createIoTMqttClient(credentials, this.config.qos || 1);

        this.mqttClient.on('connect', () => {
          console.log('[SwitchBot Channel] MQTT 连接成功');
          resolve();
        });

        this.mqttClient.on('message', (topic: string, payload: Buffer) => {
          this.handleDeviceMessage(topic, payload);
        });

        this.mqttClient.on('error', (error: any) => {
          console.error('[SwitchBot Channel] MQTT 错误:', error);
          if (!this.isStarted) {
            reject(error);
          }
        });

        this.mqttClient.on('close', () => {
          console.log('[SwitchBot Channel] MQTT 连接关闭');
        });

        // 设置连接超时
        setTimeout(() => {
          if (!this.mqttClient?.connected) {
            reject(new Error('MQTT 连接超时'));
          }
        }, 30000);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 处理凭证续期
   */
  private async onCredentialsRenewed(newCredentials: any): Promise<void> {
    console.log('[SwitchBot Channel] 凭证已续期，重新连接 MQTT');

    if (this.mqttClient) {
      this.mqttClient.end();
    }

    await this.connectMQTT(newCredentials);
  }

  /**
   * 处理设备消息
   */
  private handleDeviceMessage(topic: string, payload: Buffer): void {
    try {
      const message = payload.toString();
      console.log('[SwitchBot Channel] 收到设备消息:', { topic, message });

      // 解析和验证事件数据
      const eventData = JSON.parse(message);
      const deviceEvent = validateDeviceEvent(eventData);

      // 转换为 OpenClaw 消息格式
      const openClawMessage = toOpenClawMessage(topic, deviceEvent);

      // 发送到 OpenClaw
      this.sendMessage(openClawMessage);

    } catch (error) {
      console.error('[SwitchBot Channel] 处理设备消息失败:', error);
    }
  }

  /**
   * 发送消息到 OpenClaw
   */
  private async sendMessage(message: any): Promise<void> {
    try {
      const runtime = getSwitchBotRuntime();
      if (runtime?.sendMessage) {
        await runtime.sendMessage(message);
        console.log('[SwitchBot Channel] 消息已发送到 OpenClaw');
      } else {
        // 开发环境下的日志输出
        console.log('[SwitchBot Channel] OpenClaw 消息 (dev mode):', JSON.stringify(message, null, 2));
      }
    } catch (error) {
      console.error('[SwitchBot Channel] 发送消息失败:', error);
    }
  }

  /**
   * 获取渠道状态
   */
  getStatus(): any {
    return {
      started: this.isStarted,
      mqttConnected: this.mqttClient?.connected || false,
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
    return this.isStarted && this.mqttClient?.connected;
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
      inbound: true,   // 接收设备消息
      outbound: false, // 不支持主动发送到设备
      threading: false,
      reactions: false,
      editing: false,
      deletion: false,
    }
  },
  config: {
    // 账户管理
    listAccountIds: (cfg: any) => {
      const config = cfg?.channels?.switchbot || cfg;
      return config?.token ? ['default'] : [];
    },
    resolveAccount: (cfg: any, accountId?: string) => {
      const config = cfg?.channels?.switchbot || cfg;
      if (accountId === 'default' && config?.token) {
        return {
          id: 'default',
          label: 'SwitchBot Account',
          configured: true
        };
      }
      return null;
    },
    defaultAccountId: (cfg: any) => {
      const config = cfg?.channels?.switchbot || cfg;
      return config?.token ? 'default' : null;
    },
    isConfigured: (cfg: any) => {
      const config = cfg?.channels?.switchbot || cfg;
      return !!(config?.token && config?.secret);
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
          default: 300000,
          description: 'Renew credentials before expiry (milliseconds)'
        }
      }
    }
  },
  // 网关配置
  gateway: {
    async startAccount(ctx: any) {
      const { accountId, config, runtime } = ctx;
      console.log(`[SwitchBot Channel] Starting account ${accountId}...`);

      const switchbotConfig = config?.channels?.switchbot || config;
      const channel = create(switchbotConfig, { runtime });
      await channel.start();

      return {
        stop: async () => {
          console.log(`[SwitchBot Channel] Stopping account ${accountId}...`);
          await channel.stop();
        }
      };
    }
  },
  // 状态检查
  status: {
    collectStatusIssues: (cfg: any) => {
      const config = cfg?.channels?.switchbot || cfg;
      const issues = [];
      if (!config?.token) {
        issues.push({
          type: 'missing-config',
          message: 'SwitchBot API token is required'
        });
      }
      if (!config?.secret) {
        issues.push({
          type: 'missing-config',
          message: 'SwitchBot API secret is required'
        });
      }
      return issues;
    },
    buildChannelSummary: (cfg: any) => {
      const config = cfg?.channels?.switchbot || cfg;
      const configured = !!(config?.token && config?.secret);
      return {
        configured,
        accountCount: configured ? 1 : 0,
        status: configured ? 'ready' : 'needs-config'
      };
    },
    probeAccount: async (params: { account: any; timeoutMs: number; cfg: any }) => {
      const config = params.cfg?.channels?.switchbot || params.cfg;
      // 这里可以添加账户探测逻辑
      return {
        reachable: true,
        authenticated: !!(config?.token && config?.secret)
      };
    }
  }
};