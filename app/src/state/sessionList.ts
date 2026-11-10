/**
 * 统一会话列表：把手机轻引擎、手机完整引擎、电脑宿主三处来源合并成行，
 * 行上带 source，抽屉按「手机 / 电脑」分组，点击时按 source 打开。
 *
 * 纯函数，方便单测；真实列表仍以当前连接源的 `sessions.list` 为准，
 * 其他来源用上次缓存（切换前会存一份）。
 */
import type { SessionSummary } from '../protocol';

/** 协议层仍只有 light/full；UI 层用 source 区分手机与电脑 */
export type SessionSource = 'phone-light' | 'phone-proot' | 'computer';

export interface SessionRow extends SessionSummary {
  source: SessionSource;
  /** 协议层目标：本机轻 / 本机完整 / 远程电脑都走 full */
  engine: 'light' | 'full';
}

export function sourceToEngine(source: SessionSource): 'light' | 'full' {
  return source === 'phone-light' ? 'light' : 'full';
}

export function mergeSessionRows(
  current: SessionSummary[],
  currentSource: SessionSource,
  cached: Array<{ source: SessionSource; sessions: SessionSummary[] }>,
): SessionRow[] {
  const rows: SessionRow[] = [];
  const seen = new Set<string>();

  const push = (session: SessionSummary, source: SessionSource): void => {
    // 同一 source 下同一个 id 只出现一次；不同 source 允许同名 id 并存
    const key = `${source}:${session.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ ...session, source, engine: sourceToEngine(source) });
  };

  for (const session of current) push(session, currentSource);
  for (const group of cached) {
    for (const session of group.sessions) push(session, group.source);
  }
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return rows;
}
