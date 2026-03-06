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
  private isConnecting = false;  // 添加连接状态保护

  constructor(credential: MqttCredential, logger: Logger) {
    this.credential = credential;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    // 防止并发连接
    if (this.isConnecting) {
      this.logger.warn('Connection already in progress, skipping');
      return;
    }

    if (this.client && this.isConnectedState) {
      this.logger.debug('MQTT client already connected');
      return;
    }

    this.isConnecting = true;

    // 清除挂起的重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      // 强制清理旧连接（移除所有 listener 防止幽灵事件）
      if (this.client) {
        this.logger.info('Cleaning up existing client before new connection');
        this.client.removeAllListeners();
        this.client.end(true);
        this.client = null;
      }

      this.logger.info(`Connecting to MQTT broker: ${this.credential.brokerUrl}`);
      this.logger.debug(`Region: ${this.credential.region}`);

      const tlsOptions = {
        ca: this.credential.tls.caBase64,
        cert: this.credential.tls.certBase64,
        key: this.credential.tls.keyBase64,
        rejectUnauthorized: true,
      };

      // 使用服务端分配的 clientId（不要加随机后缀，AWS IoT policy 绑定了固定 clientId）
      const connectOptions = {
        clientId: this.credential.clientId,
        clean: true,
        connectTimeout: 30000,
        reconnectPeriod: 0,
        keepalive: 60,
        reschedulePings: true,
        ...tlsOptions,
      };

      this.logger.debug(`Client ID: ${this.credential.clientId}`);
      this.logger.debug('Connecting with TLS certificates...');

      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('MQTT TLS connection timeout (30s)'));
        }, 30000);

        this.client = mqtt.connect(this.credential.brokerUrl, connectOptions);

        this.client.once('connect', () => {
          clearTimeout(timeoutId);
          this.isConnectedState = true;
          this.reconnectAttempts = 0;
          this.logger.info(`MQTT TLS connected successfully (${this.credential.clientId})`);

          // 订阅状态主题
          const statusTopic = this.credential.topics.status;
          this.client!.subscribe(statusTopic, { qos: this.credential.qos as 0 | 1 | 2 }, (err, granted) => {
            if (err) {
              this.logger.error(`Failed to subscribe to status topic: ${statusTopic} error: ${err.message}`);
            } else {
              const grantedInfo = granted?.map(g => `${g.topic} qos=${g.qos}`).join(', ') || 'unknown';
              this.logger.info(`Subscribe result for ${statusTopic}: [${grantedInfo}]`);
              if (granted?.some(g => g.qos === 128)) {
                this.logger.error(`⚠️ Broker REJECTED subscription (qos=128)! IoT policy may not allow this topic.`);
              }
            }
          });

          resolve();
        });

        this.client.on('message', (topic, payload) => {
          this.logger.info(`[RAW MSG] topic=${topic} len=${payload.length} payload=${payload.toString().slice(0, 200)}`);
          this.handleMessage(topic, payload);
        });

        this.client.on('packetsend', (packet: any) => {
          this.logger.debug(`[PKT SEND] ${packet.cmd} ${JSON.stringify(packet).slice(0, 200)}`);
        });

        this.client.on('packetreceive', (packet: any) => {
          this.logger.info(`[PKT RECV] ${packet.cmd} ${JSON.stringify(packet).slice(0, 200)}`);
        });

        this.client.once('error', (error) => {
          clearTimeout(timeoutId);
          this.isConnectedState = false;
          this.logger.error(`MQTT TLS connection error: ${error.message}`);
          reject(error);
        });

        this.client.on('close', () => {
          this.isConnectedState = false;

          // 主动断开或正在连接中（凭证更新），不触发 reconnect
          if (this.intentionalDisconnect || this.isConnecting) {
            this.logger.debug('MQTT TLS connection closed (intentional)');
            return;
          }

          this.logger.warn('MQTT TLS connection closed unexpectedly');

          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(Math.pow(2, this.reconnectAttempts - 1) * 1000, 30000);
            this.logger.info(`Scheduling reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);

            this.reconnectTimer = setTimeout(() => {
              this.connect().catch(err => {
                this.logger.error(`Reconnect attempt failed: ${err.message}`);
              });
            }, delay);
          } else {
            this.logger.error('Max reconnect attempts reached');
          }
        });
      });
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;

    // 清除重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      this.isConnectedState = false;
      const client = this.client;
      this.client = null;
      client.removeAllListeners();
      client.end(true); // force close，不等回调（避免竞态）
      this.logger.info('MQTT TLS disconnected');
    }

    this.intentionalDisconnect = false;
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

  // 更新凭证（用于凭证续期）— 始终断开旧连接并重连
  async updateCredentials(newCredential: MqttCredential): Promise<void> {
    this.logger.info('Updating MQTT TLS credentials...');
    this.credential = newCredential;

    // 无论当前是否连接，都断开并重连（确保使用新证书）
    await this.disconnect();

    // 短暂等待确保 TCP 完全关闭
    await new Promise(resolve => setTimeout(resolve, 500));

    this.logger.info('Reconnecting with new credentials...');
    this.reconnectAttempts = 0; // 重置计数器
    await this.connect();
    this.logger.info('Credentials updated and reconnected successfully');
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