/**
 * 本地通知（非原生端的空实现）。
 * 真正的实现在 notify.native.ts；Node 里跑测试时不能加载 react-native。
 */

export const notifyAvailable = false;

/** 请求通知权限；返回当前是否已允许（Android 13+ 的结果是异步的） */
export async function ensureNotificationPermission(): Promise<boolean> {
  return false;
}

/** 发一条本地通知；tag 相同会覆盖同一条 */
export async function notifyEvent(_title: string, _body: string, _tag?: string): Promise<boolean> {
  return false;
}
