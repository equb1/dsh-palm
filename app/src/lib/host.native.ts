import { NativeModules, Platform } from 'react-native';

/**
 * 原生宿主服务的 JS 封装。
 *
 * 只在 Android 的原生构建里存在（`DshPalmHost`）；Expo Go / web 里没有，
 * 所以全部调用都要能安全降级——拿不到就当"这台设备不支持本机引擎"。
 */

export interface HostStatus {
  engine: 'stopped' | 'starting' | 'ready' | 'failed';
  bridge: 'stopped' | 'starting' | 'ready' | 'failed';
  port: number;
  error: string | null;
  since: number;
  /** 当前这一步（解压 / 启动引擎 / 就绪） */
  phase?: string;
  /** 0–100，-1 表示不确定 */
  progress?: number;
}

interface HostNativeModule {
  start(engineCmd: string | null, bridgeCmd: string | null, port: number): Promise<boolean>;
  stop(): Promise<boolean>;
  status(): Promise<HostStatus>;
  logs(): Promise<string[]>;
  isBatteryWhitelisted(): Promise<boolean>;
  openBatterySettings(): Promise<boolean>;
  setSafeModeNext(enabled: boolean): Promise<boolean>;
}

const native: HostNativeModule | null =
  Platform.OS === 'android' ? ((NativeModules.DshPalmHost as HostNativeModule | undefined) ?? null) : null;

/** 这台设备能不能自己起引擎 */
export const hostAvailable = native !== null;

export async function startHost(options?: {
  engineCmd?: string;
  bridgeCmd?: string;
  port?: number;
}): Promise<boolean> {
  if (!native) return false;
  return await native.start(options?.engineCmd ?? null, options?.bridgeCmd ?? null, options?.port ?? 8788);
}

export async function stopHost(): Promise<boolean> {
  if (!native) return false;
  return await native.stop();
}

export async function hostStatus(): Promise<HostStatus | null> {
  if (!native) return null;
  return await native.status();
}

export async function hostBatteryWhitelisted(): Promise<boolean | null> {
  if (!native) return null;
  try {
    return await native.isBatteryWhitelisted();
  } catch {
    return null;
  }
}

export async function openHostBatterySettings(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.openBatterySettings();
  } catch {
    return false;
  }
}

export async function setHostSafeModeNext(enabled: boolean): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.setSafeModeNext(enabled);
  } catch {
    return false;
  }
}

export async function hostLogs(): Promise<string[]> {
  if (!native) return [];
  return await native.logs();
}
