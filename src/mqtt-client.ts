import mqtt from 'mqtt';
import { MqttCredential } from './credential';

// Logger interface compatible with openclaw-mqtt
interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

// Message handler type
type MessageHandler = (topic: string, payload: Buffer) => void;

// MQTT over TLS client manager implementation
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
  private isConnecting = false;  // Add connection state protection

  constructor(credential: MqttCredential, logger: Logger) {
    this.credential = credential;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    // Prevent concurrent connections
    if (this.isConnecting) {
      this.logger.warn('Connection already in progress, skipping');
      return;
    }

    if (this.client && this.isConnectedState) {
      this.logger.debug('MQTT client already connected');
      return;
    }

    this.isConnecting = true;

    // Clear pending reconnect timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      // Force cleanup old connection (remove all listeners to prevent ghost events)
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

      // Use server-assigned clientId (don't add random suffix, AWS IoT policy binds to fixed clientId)
      const connectOptions = {
        clientId: this.credential.clientId,
        clean: true,
        connectTimeout: 30000,
        reconnectPeriod: 0,
        keepalive: 60,
        reschedulePings: true,
        ...tlsOptions,
      };

      // this.logger.debug(`Client ID: ${this.credential.clientId}`);
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

          // Subscribe to status topic
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

          // Intentional disconnect or connecting in progress (credential update), don't trigger reconnect
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

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      this.isConnectedState = false;
      const client = this.client;
      this.client = null;
      client.removeAllListeners();
      client.end(true); // force close, don't wait for callback (avoid race condition)
      this.logger.info('MQTT TLS disconnected');
    }

    this.intentionalDisconnect = false;
  }

  async publish(topic: string, message: string, qos?: 0 | 1 | 2): Promise<void> {
    throw new Error('SwitchBot Channel does not support MQTT publishing - only subscription for device status monitoring');
  }

  subscribe(topic: string, handler: MessageHandler): void {
    // Add message handler
    if (!this.messageHandlers.has(topic)) {
      this.messageHandlers.set(topic, []);
    }
    this.messageHandlers.get(topic)!.push(handler);

    // If already connected, subscribe immediately
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

  // Reset reconnect state (for manual connection recovery)
  resetReconnectState(): void {
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.logger.info('Reconnect state reset');
  }

  // Update credentials (for credential renewal) — always disconnect old connection and reconnect
  async updateCredentials(newCredential: MqttCredential): Promise<void> {
    this.logger.info('Updating MQTT TLS credentials...');
    this.credential = newCredential;

    // Regardless of current connection state, disconnect and reconnect (ensure new certificate is used)
    await this.disconnect();

    // Brief wait to ensure TCP is fully closed
    await new Promise(resolve => setTimeout(resolve, 500));

    this.logger.info('Reconnecting with new credentials...');
    this.reconnectAttempts = 0; // Reset counter
    await this.connect();
    this.logger.info('Credentials updated and reconnected successfully');
  }

  // Message distribution
  private handleMessage(topic: string, payload: Buffer): void {
    // Exact match
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

    // Wildcard matching (simple implementation)
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

  // Simple MQTT topic matching implementation
  private topicMatches(topic: string, pattern: string): boolean {
    if (pattern === topic) return true;

    const topicParts = topic.split('/');
    const patternParts = pattern.split('/');

    for (let i = 0; i < Math.max(topicParts.length, patternParts.length); i++) {
      const topicPart = topicParts[i];
      const patternPart = patternParts[i];

      if (patternPart === '#') {
        return true; // # matches all remaining parts
      }

      if (patternPart === '+') {
        continue; // + matches single part
      }

      if (topicPart !== patternPart) {
        return false;
      }
    }

    return topicParts.length === patternParts.length;
  }
}

// Factory function for creating MQTT TLS client manager
export function createMqttTlsClient(credential: MqttCredential, logger?: Logger): MqttTlsClientManager {
  const defaultLogger: Logger = {
    debug: (msg) => console.debug(`[MQTT TLS] ${msg}`),
    info: (msg) => console.log(`[MQTT TLS] ${msg}`),
    warn: (msg) => console.warn(`[MQTT TLS] ${msg}`),
    error: (msg) => console.error(`[MQTT TLS] ${msg}`),
  };

  return new MqttTlsClientManager(credential, logger || defaultLogger);
}

// Backward compatible function (now internally uses TLS connection)
export function createAwsIoTMqttClient(credential: MqttCredential, qos?: 0 | 1 | 2, logger?: Logger): MqttTlsClientManager {
  return createMqttTlsClient(credential, logger);
}