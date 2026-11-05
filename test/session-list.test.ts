/**
 * M2.6 统一会话列表（第一步）纯函数：合并、去重、排序、标 engine。
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

describe('sessions · 统一列表合并', () => {
  it('当前引擎在前，另一个引擎补在后，按 updatedAt 倒序', () => {
    const rows = mergeSessionRows(
      [session('light-new', 300), session('light-old', 100)],
      'light',
      [session('full-a', 200), session('full-b', 400)],
      'full',
    );
    assert.deepEqual(
      rows.map((row) => [row.id, row.engine]),
      [
        ['full-b', 'full'],
        ['light-new', 'light'],
        ['full-a', 'full'],
        ['light-old', 'light'],
      ],
    );
  });

  it('同 id 去重（logical link 两边都有时以当前引擎为准）', () => {
    const rows = mergeSessionRows(
      [session('s_shared', 100)],
      'light',
      [session('s_shared', 900), session('s_full_only', 50)],
      'full',
    );
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((row) => row.id === 's_shared').length, 1);
    const shared = rows.find((row) => row.id === 's_shared');
    assert.equal(shared?.engine, 'light');
    assert.equal(shared?.updatedAt, 100);
  });

  it('另一个引擎没缓存时只返回当前列表', () => {
    const rows = mergeSessionRows([session('a', 1)], 'full', undefined, 'light');
    assert.deepEqual(rows.map((row) => [row.id, row.engine]), [['a', 'full']]);
  });
});
