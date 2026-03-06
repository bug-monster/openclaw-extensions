import { z } from 'zod';

// 内置常量
const DEFAULT_CREDENTIAL_ENDPOINT = 'https://oqwck99em8.execute-api.us-east-1.amazonaws.com/open/v1.1/iot/credential';
const DEFAULT_QOS = 1;
const DEFAULT_RENEW_BEFORE_MS = 3600000; // 1小时续期

export const SwitchBotConfig = z.object({
  token: z.string().min(10, 'Token 至少 10 个字符'),
  secret: z.string().min(10, 'Secret 至少 10 个字符'),
});

export type SwitchBotConfig = z.infer<typeof SwitchBotConfig> & {
  credentialEndpoint: string;
  qos: 0 | 1 | 2;
  renewBeforeMs: number;
};

export function validateConfig(config: unknown): SwitchBotConfig {
  const parsed = SwitchBotConfig.parse(config);
  return {
    ...parsed,
    credentialEndpoint: DEFAULT_CREDENTIAL_ENDPOINT,
    qos: DEFAULT_QOS,
    renewBeforeMs: DEFAULT_RENEW_BEFORE_MS,
  };
}