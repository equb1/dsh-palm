/**
 * 确定性长流回放：不依赖真机或模型，验证快照/实时合并、chunk 拼接和收尾。
 *
 *   node --import tsx scripts/stream-replay.ts [delta数]
 */
import assert from 'node:assert/strict';

import type { SessionDetail, Turn } from '../app/src/protocol';
import { mergeLiveTurn } from '../app/src/protocol/turns';
import { Store } from '../app/src/state/store';

function setupStore(): { store: Store; feed: (name: string, data: unknown) => void } {
  const store = new Store();
  const detail: SessionDetail = {
    id: 'replay-session',
    title: '长流回放',
    presetId: 'standard',
    workspaceId: 'ws',
    hostId: 'host-real-dsh',
    status: 'running',
    updatedAt: 1,
    unread: 0,
    preview: '',
    turns: [],
    contract: { tools: [], net: 'allow' },
  };
  (store as unknown as { patch: (next: unknown) => void }).patch({
    detail,
    currentId: detail.id,
    sessions: [
      {
        id: detail.id,
        title: detail.title,
        presetId: detail.presetId,
        workspaceId: detail.workspaceId,
        hostId: detail.hostId,
        status: 'running',
        updatedAt: 1,
        unread: 0,
        preview: '',
      },
    ],
  });
  return {
    store,
    feed: (name, data) => {
      (store as unknown as { applyEvent: (event: string, payload: unknown) => void }).applyEvent(
        name,
        data,
      );
    },
  };
}

async function main(): Promise<void> {
  const deltaCount = Math.max(1, Number(process.argv[2] ?? 20_000));
  const startedAt = Date.now();
  const { store, feed } = setupStore();

  const user: Turn = {
    id: 'u-1',
    role: 'user',
    createdAt: 1,
    status: 'done',
    blocks: [{ kind: 'text', id: 'u-1-b', text: '跑一个长任务' }],
  };
  const snapshot: Turn = {
    id: 'turn-turn:1',
    runId: 'turn:1',
    role: 'assistant',
    createdAt: 2,
    status: 'streaming',
    blocks: [
      {
        kind: 'thinking',
        id: 'turn:1:b0',
        text: '先分析一下这个长任务的根因，再决定从哪里开始改，',
      },
    ],
  };
  const live: Turn = {
    ...snapshot,
    blocks: [
      {
        kind: 'thinking',
        id: 'turn:1:b0',
        text: '先分析一下这个长任务的根因，再决定从哪里开始改，最后做回归验证。',
      },
      { kind: 'text', id: 'turn:1:b1', text: '' },
    ],
  };

  feed('block.appended', { sessionId: 'replay-session', turn: user });
  feed('run.started', { sessionId: 'replay-session', runId: 'turn:1', turnId: live.id });
  feed('block.appended', { sessionId: 'replay-session', runId: 'turn:1', turn: snapshot });
  feed('block.appended', { sessionId: 'replay-session', runId: 'turn:1', turn: live });

  const chunks = Array.from({ length: deltaCount }, (_, index) =>
    index % 7 === 0 ? `${index}\n` : 'x',
  );
  for (const text of chunks) {
    feed('block.delta', {
      sessionId: 'replay-session',
      runId: 'turn:1',
      turnId: live.id,
      blockId: 'turn:1:b1',
      op: 'append',
      text,
    });
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  let detail = store.getSnapshot().detail!;
  assert.equal(detail.turns.length, 2, '用户回合 + 一个 assistant 回合');
  assert.equal(detail.turns[1]!.runId, 'turn:1');
  assert.equal(
    detail.turns[1]!.blocks.filter((block) => block.kind === 'thinking').length,
    1,
    '快照前缀与实时全文只能有一份 thinking',
  );
  const textBlock = detail.turns[1]!.blocks.find((block) => block.kind === 'text');
  assert.equal(
    textBlock?.kind === 'text' ? textBlock.text : '',
    chunks.join(''),
    'chunk 拼接结果必须与直接拼接一致',
  );

  const reentered = mergeLiveTurn(detail.turns, detail.turns[1]!);
  assert.equal(reentered.length, 2, '重新打开会话不能把 live 回合追加成第二份');

  feed('run.finished', {
    sessionId: 'replay-session',
    runId: 'turn:1',
    reason: 'done',
    preview: '完成',
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  detail = store.getSnapshot().detail!;
  assert.equal(detail.status, 'idle');
  assert.equal(detail.turns[1]!.status, 'done');
  assert.equal(
    detail.turns[1]!.blocks.filter((block) => block.kind === 'text').length,
    1,
    '正文块不能重复',
  );

  const elapsed = Date.now() - startedAt;
  console.log(
    `[stream-replay] delta=${deltaCount} turns=${detail.turns.length} blocks=${detail.turns[1]!.blocks.length} elapsed=${elapsed}ms`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
