/**
 * 原生宿主服务的 JS 封装（非原生端的空实现）。
 *
 * 真正的实现在 `host.native.ts`（Android 原生构建里用）。
 * 这样拆是因为 Node 里跑测试时不能加载 react-native；
 * Metro 会按平台后缀优先选 `.native.ts`，Node 只认 `.ts`。
 */

export type HostState = 'stopped' | 'starting' | 'ready' | 'failed';

export interface HostStatus {
  engine: HostState;
  bridge: HostState;
  port: number;
  error: string | null;
  since: number;
}

/** 这台设备能不能自己起引擎 */
export const hostAvailable = false;

export async function startHost(_options?: {
  engineCmd?: string;
  bridgeCmd?: string;
  port?: number;
}): Promise<boolean> {
  return false;
}

export async function stopHost(): Promise<boolean> {
  return false;
}

export async function hostStatus(): Promise<HostStatus | null> {
  return null;
}

export async function hostLogs(): Promise<string[]> {
  return [];
}
