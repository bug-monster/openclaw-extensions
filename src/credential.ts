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
    const sign = this.computeSign(ts);

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': this.token,
        'sign': sign,
        't': ts,
        'nonce': nonce,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ instanceId: this.instanceId }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (data.statusCode !== 100) {
      throw new Error(`Credential fetch failed: ${data.message}`);
    }

    this.current = CredentialResponse.parse(data).body.body;
    this.scheduleRenewal();
    return this.current;
  }

  private computeSign(ts: string): string {
    const data = this.token + ts;
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