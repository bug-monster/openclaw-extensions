import { z } from 'zod';
import crypto from 'crypto';

const CredentialResponse = z.object({
  statusCode: z.number(),
  body: z.object({
    statusCode: z.number(),
    body: z.object({
      iotEndpoint: z.string(),
      region: z.string(),
      credentials: z.object({
        accessKeyId: z.string(),
        secretAccessKey: z.string(),
        sessionToken: z.string(),
        expiration: z.string().datetime(),
      }),
      clientId: z.string(),
      caCertificate: z.string(),
      topics: z.object({
        subscribe: z.string(), // 改为字符串，不是数组
      }),
    })
  }),
  message: z.string(),
});

export type IoTCredential = z.infer<typeof CredentialResponse>['body']['body'];

export class CredentialService {
  private current: IoTCredential | null = null;
  private renewTimer: NodeJS.Timeout | null = null;

  constructor(
    private token: string,
    private secret: string,
    private endpoint: string,
    private instanceId: string,
    private renewBeforeMs: number,
    private onRenew: (cred: IoTCredential) => void,
  ) {}

  async fetch(): Promise<IoTCredential> {
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

    this.current = CredentialResponse.parse(data).body.body;
    this.scheduleRenewal();
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

    if (!this.current) return;

    const expiry = new Date(this.current.credentials.expiration).getTime();
    const delay = Math.max(expiry - Date.now() - this.renewBeforeMs, 60_000);

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

  getCurrent(): IoTCredential | null {
    return this.current;
  }

  destroy() {
    if (this.renewTimer) {
      clearTimeout(this.renewTimer);
      this.renewTimer = null;
    }
  }
}