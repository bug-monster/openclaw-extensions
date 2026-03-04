import type { OpenClawRuntime } from './types';

let switchbotRuntime: OpenClawRuntime | null = null;

/**
 * 设置 SwitchBot 运行时
 */
export function setSwitchBotRuntime(runtime: OpenClawRuntime): void {
  switchbotRuntime = runtime;
  console.log('[SwitchBot Runtime] Runtime initialized');
}

/**
 * 获取 SwitchBot 运行时
 */
export function getSwitchBotRuntime(): OpenClawRuntime | null {
  return switchbotRuntime;
}