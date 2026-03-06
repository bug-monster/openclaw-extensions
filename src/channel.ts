import { validateConfig, SwitchBotConfig } from './config';
import { CredentialService, MqttCredential } from './credential';
import { createMqttTlsClient } from './mqtt-client';
import { validateDeviceEvent } from './message-handler';
import { getDeviceStore, destroyDeviceStore } from './device-store';
import { SwitchBotDeviceEvent } from './types';

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
 * Receive real-time SwitchBot device status changes via AWS IoT Core MQTT
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

      // Initialize credential service - use timed renewal instead of expiration-based renewal
      this.credentialService = new CredentialService(
        this.config.token,
        this.config.secret,
        this.config.credentialEndpoint || 'https://oqwck99em8.execute-api.us-east-1.amazonaws.com/open/v1.1/iot/credential',
        'openclaw-instance',
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
   * Handle device message — store locally, don't push
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
    } catch (error) {
      console.error('[SwitchBot Channel] Failed to process device message:', error);
    }
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
    blurb: "Real-time SwitchBot device status via AWS IoT Core MQTT",
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