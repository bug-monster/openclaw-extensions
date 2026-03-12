import { z } from 'zod';

// Built-in constants
const DEFAULT_CREDENTIAL_ENDPOINT = 'https://oqwck99em8.execute-api.us-east-1.amazonaws.com/open/v1.1/iot/credential';
const DEFAULT_QOS = 1;
const DEFAULT_RENEW_BEFORE_MS = 3600000; // 1 hour renewal

export const SwitchBotConfig = z.object({
  token: z.string().min(10, 'Token must be at least 10 characters'),
  secret: z.string().min(10, 'Secret must be at least 10 characters'),
  monitorDeviceMacs: z.array(z.string()).optional().default([]),
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