/**
 * OTA 热更新封装（expo-updates）。
 *
 * - 开发构建 / Expo Go / web 上没有 expo-updates，所有调用都要能安全降级；
 * - release 安装包里 updates.url 指向 EAS Update（app.json + AndroidManifest）；
 * - 只改 JS / TS / 图片可以热更新；改 Kotlin、权限、原生依赖必须提升
 *   runtimeVersion 并重新打 APK。
 */
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

export interface UpdateRuntimeInfo {
  supported: boolean;
  enabled: boolean;
  isEmbeddedLaunch: boolean;
  updateId: string | null;
  createdAt: Date | null;
  runtimeVersion: string | null;
  channel: string | null;
  checkAutomatically: string | null;
  appVersion: string | null;
}

export interface UpdateCheckSummary {
  available: boolean;
  updateId?: string;
  createdAt?: string;
}

export interface UpdateFetchSummary {
  downloaded: boolean;
  updateId?: string;
  createdAt?: string;
  rolledBack: boolean;
}

function unsupported(): UpdateRuntimeInfo {
  return {
    supported: false,
    enabled: false,
    isEmbeddedLaunch: true,
    updateId: null,
    createdAt: null,
    runtimeVersion: null,
    channel: null,
    checkAutomatically: null,
    appVersion: null,
  };
}

export function updateRuntimeInfo(): UpdateRuntimeInfo {
  if (Platform.OS === 'web') return unsupported();
  try {
    const manifest = Updates.manifest as
      | { extra?: { expoClient?: { version?: string } } }
      | null
      | undefined;
    return {
      supported: true,
      enabled: Boolean(Updates.isEnabled),
      isEmbeddedLaunch: Boolean(Updates.isEmbeddedLaunch),
      updateId: Updates.updateId ?? null,
      createdAt: Updates.createdAt ?? null,
      runtimeVersion: Updates.runtimeVersion ?? null,
      channel: Updates.channel ?? null,
      checkAutomatically: Updates.checkAutomatically ?? null,
      appVersion: manifest?.extra?.expoClient?.version ?? null,
    };
  } catch {
    return unsupported();
  }
}

function manifestMeta(manifest: unknown): { updateId?: string; createdAt?: string } {
  const value = manifest as { id?: unknown; createdAt?: unknown } | null | undefined;
  return {
    ...(typeof value?.id === 'string' ? { updateId: value.id } : {}),
    ...(typeof value?.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
  };
}

/** 有没有新版本（只查询，不下载） */
export async function checkForUpdate(): Promise<UpdateCheckSummary> {
  const info = updateRuntimeInfo();
  if (!info.supported) throw new Error('web 上没有 OTA 热更新');
  if (!info.enabled) {
    throw new Error('当前安装包没有启用热更新（开发构建 / Expo Go 不支持，请安装 release 包）');
  }
  const result = await Updates.checkForUpdateAsync();
  if (!result.isAvailable) return { available: false };
  return {
    available: true,
    ...manifestMeta(result.manifest),
  };
}

/** 下载新版本；不会立刻重启 */
export async function downloadUpdate(): Promise<UpdateFetchSummary> {
  const info = updateRuntimeInfo();
  if (!info.supported) throw new Error('web 上没有 OTA 热更新');
  if (!info.enabled) throw new Error('当前安装包没有启用热更新');
  const result = await Updates.fetchUpdateAsync();
  if (result.isRollBackToEmbedded) {
    return { downloaded: false, rolledBack: true };
  }
  if (result.isNew === false) return { downloaded: false, rolledBack: false };
  return {
    downloaded: true,
    rolledBack: false,
    ...manifestMeta(result.manifest),
  };
}

/** 重启并应用已下载的更新 */
export async function reloadWithUpdate(): Promise<void> {
  await Updates.reloadAsync();
}

export function updateFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (!raw) return '检查更新失败';
  if (/network|fetch|timeout|ECONN|ENOTFOUND|Failed to fetch/i.test(raw)) {
    return '连不上热更新服务器：确认电脑已运行 npm run update:server，手机和电脑在同一 Wi-Fi。';
  }
  if (/disabled|development|Expo Go/i.test(raw)) {
    return '当前安装包没有启用热更新：开发构建需要重新安装 release 包。';
  }
  if (/runtime/i.test(raw)) {
    return '安装包的 runtimeVersion 与服务器更新不一致：需要重新打包（原生改动必须换 runtimeVersion）。';
  }
  return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
}
