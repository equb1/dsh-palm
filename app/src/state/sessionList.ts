/**
 * M2.6 统一会话列表（第一步）：把两个引擎各自缓存的会话合并成一行一个，
 * 行上标 engine，点击时由 store 先切引擎再打开。
 *
 * 纯函数，方便单测；真实列表仍以当前引擎的 `sessions.list` 为准，
 * 另一个引擎用上次缓存（切引擎前会存一份）。
 */
import type { SessionSummary } from '../protocol';

export type SessionEngine = 'light' | 'full';

export interface SessionRow extends SessionSummary {
  engine: SessionEngine;
}

export function mergeSessionRows(
  current: SessionSummary[],
  currentEngine: SessionEngine,
  other: SessionSummary[] | undefined,
  otherEngine: SessionEngine,
): SessionRow[] {
  const rows: SessionRow[] = current.map((session) => ({ ...session, engine: currentEngine }));
  const seen = new Set(rows.map((row) => row.id));
  for (const session of other ?? []) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    rows.push({ ...session, engine: otherEngine });
  }
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return rows;
}
