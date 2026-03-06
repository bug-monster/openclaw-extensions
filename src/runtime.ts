import type { OpenClawRuntime } from './types';

let switchbotRuntime: OpenClawRuntime | null = null;

/**
 * Set SwitchBot runtime
 */
export function setSwitchBotRuntime(runtime: OpenClawRuntime): void {
  switchbotRuntime = runtime;
  console.log('[SwitchBot Runtime] Runtime initialized');
}

/**
 * Get SwitchBot runtime
 */
export function getSwitchBotRuntime(): OpenClawRuntime | null {
  return switchbotRuntime;
}