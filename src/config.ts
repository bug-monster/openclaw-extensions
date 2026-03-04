import { z } from 'zod';

export const SwitchBotConfig = z.object({
  token: z.string().min(10, 'Token 至少 10 个字符'),
  secret: z.string().min(10, 'Secret 至少 10 个字符'),
  credentialEndpoint: z.string().url().default('https://oqwck99em8.execute-api.us-east-1.amazonaws.com/open/v1.1/iot/credential'),
  qos: z.union([z.literal(0), z.literal(1)]).default(1),
  renewBeforeMs: z.number().min(60000).max(1800000).default(300000),
});

export type SwitchBotConfig = z.infer<typeof SwitchBotConfig>;

export function validateConfig(config: unknown): SwitchBotConfig {
  return SwitchBotConfig.parse(config);
}