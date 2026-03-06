import { z } from 'zod';
import crypto from 'crypto';

// New credential interface response format
const CredentialResponse = z.object({
  statusCode: z.number(),
  body: z.object({
    statusCode: z.number(),
    body: z.object({
      channels: z.object({
        mqtt: z.object({
          brokerUrl: z.string(),
          region: z.string(),
          clientId: z.string(),
          topics: z.object({
            status: z.string(),
          }),
          qos: z.number(),
          tls: z.object({
            enabled: z.boolean(),
            caBase64: z.string(),
            certBase64: z.string(),
            keyBase64: z.string(),
          }),
        }),
      }),
    })
  }),
  message: z.string(),
});

export type MqttCredential = z.infer<typeof CredentialResponse>['body']['body']['channels']['mqtt'];

export class CredentialService {
  private current: MqttCredential | null = null;
  private renewTimer: NodeJS.Timeout | null = null;
  private lastFetchTime = 0;

  constructor(
    private token: string,
    private secret: string,
    private endpoint: string,
    private instanceId: string,
    private renewIntervalMs: number, // Changed to interval, since new interface doesn't have expiration
    private onRenew: (cred: MqttCredential) => void,
  ) {}

  async fetch(): Promise<MqttCredential> {
    const ts = Date.now().toString();
    const nonce = "OpenClaw"; // Fixed to OpenClaw
    const sign = this.computeSign(ts, nonce);

    const headers: Record<string, any> = {
      'Authorization': this.token,
      'sign': sign,
      't': Number(ts),
      'nonce': nonce,
      'Content-Type': 'application/json',
    };
    const body = JSON.stringify({ instanceId: this.instanceId });

    console.log('[SwitchBot Credential] Request URL:', this.endpoint);
    console.log('[SwitchBot Credential] Request headers:', {
      ...headers,
      'Authorization': headers['Authorization']?.slice(0, 20) + '...',
    });
    console.log('[SwitchBot Credential] Request body:', body);

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body,
    });

    console.log('[SwitchBot Credential] Response status:', res.status, res.statusText);
    const rawText = await res.text();
    console.log('[SwitchBot Credential] Response body:', rawText.slice(0, 500));

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = JSON.parse(rawText);
    if (data.statusCode !== 100) {
      throw new Error(`Credential fetch failed: ${data.message}`);
    }

    // API response format: { statusCode, body: { channels: { mqtt } } }
    const outerBody = data.body;
    const mqttConfig = outerBody?.channels?.mqtt;

    if (!mqttConfig) {
      throw new Error('MQTT config not found in credential response');
    }

    this.current = mqttConfig as MqttCredential;
    this.lastFetchTime = Date.now();
    this.scheduleRenewal();

    console.log('[SwitchBot Credential] MQTT configuration fetched successfully:', {
      brokerUrl: this.current.brokerUrl,
      clientId: this.current.clientId,
      region: this.current.region,
      statusTopic: this.current.topics.status,
      qos: this.current.qos,
      tlsEnabled: this.current.tls.enabled,
    });

    return this.current;
  }

  private computeSign(ts: string, nonce: string): string {
    const data = this.token + ts + nonce;
    const hex = crypto.createHmac('sha256', Buffer.from(this.secret, 'utf8'))
      .update(Buffer.from(data, 'utf8'))
      .digest('hex');
    return Buffer.from(hex, 'hex').toString('base64');
  }

  private scheduleRenewal() {
    if (this.renewTimer) clearTimeout(this.renewTimer);

    // Since new interface doesn't have expiration, use fixed renewal interval
    const delay = this.renewIntervalMs;

    console.log(`[SwitchBot] Credentials will be renewed in ${delay / 1000} seconds`);

    this.renewTimer = setTimeout(async () => {
      try {
        console.log('[SwitchBot] Starting credential renewal...');
        const cred = await this.fetch();
        this.onRenew(cred);
        console.log('[SwitchBot] Credential renewal successful');
      } catch (e) {
        console.error('[SwitchBot] Credential renewal failed:', e);
        // Renewal failed, retry in 30s
        this.renewTimer = setTimeout(() => this.scheduleRenewal(), 30_000);
      }
    }, delay);
  }

  getCurrent(): MqttCredential | null {
    return this.current;
  }

  destroy() {
    if (this.renewTimer) {
      clearTimeout(this.renewTimer);
      this.renewTimer = null;
    }
  }
}