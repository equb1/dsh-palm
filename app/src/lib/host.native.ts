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
  /** 桥启动时吐出的 6 位配对码 */
  pairCode?: string | null;
}

interface HostNativeModule {
  start(engineCmd: string | null, bridgeCmd: string | null, port: number): Promise<boolean>;
  stop(): Promise<boolean>;
  status(): Promise<HostStatus>;
  logs(): Promise<string[]>;
  isBatteryWhitelisted(): Promise<boolean>;
  openBatterySettings(): Promise<boolean>;
  setSafeModeNext(enabled: boolean): Promise<boolean>;
  readUiCache?(): Promise<string | null>;
  writeUiCache?(json: string): Promise<boolean>;
  getInitialNotificationSession?(): Promise<string | null>;
  /** 当前有没有回合在跑（onTrimMemory 回收 proot 时用） */
  setRunActive?(active: boolean): Promise<boolean>;
  /** 充电 / WiFi 状态（智能预热用） */
  deviceConditions?(): Promise<{ charging: boolean; wifi: boolean }>;
}

const native: HostNativeModule | null =
  Platform.OS === 'android' ? ((NativeModules.DshPalmHost as HostNativeModule | undefined) ?? null) : null;

/** 这台设备能不能自己起引擎 */
export const hostAvailable = native !== null;

/** 设备条件：只有「智能预热」档用 */
export interface DeviceConditions {
  charging: boolean;
  wifi: boolean;
}

/** 告诉原生层当前有没有回合在跑；老 APK 没这个方法时静默跳过 */
export async function setHostRunActive(active: boolean): Promise<boolean> {
  if (!native?.setRunActive) return false;
  try {
    return await native.setRunActive(active);
  } catch {
    return false;
  }
}

/** 读充电 / WiFi 状态；问不到返回 null（智能预热就不会触发） */
export async function deviceConditions(): Promise<DeviceConditions | null> {
  if (!native?.deviceConditions) return null;
  try {
    const result = await native.deviceConditions();
    if (!result || typeof result.charging !== 'boolean' || typeof result.wifi !== 'boolean') return null;
    return { charging: result.charging, wifi: result.wifi };
  } catch {
    return null;
  }
}

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

export async function readHostUiCache(): Promise<string | null> {
  if (!native?.readUiCache) return null;
  try {
    return await native.readUiCache();
  } catch {
    return null;
  }
}

export async function writeHostUiCache(json: string): Promise<boolean> {
  if (!native?.writeUiCache) return false;
  try {
    return await native.writeUiCache(json);
  } catch {
    return false;
  }
}

export async function getInitialNotificationSession(): Promise<string | null> {
  if (!native?.getInitialNotificationSession) return null;
  try {
    return await native.getInitialNotificationSession();
  } catch {
    return null;
  }
}
