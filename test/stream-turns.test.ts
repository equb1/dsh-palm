import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionDetail, Turn } from '../app/src/protocol';
import {
  canonicalBlockId,
  canonicalRunId,
  canonicalTurnId,
  findRunTurnIndex,
  liveBlockId,
  mergeLiveTurn,
  normalizeTurns,
  sameBlock,
} from '../app/src/protocol/turns';
import { Store } from '../app/src/state/store';
import { projectRecords, type RealRecord } from '../engine/src/real/project';

function assistant(overrides: Partial<Turn> = {}): Turn {
  return {
    id: 'turn-1',
    runId: 'turn:1',
    role: 'assistant',
    createdAt: 1,
    status: 'streaming',
    blocks: [],
    ...overrides,
  };
}

function setupStore(turns: Turn[], status: SessionDetail['status'] = 'running'): {
  store: Store;
  feed: (name: string, data: unknown) => void;
} {
  const store = new Store();
  const detail: SessionDetail = {
    id: 'session-1',
    title: '测试会话',
    presetId: 'standard',
    workspaceId: 'ws',
    hostId: 'host',
    status,
    updatedAt: 10,
    unread: 0,
    preview: '',
    turns,
    contract: { tools: [], net: 'allow' },
  };
  (store as unknown as { patch: (next: unknown) => void }).patch({
    detail,
    currentId: 'session-1',
    sessions: [
      {
        id: 'session-1',
        title: '测试会话',
        presetId: 'standard',
        workspaceId: 'ws',
        hostId: 'host',
        status: 'running',
        updatedAt: 10,
        unread: 0,
        preview: '',
      },
    ],
  });
  const feed = (name: string, data: unknown): void => {
    (store as unknown as { applyEvent: (event: string, payload: unknown) => void }).applyEvent(name, data);
  };
  return { store, feed };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test('canonical run/turn/block id 使用同一套 turn:<n> 身份', () => {
  const runId = canonicalRunId(7, 'attempt-x');
  assert.equal(runId, 'turn:7');
  assert.equal(canonicalRunId(undefined, 'attempt-x'), 'attempt-x');
  assert.equal(canonicalTurnId(runId!), 'turn-turn:7');
  assert.equal(canonicalBlockId(runId!, 2), 'turn:7:b2');
  assert.notEqual(liveBlockId(runId!, 1, 0), liveBlockId(runId!, 2, 0));
  assert.equal(liveBlockId(runId!, 2, 0), 'turn:7:live:2:b0');
});

test('快照投影为 assistant 使用 canonical turn id，活跃会话不把未结束回合标 done', () => {
  const records = [
    {
      event: {
        type: 'user/message',
        time: 1,
        data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '开始' }] },
      },
    },
    {
      event: {
        type: 'assistant/message',
        time: 2,
        data: {
          turn: 7,
          message: {
            id: 'message-7',
            content: [
              { type: 'reasoning', text: '先分析一下这个问题，再给结论' },
              { type: 'text', text: '分析中' },
            ],
          },
        },
      },
    },
  ] as RealRecord[];

  const finished = projectRecords(records);
  const active = projectRecords(records, { finalizeUnfinished: false });
  const turn = active.turns[1]!;

  assert.equal(finished.turns[1]!.status, 'done');
  assert.equal(turn.status, 'streaming');
  assert.equal(turn.runId, 'turn:7');
  assert.equal(turn.id, canonicalTurnId('turn:7'));
  assert.deepEqual(
    turn.blocks.map((block) => block.id),
    [canonicalBlockId('turn:7', 0), canonicalBlockId('turn:7', 1)],
  );
});

test('同 run 的快照前缀与实时全文合并为一个 thinking，并用实时 turn id', () => {
  const snapshot = assistant({
    id: 'snapshot-id',
    runId: 'turn:42',
    blocks: [
      {
        kind: 'thinking',
        id: 'turn:42:b0',
        text: '先分析一下这个问题的根因，然后给出处理方案，',
      },
    ],
  });
  const live = assistant({
    id: canonicalTurnId('turn:42'),
    runId: 'turn:42',
    blocks: [
      {
        kind: 'thinking',
        id: 'turn:42:b0',
        text: '先分析一下这个问题的根因，然后给出处理方案，最后再做回归验证。',
      },
      { kind: 'text', id: 'turn:42:b1', text: '结论如下' },
    ],
  });

  const turns = mergeLiveTurn([snapshot], live);
  const thinkingBlocks = turns[0]!.blocks.filter((block) => block.kind === 'thinking');
  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.id, live.id);
  assert.equal(thinkingBlocks.length, 1);
  assert.equal(
    thinkingBlocks[0]!.kind === 'thinking' ? thinkingBlocks[0]!.text : '',
    live.blocks[0]!.kind === 'thinking' ? live.blocks[0]!.text : '',
  );
});

test('不同 run 同时 streaming 也绝不合并', () => {
  const first = assistant({
    id: 'turn-a',
    runId: 'run:a',
    blocks: [{ kind: 'text', id: 'a1', text: 'A 正在输出一段足够长的内容' }],
  });
  const second = assistant({
    id: 'turn-b',
    runId: 'run:b',
    blocks: [{ kind: 'text', id: 'b1', text: 'B 正在输出一段足够长的内容' }],
  });

  const turns = normalizeTurns([first, second]);
  assert.equal(turns.length, 2);
  assert.equal(turns[0]!.runId, 'run:a');
  assert.equal(turns[1]!.runId, 'run:b');
});

test('旧宿主没有 runId 时才允许按内容前缀兜底', () => {
  const oldPart = {
    kind: 'thinking' as const,
    id: 'old-a',
    text: '这是一段没有 run 标识的旧思考内容，先记录前面的部分，',
  };
  const newPart = {
    kind: 'thinking' as const,
    id: 'old-b',
    text: '这是一段没有 run 标识的旧思考内容，先记录前面的部分，再补上后面的内容。',
  };
  assert.equal(sameBlock(oldPart, newPart), true);
  const turns = normalizeTurns([
    assistant({ id: 'old-1', runId: undefined, blocks: [oldPart] }),
    assistant({ id: 'old-2', runId: undefined, blocks: [newPart] }),
  ]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.blocks.length, 1);
  assert.equal(turns[0]!.blocks[0]!.kind === 'thinking' ? turns[0]!.blocks[0]!.text : '', newPart.text);
});

test('findRunTurnIndex 只收口指定 run，不误改已完成的旧回合', () => {
  const old = assistant({
    id: 'old',
    runId: 'run:old',
    status: 'done',
    blocks: [{ kind: 'text', id: 'old-b', text: '旧回答' }],
  });
  const active = assistant({
    id: 'active',
    runId: 'run:active',
    status: 'streaming',
    blocks: [{ kind: 'text', id: 'active-b', text: '新回答' }],
  });
  assert.equal(findRunTurnIndex([old, active], 'run:active'), 1);
  assert.equal(findRunTurnIndex([old, active], 'run:missing'), -1);
});

test('block.delta 使用 chunk 拼接并只替换活跃 turn/block 引用', async () => {
  const stable: Turn = {
    id: 'user-1',
    role: 'user',
    createdAt: 1,
    status: 'done',
    blocks: [{ kind: 'text', id: 'user-b', text: '问题' }],
  };
  const active = assistant({
    id: 'turn-active',
    runId: 'turn:9',
    createdAt: 2,
    blocks: [{ kind: 'text', id: 'active-b', text: '答案' }],
  });
  const { store, feed } = setupStore([stable, active]);
  const before = store.getSnapshot().detail!;
  const stableTurnRef = before.turns[0];
  const stableBlockRef = before.turns[0]!.blocks[0];

  for (const text of [' A', ' B', ' C']) {
    feed('block.delta', {
      sessionId: 'session-1',
      runId: 'turn:9',
      turnId: active.id,
      blockId: 'active-b',
      op: 'append',
      text,
    });
  }
  await flushMicrotasks();

  const after = store.getSnapshot().detail!;
  assert.equal(after.turns[0], stableTurnRef);
  assert.equal(after.turns[0]!.blocks[0], stableBlockRef);
  assert.notEqual(after.turns[1], before.turns[1]);
  assert.equal(
    after.turns[1]!.blocks[0]!.kind === 'text' ? after.turns[1]!.blocks[0]!.text : '',
    '答案 A B C',
  );

  feed('block.delta', {
    sessionId: 'session-1',
    turnId: active.id,
    blockId: 'active-b',
    op: 'replace',
    text: '最终答案',
  });
  const replaced = store.getSnapshot().detail!;
  assert.equal(
    replaced.turns[1]!.blocks[0]!.kind === 'text' ? replaced.turns[1]!.blocks[0]!.text : '',
    '最终答案',
  );
});

test('数万 delta 进入 chunk 缓冲后一次 flush 文本与直接拼接一致', async () => {
  const active = assistant({
    id: 'active',
    runId: 'run:long',
    blocks: [{ kind: 'text', id: 'long-b', text: '' }],
  });
  const { store, feed } = setupStore([active]);
  const chunks = Array.from({ length: 20_000 }, (_, index) => (index % 3 === 0 ? '思考' : 'x'));
  for (const text of chunks) {
    feed('block.delta', {
      sessionId: 'session-1',
      turnId: 'active',
      blockId: 'long-b',
      op: 'append',
      text,
    });
  }
  await flushMicrotasks();

  const block = store.getSnapshot().detail!.turns[0]!.blocks[0]!;
  assert.equal(block.kind === 'text' ? block.text : '', chunks.join(''));
});

test('重复 block.appended 不会产生第二份回合或 block', () => {
  const active = assistant({
    id: 'active',
    runId: 'run:dup',
    blocks: [{ kind: 'thinking', id: 'think', text: '先分析一下这个问题，再给结论。' }],
  });
  const { store, feed } = setupStore([]);
  feed('block.appended', { sessionId: 'session-1', turn: active });
  feed('block.appended', { sessionId: 'session-1', turn: active });
  const detail = store.getSnapshot().detail!;
  assert.equal(detail.turns.length, 1);
  assert.equal(detail.turns[0]!.blocks.length, 1);
});

test('run.finished 按 runId 收尾目标回合，列表与详情一起回到 idle', async () => {
  const old = assistant({
    id: 'old',
    runId: 'run:old',
    status: 'done',
    blocks: [{ kind: 'text', id: 'old-b', text: '旧回答' }],
  });
  const active = assistant({
    id: 'active',
    runId: 'run:active',
    status: 'streaming',
    blocks: [{ kind: 'text', id: 'active-b', text: '新回答' }],
  });
  const { store, feed } = setupStore([old, active]);
  feed('block.delta', {
    sessionId: 'session-1',
    turnId: 'active',
    blockId: 'active-b',
    op: 'append',
    text: '收尾',
  });
  feed('run.finished', {
    sessionId: 'session-1',
    runId: 'run:active',
    reason: 'done',
    preview: '新回答收尾',
  });
  await flushMicrotasks();

  const state = store.getSnapshot();
  assert.equal(state.detail!.turns[0]!.status, 'done');
  assert.equal(state.detail!.turns[1]!.status, 'done');
  assert.equal(state.detail!.status, 'idle');
  assert.equal(state.sessions[0]!.status, 'idle');
  assert.equal(
    state.detail!.turns[1]!.blocks[0]!.kind === 'text' ? state.detail!.turns[1]!.blocks[0]!.text : '',
    '新回答收尾',
  );
});

test('run.finished 的模型错误进 ChatScreen 横幅，而不是只剩回合“出错”', async () => {
  const active = assistant({
    id: 'active',
    runId: 'run:active',
    status: 'streaming',
    blocks: [{ kind: 'text', id: 'active-b', text: '' }],
  });
  const { store, feed } = setupStore([active]);
  feed('run.finished', {
    sessionId: 'session-1',
    runId: 'run:active',
    reason: 'error',
    error: 'API Key 无效或没有权限（401）：检查 Key、Base URL 和模型权限。',
  });
  await flushMicrotasks();
  assert.equal(
    store.getSnapshot().error,
    'API Key 无效或没有权限（401）：检查 Key、Base URL 和模型权限。',
  );

  // 英文 429 也要翻成中文横幅，而不是原始的 HTTP 报文
  feed('run.finished', {
    sessionId: 'session-1',
    runId: 'run:active',
    reason: 'error',
    error: 'HTTP 429 Too Many Requests',
  });
  await flushMicrotasks();
  assert.match(store.getSnapshot().error ?? '', /限流/);
});

test('block.updated 不修改旧 detail 数组，并标记文本 block done', () => {
  const active = assistant({
    id: 'active',
    runId: 'run:active',
    blocks: [{ kind: 'text', id: 'active-b', text: '半段' }],
  });
  const { store, feed } = setupStore([active]);
  const before = store.getSnapshot().detail!;
  feed('block.updated', {
    sessionId: 'session-1',
    turnId: active.id,
    block: { kind: 'text', id: 'active-b', text: '完整答案' },
  });
  const after = store.getSnapshot().detail!;
  assert.notEqual(after.turns, before.turns);
  const block = after.turns[0]!.blocks[0]!;
  assert.equal(block.kind === 'text' ? block.text : '', '完整答案');
  assert.equal(block.kind === 'text' ? block.done : false, true);
  assert.equal(
    before.turns[0]!.blocks[0]!.kind === 'text' ? before.turns[0]!.blocks[0]!.text : '',
    '半段',
  );
});
