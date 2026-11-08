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
  /** 桥启动时吐出的 6 位配对码 */
  pairCode?: string | null;
}

/** 这台设备能不能自己起引擎 */
export const hostAvailable = false;

/** 设备条件：只有「智能预热」档用 */
export interface DeviceConditions {
  charging: boolean;
  wifi: boolean;
}

/** M3.2：局域网里发现的一个宿主（还未配对） */
export interface DiscoveredHost {
  id: string;
  name: string;
  host: string;
  port: number;
  kind: 'phone' | 'desktop' | 'server' | string;
  fingerprint?: string;
  version?: string;
}

/** Android 16 本地网络权限；旧系统直接 true */
export async function requestLanPermission(): Promise<boolean> {
  return true;
}

/** 扫描局域网宿主；非原生端返回空列表 */
export async function discoverLanHosts(_timeoutMs?: number): Promise<DiscoveredHost[]> {
  return [];
}

export async function stopLanDiscovery(): Promise<boolean> {
  return true;
}

export async function requestPinWidget(): Promise<boolean> {
  return false;
}

export async function requestPinShortcut(): Promise<boolean> {
  return false;
}

export async function openAppSettings(): Promise<boolean> {
  return false;
}

export async function requestAddTile(): Promise<boolean> {
  return false;
}

export async function systemEntryStatus(): Promise<{
  widgetCount: number;
  overlayAllowed: boolean;
  floatingPetActive?: boolean;
} | null> {
  return null;
}

export async function isOverlayPermissionGranted(): Promise<boolean> {
  return false;
}

export async function requestOverlayPermission(): Promise<boolean> {
  return false;
}

export async function setFloatingPetEnabled(
  _enabled: boolean,
  _role?: string,
  _state?: string,
): Promise<boolean> {
  return false;
}

export async function setFloatingPetVisible(_visible: boolean): Promise<boolean> {
  return false;
}

export async function getFloatingPetStatus(): Promise<{
  isShowing: boolean;
  allowed: boolean;
  role: string;
  state: string;
} | null> {
  return null;
}

export async function captureAndShareView(_reactTag: number, _title?: string): Promise<boolean> {
  return false;
}

export async function captureAndSaveView(_reactTag: number, _title?: string): Promise<boolean> {
  return false;
}

/**
 * 告诉原生层「当前有没有回合在跑」。
 * onTrimMemory 回收 proot 时，有活跃回合就先不动（老 APK 上没有这个接口，调用会安全降级）。
 */
export async function setHostRunActive(_active: boolean): Promise<boolean> {
  return false;
}

/** 读充电 / WiFi 状态；这台设备问不到就返回 null */
export async function deviceConditions(): Promise<DeviceConditions | null> {
  return null;
}

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

/** 原生分享工作区文件；非原生端没有这个能力 */
export async function shareWorkspaceFileNative(
  _contentUri: string,
  _mime?: string | null,
  _title?: string | null,
): Promise<boolean> {
  return false;
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

const memUiCache: { value: string | null } = { value: null };

export async function readHostUiCache(): Promise<string | null> {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) return ls.getItem('dsh-palm.ui-cache');
  } catch {
    /* ignore */
  }
  return memUiCache.value;
}

export async function writeHostUiCache(json: string): Promise<boolean> {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) {
      ls.setItem('dsh-palm.ui-cache', json);
      return true;
    }
  } catch {
    /* ignore */
  }
  memUiCache.value = json;
  return true;
}

export async function getInitialNotificationSession(): Promise<string | null> {
  return null;
}
