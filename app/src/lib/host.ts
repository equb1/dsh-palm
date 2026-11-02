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
  /** 当前这一步（解压 / 启动引擎 / 就绪） */
  phase?: string;
  /** 0–100，-1 表示不确定 */
  progress?: number;
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

/** 系统是否已把本应用排除在省电限制外（null = 这台设备问不到） */
export async function hostBatteryWhitelisted(): Promise<boolean | null> {
  return null;
}

/** 打开系统电池设置让用户手动放行 */
export async function openHostBatterySettings(): Promise<boolean> {
  return false;
}

/** 标记"下次启动用安全模式"（重置 profiles） */
export async function setHostSafeModeNext(_enabled: boolean): Promise<boolean> {
  return false;
}
