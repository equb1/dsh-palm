/**
 * 会话列表纯函数：合并三个来源、排序、标 source。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeSessionRows } from '../app/src/state/sessionList';
import type { SessionSummary } from '../app/src/protocol';

function session(id: string, updatedAt: number, title = id): SessionSummary {
  return {
    id,
    title,
    presetId: 'chat',
    workspaceId: 'local',
    hostId: 'host',
    status: 'idle',
    updatedAt,
    unread: 0,
    preview: '',
  };
}

describe('sessions · 三来源合并', () => {
  it('当前来源 + 缓存来源，按 updatedAt 倒序，标 source', () => {
    const rows = mergeSessionRows(
      [session('phone-new', 300), session('phone-old', 100)],
      'phone-light',
      [
        { source: 'phone-proot', sessions: [session('proot-a', 200)] },
        { source: 'computer', sessions: [session('pc-b', 400)] },
      ],
    );
    assert.deepEqual(
      rows.map((row) => [row.id, row.source, row.engine]),
      [
        ['pc-b', 'computer', 'full'],
        ['phone-new', 'phone-light', 'light'],
        ['proot-a', 'phone-proot', 'full'],
        ['phone-old', 'phone-light', 'light'],
      ],
    );
  });

  it('同 source 同 id 去重；不同 source 允许并存', () => {
    const rows = mergeSessionRows(
      [session('s_shared', 100)],
      'phone-light',
      [
        { source: 'computer', sessions: [session('s_shared', 900)] },
        { source: 'computer', sessions: [session('s_shared', 800)] },
      ],
    );
    assert.equal(rows.filter((row) => row.source === 'phone-light').length, 1);
    assert.equal(rows.filter((row) => row.source === 'computer').length, 1);
  });

  it('其他来源没缓存时只返回当前列表', () => {
    const rows = mergeSessionRows([session('a', 1)], 'phone-proot', []);
    assert.deepEqual(rows.map((row) => [row.id, row.source]), [['a', 'phone-proot']]);
  });
});
