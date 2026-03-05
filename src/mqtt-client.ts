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

  constructor(credential: MqttCredential, logger: Logger) {
    this.credential = credential;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    if (this.client && this.isConnectedState) {
      this.logger.debug('MQTT client already connected');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // 解析broker URL
        const brokerUrl = new URL(this.credential.brokerUrl);

        this.logger.info(`Connecting to MQTT broker: ${this.credential.brokerUrl}`);
        this.logger.debug(`Client ID: ${this.credential.clientId}`);
        this.logger.debug(`Region: ${this.credential.region}`);

        // 准备TLS证书
        const tlsOptions = {
          ca: Buffer.from(this.credential.tls.caBase64, 'base64'),
          cert: Buffer.from(this.credential.tls.certBase64, 'base64'),
          key: Buffer.from(this.credential.tls.keyBase64, 'base64'),
          rejectUnauthorized: true,
        };

        // MQTT连接选项
        const connectOptions = {
          clientId: this.credential.clientId,
          clean: true,
          connectTimeout: 30000,
          reconnectPeriod: 5000,
          // TLS配置
          ...tlsOptions,
        };

        this.logger.debug('Connecting with TLS certificates...');

        this.client = mqtt.connect(this.credential.brokerUrl, connectOptions);

        this.client.on('connect', () => {
          this.isConnectedState = true;
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
        });

        this.client.on('reconnect', () => {
          this.logger.info('MQTT TLS reconnecting...');
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
      if (this.client) {
        this.isConnectedState = false;
        this.client.end(() => {
          this.client = null;
          this.messageHandlers.clear();
          this.logger.info('MQTT TLS disconnected');
          resolve();
        });
      } else {
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

  // 更新凭证（用于凭证续期）
  async updateCredentials(newCredential: MqttCredential): Promise<void> {
    this.logger.info('Updating MQTT TLS credentials...');
    this.credential = newCredential;

    if (this.client && this.isConnectedState) {
      await this.disconnect();
      await this.connect();
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