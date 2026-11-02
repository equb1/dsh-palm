/**
 * 平台能力的最小抽象（非原生端实现）。
 *
 * Store 要能在 Node 里被单测，不能直接 import react-native；
 * Metro 会优先用 platform.native.ts。
 */

export async function openUrl(_url: string): Promise<boolean> {
  return false;
}

/** App 是否在前台（决定要不要发系统通知） */
export function isAppActive(): boolean {
  return true;
}
