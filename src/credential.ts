import { z } from 'zod';
import crypto from 'crypto';

// 新的证书接口返回格式
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
    private renewIntervalMs: number, // 改为间隔，因为新接口没有expiration
    private onRenew: (cred: MqttCredential) => void,
  ) {}

  async fetch(): Promise<MqttCredential> {
    const ts = Date.now().toString();
    const nonce = "OpenClaw"; // 固定为 OpenClaw
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

    // 检查内层 statusCode
    if (data.body?.statusCode !== 100) {
      throw new Error(`SwitchBot IoT credential error (${data.body?.statusCode}): ${data.body?.message || 'unknown'}`);
    }

    const parsed = CredentialResponse.parse(data);
    this.current = parsed.body.body.channels.mqtt;
    this.lastFetchTime = Date.now();
    this.scheduleRenewal();

    console.log('[SwitchBot Credential] MQTT配置获取成功:', {
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

    // 由于新接口没有expiration，使用固定的续期间隔
    const delay = this.renewIntervalMs;

    console.log(`[SwitchBot] 凭证将在 ${delay / 1000} 秒后续期`);

    this.renewTimer = setTimeout(async () => {
      try {
        console.log('[SwitchBot] 开始续期凭证...');
        const cred = await this.fetch();
        this.onRenew(cred);
        console.log('[SwitchBot] 凭证续期成功');
      } catch (e) {
        console.error('[SwitchBot] 凭证续期失败:', e);
        // 续期失败，30s 后重试
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