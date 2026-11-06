/**
 * 验证：approval.requested 事件必须在时间线里插出一个 block，
 * 否则 approvals 里有数据、界面上什么都不画（"一直没有卡片"那个 bug）。
 *
 *   node --import tsx test/approval-card.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Approval, SessionDetail } from '../app/src/protocol';
import { Store } from '../app/src/state/store';

function makeStore(): { store: Store; feed: (name: string, data: unknown) => void } {
  const store = new Store();
  // 直接调私有的事件处理器；client 留空，applyEvent 不会用到它
  const feed = (name: string, data: unknown): void => {
    (store as unknown as { applyEvent: (n: string, d: unknown) => void }).applyEvent(name, data);
  };
  const detail: SessionDetail = {
    id: 'session-1',
    title: '测试会话',
    presetId: 'standard',
    workspaceId: 'ws',
    hostId: 'host',
    status: 'running',
    updatedAt: Date.now(),
    unread: 0,
    preview: '',
    turns: [
      {
        id: 'turn-1',
        role: 'assistant',
        createdAt: Date.now(),
        status: 'streaming',
        blocks: [{ kind: 'text', id: 'b0', text: '我要确认几个信息' }],
      },
    ],
    contract: { tools: [], net: 'allow' },
  };
  (store as unknown as { patch: (n: unknown) => void }).patch({ detail, currentId: 'session-1' });
  return { store, feed };
}

function question(id: string): Approval {
  return {
    id,
    sessionId: 'session-1',
    runId: '',
    createdAt: Date.now(),
    kind: 'question',
    title: '今天先做哪件事',
    summary: '今天想先做哪件事？',
    risk: 'low',
    actions: [],
    options: [{ label: '写代码' }, { label: '瘫着' }],
    questionId: 'q1',
  };
}

test('approval.requested 会往最后一个 assistant 回合插一个 approval block', () => {
  const { store, feed } = makeStore();
  feed('approval.requested', { approval: question('ev-1') });

  const detail = store.getSnapshot().detail!;
  const blocks = detail.turns.flatMap((t) => t.blocks);
  const card = blocks.find((b) => b.kind === 'approval');
  assert.ok(card, '必须插出 approval block，否则界面上没有卡片');
  assert.equal(card.kind === 'approval' ? card.approvalId : '', 'ev-1');
  assert.ok(store.getSnapshot().approvals['ev-1'], 'approvals 里也要有数据');
});

test('没有 assistant 回合时会新建一个，卡片照样能显示', () => {
  const { store, feed } = makeStore();
  (store as unknown as { patch: (n: unknown) => void }).patch({
    detail: { ...store.getSnapshot().detail!, turns: [] },
  });
  feed('approval.requested', { approval: question('ev-2') });

  const detail = store.getSnapshot().detail!;
  assert.equal(detail.turns.length, 1);
  assert.equal(detail.turns[0]!.blocks[0]!.kind, 'approval');
});

test('同一个审批不会插两次', () => {
  const { store, feed } = makeStore();
  feed('approval.requested', { approval: question('ev-3') });
  feed('approval.requested', { approval: question('ev-3') });
  const detail = store.getSnapshot().detail!;
  const cards = detail.turns.flatMap((t) => t.blocks).filter((b) => b.kind === 'approval');
  assert.equal(cards.length, 1);
});

test('approval.resolved 之后卡片数据被清掉', () => {
  const { store, feed } = makeStore();
  feed('approval.requested', { approval: question('ev-4') });
  feed('approval.resolved', { sessionId: 'session-1', approvalId: 'ev-4' });
  assert.equal(store.getSnapshot().approvals['ev-4'], undefined);
});

test('approval.resolved 之后 snapshot 留在回合里，可画只读问答卡', () => {
  const { store, feed } = makeStore();
  feed('approval.requested', { approval: question('ev-5') });
  feed('approval.resolved', {
    sessionId: 'session-1',
    approvalId: 'ev-5',
    decision: 'approve',
    by: 'user',
    selected: ['写代码'],
  });
  const block = store
    .getSnapshot()
    .detail!.turns.flatMap((turn) => turn.blocks)
    .find((item) => item.kind === 'approval' && item.approvalId === 'ev-5');
  assert.ok(block && block.kind === 'approval');
  assert.deepEqual(block.snapshot?.resolution?.selected, ['写代码']);
  assert.equal(block.snapshot?.resolution?.by, 'user');
  assert.equal(store.getSnapshot().approvals['ev-5'], undefined);
});

test('approval.resolved 缺 decision（旧完整桥）时沿用已有结果，不误判为拒绝', () => {
  const { store, feed } = makeStore();
  feed('approval.requested', { approval: question('ev-6') });
  feed('approval.resolved', {
    sessionId: 'session-1',
    approvalId: 'ev-6',
    decision: 'approve',
    by: 'user',
    selected: ['瘫着'],
  });
  feed('approval.resolved', { sessionId: 'session-1', approvalId: 'ev-6' });
  const block = store
    .getSnapshot()
    .detail!.turns.flatMap((turn) => turn.blocks)
    .find((item) => item.kind === 'approval' && item.approvalId === 'ev-6');
  assert.ok(block && block.kind === 'approval');
  assert.equal(block.snapshot?.resolution?.decision, 'approve');
  assert.deepEqual(block.snapshot?.resolution?.selected, ['瘫着']);
});

test('device.paired 会记住设备密钥（下次不用再输配对码）', async () => {
  const { store, feed } = makeStore();
  feed('device.paired', { key: 'deadbeefdeadbeef' });
  assert.equal(store.getSnapshot().deviceKey, 'deadbeefdeadbeef');

  const { loadDeviceKey, clearDeviceKey } = await import('../app/src/lib/deviceKey');
  assert.equal(await loadDeviceKey(), 'deadbeefdeadbeef');
  await clearDeviceKey();
  assert.equal(await loadDeviceKey(), null);
});