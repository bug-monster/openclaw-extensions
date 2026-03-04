import { validateConfig, SwitchBotConfig } from './src/config';
import { CredentialService } from './src/credential';
import { createIoTMqttClient } from './src/mqtt-client';
import { toOpenClawMessage, validateDeviceEvent } from './src/message-handler';
import { SwitchBotDeviceEvent } from './src/types';

/**
 * SwitchBot Channel Plugin for OpenClaw
 * 通过 AWS IoT Core MQTT 实时接收 SwitchBot 设备状态变化
 */
class SwitchBotChannel {
  private credentialService: CredentialService | null = null;
  private mqttClient: any = null;
  private config: SwitchBotConfig;
  private isStarted = false;

  constructor(config: any) {
    this.config = validateConfig(config);
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
      // 这个方法会在运行时由 OpenClaw 框架注入
      if ((globalThis as any).openclaw?.sendMessage) {
        await (globalThis as any).openclaw.sendMessage(message);
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
        deviceCount: this.config.deviceIds?.length || 0
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

// OpenClaw 插件导出 - 使用传统格式
export const configSchema = {
  type: 'object',
  required: ['token', 'secret'],
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
    deviceIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'Device IDs to monitor (empty = all devices)'
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
};

// 创建插件实例的工厂函数
export function create(config: any): SwitchBotChannel {
  return new SwitchBotChannel(config);
}

// 传统的默认导出（用于兼容性）
export default SwitchBotChannel;