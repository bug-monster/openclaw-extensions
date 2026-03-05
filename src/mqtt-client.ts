import mqtt from 'mqtt';
import { MqttCredential } from './credential';

// Logger接口兼容openclaw-mqtt
interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

// Message handler类型
type MessageHandler = (topic: string, payload: Buffer) => void;

// MQTT over TLS 客户端管理器实现
class MqttTlsClientManager {
  private client: mqtt.MqttClient | null = null;
  private credential: MqttCredential;
  private logger: Logger;
  private messageHandlers: Map<string, MessageHandler[]> = new Map();
  private isConnectedState = false;
  private intentionalDisconnect = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(credential: MqttCredential, logger: Logger) {
    this.credential = credential;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    if (this.client && this.isConnectedState) {
      this.logger.debug('MQTT client already connected');
      return;
    }

    // 如果有正在进行的重连定时器，清除它
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    return new Promise((resolve, reject) => {
      try {
        // 解析broker URL
        const brokerUrl = new URL(this.credential.brokerUrl);

        this.logger.info(`Connecting to MQTT broker: ${this.credential.brokerUrl}`);
        this.logger.debug(`Client ID: ${this.credential.clientId}`);
        this.logger.debug(`Region: ${this.credential.region}`);

        // 准备TLS证书 - 证书数据已经是PEM格式，不需要Base64解码
        // 只需要确保换行符正确处理
        const tlsOptions = {
          ca: this.credential.tls.caBase64,
          cert: this.credential.tls.certBase64,
          key: this.credential.tls.keyBase64,
          rejectUnauthorized: true,
        };

        this.logger.debug('Using PEM certificates for TLS connection');
        this.logger.debug(`CA cert starts with: ${this.credential.tls.caBase64.slice(0, 50)}...`);
        this.logger.debug(`Client cert starts with: ${this.credential.tls.certBase64.slice(0, 50)}...`);
        this.logger.debug(`Private key starts with: ${this.credential.tls.keyBase64.slice(0, 50)}...`);

        // MQTT连接选项
        const connectOptions = {
          clientId: this.credential.clientId,
          clean: true,
          connectTimeout: 30000,
          reconnectPeriod: 0,         // 禁用自动重连
          keepalive: 60,              // 保持心跳检测
          reschedulePings: true,      // 重新安排ping
          // TLS配置
          ...tlsOptions,
        };

        this.logger.debug('Connecting with TLS certificates...');

        this.client = mqtt.connect(this.credential.brokerUrl, connectOptions);

        this.client.on('connect', () => {
          this.isConnectedState = true;
          this.reconnectAttempts = 0; // 重置重连计数器
          this.logger.info(`MQTT TLS connected successfully (${this.credential.clientId})`);

          // 自动订阅SwitchBot状态主题
          const statusTopic = this.credential.topics.status;
          this.client!.subscribe(statusTopic, { qos: this.credential.qos as 0 | 1 | 2 }, (err) => {
            if (err) {
              this.logger.error(`Failed to subscribe to status topic: ${statusTopic}`);
            } else {
              this.logger.info(`Subscribed to status topic: ${statusTopic}`);
            }
          });

          resolve();
        });

        this.client.on('message', (topic, payload, packet) => {
          this.handleMessage(topic, payload);
        });

        this.client.on('error', (error) => {
          this.isConnectedState = false;
          this.logger.error(`MQTT TLS connection error: ${error.message}`);
          if (!this.isConnectedState) {
            reject(error);
          }
        });

        this.client.on('offline', () => {
          this.isConnectedState = false;
          this.logger.warn('MQTT TLS offline, attempting reconnect...');
        });

        this.client.on('close', () => {
          this.isConnectedState = false;
          this.logger.warn('MQTT TLS connection closed');

          // 只有在非主动断开的情况下才尝试重连
          if (!this.intentionalDisconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = Math.min(Math.pow(2, this.reconnectAttempts) * 1000, 30000); // 1s, 2s, 4s, 8s, 16s, 最大30s
            this.reconnectAttempts++;

            this.logger.info(`Attempting manual reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} after ${delay}ms`);

            this.reconnectTimer = setTimeout(() => {
              this.connect().catch(err => {
                this.logger.error(`Manual reconnect attempt failed: ${err.message}`);
              });
            }, delay);
          } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.logger.error('Max reconnect attempts reached, giving up automatic reconnection');
          }
        });

        this.client.on('reconnect', () => {
          // 由于我们已禁用自动重连，这个事件不应该被触发
          this.logger.debug('MQTT TLS reconnect event triggered (should not happen with reconnectPeriod=0)');
        });

        // 连接超时处理
        setTimeout(() => {
          if (!this.isConnectedState) {
            reject(new Error('MQTT TLS connection timeout'));
          }
        }, 30000);

      } catch (error) {
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      this.intentionalDisconnect = true; // 标记为主动断开

      // 清除重连定时器
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      if (this.client) {
        this.isConnectedState = false;
        this.client.end(() => {
          this.client = null;
          this.messageHandlers.clear();
          this.intentionalDisconnect = false; // 重置标志
          this.logger.info('MQTT TLS disconnected');
          resolve();
        });
      } else {
        this.intentionalDisconnect = false; // 重置标志
        resolve();
      }
    });
  }

  async publish(topic: string, message: string, qos?: 0 | 1 | 2): Promise<void> {
    throw new Error('SwitchBot Channel does not support MQTT publishing - only subscription for device status monitoring');
  }

  subscribe(topic: string, handler: MessageHandler): void {
    // 添加消息处理器
    if (!this.messageHandlers.has(topic)) {
      this.messageHandlers.set(topic, []);
    }
    this.messageHandlers.get(topic)!.push(handler);

    // 如果已连接，立即订阅
    if (this.client && this.isConnectedState) {
      this.client.subscribe(topic, { qos: this.credential.qos as 0 | 1 | 2 }, (err) => {
        if (err) {
          this.logger.error(`Failed to subscribe to ${topic}: ${err.message}`);
        } else {
          this.logger.info(`Subscribed to ${topic}`);
        }
      });
    }
  }

  isConnected(): boolean {
    return this.isConnectedState;
  }

  // 重置重连状态（用于手动恢复连接）
  resetReconnectState(): void {
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.logger.info('Reconnect state reset');
  }

  // 更新凭证（用于凭证续期）
  async updateCredentials(newCredential: MqttCredential): Promise<void> {
    this.logger.info('Updating MQTT TLS credentials...');
    this.credential = newCredential;

    if (this.client && this.isConnectedState) {
      this.logger.info('Disconnecting current connection to update credentials...');
      await this.disconnect();

      // 等待一小段时间确保连接完全关闭
      await new Promise(resolve => setTimeout(resolve, 1000));

      this.logger.info('Reconnecting with new credentials...');
      await this.connect();
      this.logger.info('Credentials updated and reconnected successfully');
    } else {
      this.logger.debug('No active connection, credentials updated for next connection');
    }
  }

  // 消息分发
  private handleMessage(topic: string, payload: Buffer): void {
    // 精确匹配
    const exactHandlers = this.messageHandlers.get(topic);
    if (exactHandlers) {
      exactHandlers.forEach(handler => {
        try {
          handler(topic, payload);
        } catch (error) {
          this.logger.error(`Message handler error for topic ${topic}: ${error}`);
        }
      });
    }

    // 通配符匹配（简单实现）
    for (const [pattern, handlers] of this.messageHandlers.entries()) {
      if (pattern !== topic && this.topicMatches(topic, pattern)) {
        handlers.forEach(handler => {
          try {
            handler(topic, payload);
          } catch (error) {
            this.logger.error(`Message handler error for pattern ${pattern}: ${error}`);
          }
        });
      }
    }
  }

  // 简单的MQTT主题匹配实现
  private topicMatches(topic: string, pattern: string): boolean {
    if (pattern === topic) return true;

    const topicParts = topic.split('/');
    const patternParts = pattern.split('/');

    for (let i = 0; i < Math.max(topicParts.length, patternParts.length); i++) {
      const topicPart = topicParts[i];
      const patternPart = patternParts[i];

      if (patternPart === '#') {
        return true; // # 匹配剩余所有部分
      }

      if (patternPart === '+') {
        continue; // + 匹配单个部分
      }

      if (topicPart !== patternPart) {
        return false;
      }
    }

    return topicParts.length === patternParts.length;
  }
}

// 创建MQTT TLS客户端管理器的工厂函数
export function createMqttTlsClient(credential: MqttCredential, logger?: Logger): MqttTlsClientManager {
  const defaultLogger: Logger = {
    debug: (msg) => console.debug(`[MQTT TLS] ${msg}`),
    info: (msg) => console.log(`[MQTT TLS] ${msg}`),
    warn: (msg) => console.warn(`[MQTT TLS] ${msg}`),
    error: (msg) => console.error(`[MQTT TLS] ${msg}`),
  };

  return new MqttTlsClientManager(credential, logger || defaultLogger);
}

// 保持向后兼容的函数（现在内部使用TLS连接）
export function createAwsIoTMqttClient(credential: MqttCredential, qos?: 0 | 1 | 2, logger?: Logger): MqttTlsClientManager {
  return createMqttTlsClient(credential, logger);
}