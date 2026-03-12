import { validateConfig, SwitchBotConfig } from './config';
import { CredentialService, MqttCredential } from './credential';
import { createMqttTlsClient } from './mqtt-client';
import { validateDeviceEvent } from './message-handler';
import { getDeviceStore, destroyDeviceStore } from './device-store';
import { getSwitchBotRuntime } from './runtime';
import { SwitchBotDeviceEvent } from './types';
import fs from 'fs';
import path from 'path';

/**
 * Extract SwitchBot configuration from various configuration structures
 */
function extractSwitchBotConfig(config: any, globalConfig?: any): any {
  // Priority order:
  // 1. globalConfig.channels.switchbot
  // 2. config.channels.switchbot
  // 3. config (direct configuration)

  if (globalConfig?.channels?.switchbot) {
    console.log('[SwitchBot Channel] Reading config from global config channels.switchbot');
    return globalConfig.channels.switchbot;
  }

  if (config?.channels?.switchbot) {
    console.log('[SwitchBot Channel] Reading config from channels.switchbot');
    return config.channels.switchbot;
  }

  if (config?.token && config?.secret) {
    console.log('[SwitchBot Channel] Reading from direct config');
    return config;
  }

  // Last attempt: config might be elsewhere
  if (typeof globalThis !== 'undefined' && (globalThis as any).openclaw?.config?.channels?.switchbot) {
    console.log('[SwitchBot Channel] Reading config from global openclaw.config.channels.switchbot');
    return (globalThis as any).openclaw.config.channels.switchbot;
  }

  console.log('[SwitchBot Channel] Using default config structure, config object:', config);
  return config;
}

// Module-level singleton: prevent OpenClaw auto-restart from creating multiple MQTT connections
let activeInstance: SwitchBotChannel | null = null;

/**
 * SwitchBot Channel Plugin for OpenClaw
 * Receive real-time SwitchBot device status changes
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
   * Start channel connection
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    // Singleton protection: stop old instance if exists
    if (activeInstance && activeInstance !== this) {
      console.log('[SwitchBot Channel] Detected existing active instance, stopping old instance...');
      await activeInstance.stop();
    }
    activeInstance = this;

    try {
      console.log('[SwitchBot Channel] Starting...');

      // Generate unique instance ID (12 characters: numbers + uppercase + lowercase)
      const generateInstanceId = (): string => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 12; i++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
      };

      // Initialize credential service - use timed renewal instead of expiration-based renewal
      this.credentialService = new CredentialService(
        this.config.token,
        this.config.secret,
        this.config.credentialEndpoint || 'https://oqwck99em8.execute-api.us-east-1.amazonaws.com/open/v1.1/iot/credential',
        generateInstanceId(),
        this.config.renewBeforeMs || 3600000, // Default 1 hour renewal interval
        this.onCredentialsRenewed.bind(this)
      );

      // Get initial credentials
      const credentials = await this.credentialService.fetch();
      console.log('[SwitchBot Channel] MQTT credentials fetched successfully:', {
        brokerUrl: credentials.brokerUrl,
        region: credentials.region,
        clientId: credentials.clientId,
        statusTopic: credentials.topics.status,
        qos: credentials.qos
      });

      // Create and start MQTT TLS client
      await this.connectMQTT(credentials);

      this.isStarted = true;
      console.log('[SwitchBot Channel] Started successfully');
    } catch (error) {
      console.error('[SwitchBot Channel] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop channel connection
   */
  async stop(): Promise<void> {
    try {
      console.log('[SwitchBot Channel] Stopping...');

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
      console.log('[SwitchBot Channel] Stop completed');
    } catch (error) {
      console.error('[SwitchBot Channel] Failed to stop:', error);
    }
  }

  /**
   * Connect MQTT TLS client (singleton: destroy old client before creating new one)
   */
  private async connectMQTT(credentials: MqttCredential): Promise<void> {
    try {
      // Completely destroy old client to prevent clientId conflicts
      if (this.mqttClient) {
        console.log('[SwitchBot Channel] Destroying old MQTT client...');
        try { await this.mqttClient.disconnect(); } catch (_) {}
        this.mqttClient = null;
        // Wait for TCP to be fully released
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Create new MQTT TLS client manager
      this.mqttClient = createMqttTlsClient(
        credentials,
        {
          debug: (msg) => console.debug(`[SwitchBot Channel] ${msg}`),
          info: (msg) => console.log(`[SwitchBot Channel] ${msg}`),
          warn: (msg) => console.warn(`[SwitchBot Channel] ${msg}`),
          error: (msg) => console.error(`[SwitchBot Channel] ${msg}`),
        }
      );

      // Subscribe to SwitchBot device status messages
      this.mqttClient.subscribe(credentials.topics.status, (topic: string, payload: Buffer) => {
        this.handleDeviceMessage(topic, payload);
      });

      // Connect to MQTT broker
      await this.mqttClient.connect();
      console.log('[SwitchBot Channel] MQTT TLS connection successful');
    } catch (error) {
      console.error('[SwitchBot Channel] MQTT TLS connection failed:', error);
      throw error;
    }
  }

  /**
   * Handle credential renewal
   */
  private async onCredentialsRenewed(newCredentials: MqttCredential): Promise<void> {
    console.log('[SwitchBot Channel] Credentials renewed, reconnecting MQTT TLS');

    if (this.mqttClient) {
      // Use new updateCredentials method
      if (this.mqttClient.updateCredentials) {
        await this.mqttClient.updateCredentials(newCredentials);
      } else {
        // Fallback to reconnection
        await this.mqttClient.disconnect();
        await this.connectMQTT(newCredentials);
      }
    }
  }

  /**
   * Handle device message — store locally, and push to chat if device type is monitored
   */
  private handleDeviceMessage(topic: string, payload: Buffer): void {
    try {
      const message = payload.toString();
      console.log('[SwitchBot Channel] Received device message:', { topic, message });

      const eventData = JSON.parse(message);
      const deviceEvent = validateDeviceEvent(eventData);

      // Store locally
      const store = getDeviceStore();
      store.record({
        deviceMac: deviceEvent.context.deviceMac,
        deviceType: deviceEvent.context.deviceType,
        timestamp: deviceEvent.context.timeOfSample || Date.now(),
        context: deviceEvent.context,
      });

      console.log(`[SwitchBot Channel] Device status stored: ${deviceEvent.context.deviceType} (${deviceEvent.context.deviceMac})`);

      // Check if this device type should be monitored and pushed to chat
      const monitorTypes = this.config.monitorDeviceTypes || [];
      if (monitorTypes.length > 0) {
        const deviceType = deviceEvent.context.deviceType;
        const isMonitored = monitorTypes.some(
          (t: string) => t.toLowerCase() === deviceType.toLowerCase()
        );

        if (isMonitored) {
          this.pushDeviceEventToChat(deviceEvent);
        }
      }
    } catch (error) {
      console.error('[SwitchBot Channel] Failed to process device message:', error);
    }
  }

  /**
   * Push device event to chat via system event + heartbeat wake
   * The LLM will analyze the event and present it in a human-friendly way
   */
  private async pushDeviceEventToChat(event: SwitchBotDeviceEvent): Promise<void> {
    try {
      const runtime = getSwitchBotRuntime() as any;
      if (!runtime?.system?.enqueueSystemEvent || !runtime?.system?.requestHeartbeatNow) {
        console.warn('[SwitchBot Channel] Runtime system APIs not available, cannot push to chat');
        return;
      }

      const ctx = event.context;
      const eventText = event.context;
      const timestamp = new Date(ctx.timeOfSample || Date.now()).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

      // Extract image URLs from the event context
      const imageUrls = this.extractImageUrls(ctx);
      let imageInfo = '';

      if (imageUrls.length > 0) {
        // Download images and save locally
        const savedImages = await this.downloadEventImages(imageUrls, ctx.deviceMac, ctx.timeOfSample || Date.now());
        if (savedImages.length > 0) {
          imageInfo = `\n图片:\n${savedImages.map(img => `- ![${img.label}](${img.localPath})`).join('\n')}`;
        }
      }

      const systemEventText = [
        `[SwitchBot 设备实时通知]`,
        `时间: ${timestamp}`,
        `设备类型: ${ctx.deviceType}`,
        `设备MAC: ${ctx.deviceMac}`,
        `状态摘要: ${eventText}`,
        `原始数据: ${JSON.stringify(ctx)}`,
        imageInfo,
        ``,
        `请分析这条智能家居设备状态变化，用简洁自然的语言告知用户发生了什么。${imageUrls.length > 0 ? '消息中包含了设备拍摄的图片，请在回复中用 markdown 图片语法展示给用户。' : ''}如果是异常情况（如门窗长时间未关、异常时间段的运动检测等），请特别提醒。`,
      ].join('\n');

      // Use "main" as the default session key for the main chat session
      const sessionKey = 'main';
      const enqueued = runtime.system.enqueueSystemEvent(systemEventText, { sessionKey, contextKey: `switchbot:${ctx.deviceMac}:${ctx.timeOfSample}` });

      if (enqueued) {
        runtime.system.requestHeartbeatNow({ reason: `SwitchBot device event: ${ctx.deviceType} (${ctx.deviceMac})`, sessionKey });
        console.log(`[SwitchBot Channel] Pushed device event to chat: ${ctx.deviceType} (${ctx.deviceMac})${imageUrls.length > 0 ? ` with ${imageUrls.length} image(s)` : ''}`);
      } else {
        console.log(`[SwitchBot Channel] System event not enqueued (duplicate context key): ${ctx.deviceType} (${ctx.deviceMac})`);
      }
    } catch (error) {
      console.error('[SwitchBot Channel] Failed to push device event to chat:', error);
    }
  }

  /**
   * Extract image URLs from event context
   * SwitchBot camera/doorbell events may include image URLs in various fields
   */
  private extractImageUrls(ctx: Record<string, unknown>): Array<{ url: string; label: string }> {
    const images: Array<{ url: string; label: string }> = [];

    // Known image fields
    const imageFields: Array<{ key: string; label: string }> = [
      { key: 'imageUrl', label: '设备快照' },
      { key: 'detectionUrl', label: '检测事件图片' },
      { key: 'thumbnailUrl', label: '缩略图' },
      { key: 'imgUrl', label: '图片' },
      { key: 'photoUrl', label: '照片' },
      { key: 'snapshotUrl', label: '快照' },
      { key: 'picUrl', label: '图片' },
      { key: 'image', label: '图片' },
      { key: 'snapshot', label: '快照' },
      { key: 'url', label: '链接图片' },
    ];

    for (const { key, label } of imageFields) {
      const val = ctx[key];
      if (typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'))) {
        // Check if it looks like an image URL
        if (/\.(jpg|jpeg|png|gif|webp|bmp)/i.test(val) || val.includes('image') || val.includes('snapshot') || val.includes('photo') || val.includes('pic')) {
          images.push({ url: val, label });
        } else {
          // Could still be an image URL without extension (e.g. CDN URLs)
          images.push({ url: val, label });
        }
      }
    }

    // Also scan all string values for URLs that look like images (fallback)
    for (const [key, val] of Object.entries(ctx)) {
      if (typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'))
        && !imageFields.some(f => f.key === key)
        && /\.(jpg|jpeg|png|gif|webp|bmp)/i.test(val)) {
        images.push({ url: val, label: key });
      }
    }

    return images;
  }

  /**
   * Download event images to local storage
   */
  private async downloadEventImages(
    images: Array<{ url: string; label: string }>,
    deviceMac: string,
    timestamp: number
  ): Promise<Array<{ label: string; localPath: string; originalUrl: string }>> {
    const imageDir = path.join(process.env.HOME || '/tmp', '.openclaw', 'switchbot-data', 'images');
    fs.mkdirSync(imageDir, { recursive: true });

    const results: Array<{ label: string; localPath: string; originalUrl: string }> = [];

    for (const img of images) {
      try {
        const response = await fetch(img.url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) {
          console.warn(`[SwitchBot Channel] Failed to download image: ${response.status} ${img.url}`);
          // Still include the original URL as fallback
          results.push({ label: img.label, localPath: img.url, originalUrl: img.url });
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const ext = this.guessImageExtension(response.headers.get('content-type'), img.url);
        const filename = `${deviceMac}_${timestamp}_${img.label.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')}${ext}`;
        const localPath = path.join(imageDir, filename);

        fs.writeFileSync(localPath, buffer);
        console.log(`[SwitchBot Channel] Image saved: ${localPath} (${buffer.length} bytes)`);
        results.push({ label: img.label, localPath, originalUrl: img.url });
      } catch (error) {
        console.warn(`[SwitchBot Channel] Failed to download image ${img.url}:`, error);
        // Fallback to original URL
        results.push({ label: img.label, localPath: img.url, originalUrl: img.url });
      }
    }

    return results;
  }

  /**
   * Guess image file extension from content-type or URL
   */
  private guessImageExtension(contentType: string | null, url: string): string {
    if (contentType) {
      const map: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/bmp': '.bmp',
      };
      if (map[contentType]) return map[contentType];
    }
    const urlMatch = url.match(/\.(jpg|jpeg|png|gif|webp|bmp)/i);
    if (urlMatch) return `.${urlMatch[1].toLowerCase()}`;
    return '.jpg'; // default
  }

  /**
   * Get channel status
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
   * Health check
   */
  healthCheck(): boolean {
    return this.isStarted && (this.mqttClient?.isConnected() || false);
  }
}

// Factory function to create plugin instance
function create(config: any, context?: any): SwitchBotChannel {
  // Pass context to constructor to access global configuration
  return new SwitchBotChannel(config, context?.globalConfig || context);
}

// Export according to OpenClaw channel plugin standard
export const switchbotPlugin = {
  id: "switchbot",
  meta: {
    id: "switchbot",
    label: "SwitchBot",
    selectionLabel: "SwitchBot (Smart Home)",
    docsPath: "/channels/switchbot",
    docsLabel: "switchbot",
    blurb: "Real-time SwitchBot device status",
    aliases: ["switchbot"],
  },
  capabilities: {
    chatTypes: [],  // SwitchBot is IoT device channel, does not support chat
    media: false,   // SwitchBot does not support media files
    features: {
      inbound: true,   // Receive SwitchBot device messages
      outbound: false, // Does not support active sending
      threading: false,
      reactions: false,
      editing: false,
      deletion: false,
    }
  },
  config: {
    // Account management
    // Note: cfg parameter is complete openclaw config object, channel config is under cfg.channels.switchbot
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
      // Received is the account object returned by resolveAccount
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
        }
      },
      required: []
    }
  },
  // Gateway configuration
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

      // Framework uses Promise.resolve(startAccount()) to track lifecycle.
      // If this promise resolves, framework considers channel exited → triggers auto-restart.
      // So return a pending promise that only resolves when abortSignal triggers.
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
  // Status checks
  status: {
    // collectStatusIssues receives account snapshot array accounts.map(a => a.snapshot)
    collectStatusIssues: (accountSnapshots: any) => {
      const issues: any[] = [];
      // If it's an array, check if there are configured accounts
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
      // fallback: should not reach here
      return issues;
    },
    // buildChannelSummary receives { account, cfg, defaultAccountId, snapshot }
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