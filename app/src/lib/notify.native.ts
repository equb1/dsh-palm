import { NativeModules, Platform } from 'react-native';

/**
 * 本地通知的 JS 封装。
 *
 * 通知走原生 `DshPalmHost`（和宿主管家同一个模块），不额外装 expo-notifications：
 *  - Android 13+ 的 POST_NOTIFICATIONS 由 Activity 弹系统框申请；
 *  - 没权限时 notifyEvent 直接返回 false，不抛错。
 */
interface NotifyNative {
  requestNotificationPermission(): Promise<boolean>;
  notifyEvent(title: string, body: string, tag: string | null): Promise<boolean>;
}

const native: NotifyNative | null =
  Platform.OS === 'android' ? ((NativeModules.DshPalmHost as NotifyNative | undefined) ?? null) : null;

export const notifyAvailable = typeof native?.notifyEvent === 'function';

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!native?.requestNotificationPermission) return false;
  try {
    return await native.requestNotificationPermission();
  } catch {
    return false;
  }
}

export async function notifyEvent(title: string, body: string, tag?: string): Promise<boolean> {
  if (!native?.notifyEvent) return false;
  try {
    return await native.notifyEvent(title, body, tag ?? null);
  } catch {
    return false;
  }
}
