/** 会话抽屉的几何/手势阈值；Home 和 SessionDrawer 共用，避免两套 302 漂移 */
export const DRAWER_WIDTH = 302;
export const DRAWER_OPEN_THRESHOLD = 0.25;
export const DRAWER_CLOSE_THRESHOLD = 0.72;
export const DRAWER_OPEN_VELOCITY = 0.3;
export const DRAWER_CLOSE_VELOCITY = -0.35;

/** 手势 dx → 0..1 抽屉进度 */
export function drawerProgress(dx: number, width = DRAWER_WIDTH): number {
  if (!Number.isFinite(dx) || width <= 0) return 0;
  return Math.max(0, Math.min(1, dx / width));
}

/** 松手后是否应该打开：拉过 1/4 或向右甩 */
export function shouldOpenDrawer(progress: number, velocityX: number): boolean {
  return progress > DRAWER_OPEN_THRESHOLD || velocityX > DRAWER_OPEN_VELOCITY;
}

/** 左滑关闭：退到 72% 以下或向左甩 */
export function shouldCloseDrawer(progress: number, velocityX: number): boolean {
  return progress < DRAWER_CLOSE_THRESHOLD || velocityX < DRAWER_CLOSE_VELOCITY;
}
