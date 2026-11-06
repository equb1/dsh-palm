import assert from 'node:assert/strict';
import test from 'node:test';

import type { Block, Turn } from '../app/src/protocol';
import { canonicalTurnId } from '../app/src/protocol/turns';
import {
  mergeAssistantContent,
  projectRecords,
  readContent,
  type RealRecord,
} from '../engine/src/real/project';

function user(content: string, time = 1): RealRecord {
  return {
    event: {
      type: 'user/message',
      time,
      data: { id: `u-${time}`, source: { kind: 'user' }, content: [{ type: 'text', text: content }] },
    },
  };
}

function assistant(
  turn: number,
  content: unknown,
  extra: Record<string, unknown> = {},
  time = 2,
): RealRecord {
  return {
    event: {
      type: 'assistant/message',
      time,
      data: {
        turn,
        step: 1,
        message: { id: `msg-${turn}`, role: 'assistant', content },
        ...extra,
      },
    },
  };
}

test('非流式 assistant/message 投影正文、思考、工具调用、usage 与 turn 收尾', () => {
  const records: RealRecord[] = [
    user('帮我看看目录'),
    assistant(
      7,
      [
        { type: 'reasoning', text: '先确认路径。' },
        { type: 'text', text: '目录如下。' },
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'bash',
          input: { command: 'ls -la' },
        },
      ],
      {
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          cacheReadTokens: 3,
          totalTokens: 21,
        },
      },
    ),
    {
      event: {
        type: 'turn/end',
        time: 3,
        data: { turn: 7, reason: { kind: 'completed' } },
      },
    },
  ];

  const projection = projectRecords(records);
  assert.equal(projection.turns.length, 2);
  const turn = projection.turns[1]!;
  assert.equal(turn.status, 'done');
  assert.equal(turn.runId, 'turn:7');
  assert.equal(turn.id, canonicalTurnId('turn:7'));
  assert.deepEqual(turn.usage, { inputTokens: 11, outputTokens: 7 });
  assert.deepEqual(
    turn.blocks.map((block) => block.kind),
    ['thinking', 'text', 'tool'],
  );
  assert.equal(turn.blocks[0]!.kind === 'thinking' ? turn.blocks[0]!.text : '', '先确认路径。');
  assert.equal(turn.blocks[1]!.kind === 'text' ? turn.blocks[1]!.text : '', '目录如下。');
  const tool = turn.blocks[2]!;
  assert.equal(tool.kind === 'tool' ? tool.callId : '', 'call-1');
  assert.equal(tool.kind === 'tool' ? tool.name : '', 'bash');
  assert.equal(tool.kind === 'tool' ? tool.summary : '', 'ls -la');
  assert.equal(tool.kind === 'tool' ? tool.state : '', 'running');
});

test('最终 assistant/message 覆盖同一步骤的流式 delta，不重复也不丢块', () => {
  const runId = 'turn:9';
  const turn: Turn = {
    id: canonicalTurnId(runId),
    runId,
    role: 'assistant',
    createdAt: 1,
    status: 'streaming',
    blocks: [
      { kind: 'thinking', id: `${runId}:live:1:b0`, text: '先看' },
      { kind: 'text', id: `${runId}:live:1:b1`, text: '答' },
    ],
  };
  const streamBlockIds = new Map<number, string>([
    [0, `${runId}:live:1:b0`],
    [1, `${runId}:live:1:b1`],
  ]);

  const merged = mergeAssistantContent(
    turn,
    [
      { type: 'reasoning', text: '先看一下目录结构。' },
      { type: 'text', text: '答案是完整的。' },
    ],
    {
      textBlockId: (index) => `${runId}:b${index}`,
      streamBlockIds,
      markDone: true,
    },
  );

  assert.equal(merged.appended.length, 0);
  assert.equal(turn.blocks.length, 2);
  assert.equal(turn.blocks[0]!.kind === 'thinking' ? turn.blocks[0]!.text : '', '先看一下目录结构。');
  assert.equal(turn.blocks[1]!.kind === 'text' ? turn.blocks[1]!.text : '', '答案是完整的。');
  assert.equal(turn.blocks[0]!.kind === 'thinking' ? turn.blocks[0]!.done : false, true);
  assert.equal(turn.blocks[1]!.kind === 'text' ? turn.blocks[1]!.done : false, true);

  // 同一份最终文本再来一次不应追加块（事件去重之外的幂等兜底）
  const again = mergeAssistantContent(
    turn,
    [
      { type: 'reasoning', text: '先看一下目录结构。' },
      { type: 'text', text: '答案是完整的。' },
    ],
    { textBlockId: (index) => `${runId}:b${index}`, streamBlockIds, markDone: true },
  );
  assert.equal(again.appended.length, 0);
  assert.equal(turn.blocks.length, 2);
});

test('重复 assistant/message 与重复 turn/end 不产生第二份回合或 block', () => {
  const duplicate = assistant(
    12,
    [{ type: 'text', text: '只应该出现一次' }],
    { usage: { inputTokens: 3, outputTokens: 4 } },
  );
  (duplicate.event as { seq?: number }).seq = 88;
  const repeated = JSON.parse(JSON.stringify(duplicate)) as RealRecord;

  const records: RealRecord[] = [
    user('重复事件'),
    duplicate,
    repeated,
    { event: { type: 'turn/end', time: 4, data: { turn: 12, reason: { kind: 'completed' } } } },
    { event: { type: 'turn/end', time: 5, data: { turn: 12, reason: { kind: 'completed' } } } },
  ];

  const projection = projectRecords(records);
  assert.equal(projection.turns.length, 2);
  const turn = projection.turns[1]!;
  assert.equal(turn.status, 'done');
  assert.equal(turn.blocks.length, 1);
  assert.equal(turn.blocks[0]!.kind === 'text' ? turn.blocks[0]!.text : '', '只应该出现一次');
  assert.deepEqual(turn.usage, { inputTokens: 3, outputTokens: 4 });
});

test('工具调用与结果按 callId 对齐，tool/call 和 assistant 内容不重复', () => {
  const records: RealRecord[] = [
    user('跑个命令'),
    {
      event: {
        type: 'tool/call',
        time: 2,
        data: { turn: 4, step: 1, callId: 'call-9', name: 'bash', arguments: '{"command":"echo hi"}' },
      },
    },
    assistant(
      4,
      [
        { type: 'text', text: '执行完成。' },
        { type: 'tool-call', toolCallId: 'call-9', toolName: 'bash', input: { command: 'echo hi' } },
      ],
      {},
      3,
    ),
    {
      event: {
        type: 'tool/result',
        time: 4,
        data: {
          turn: 4,
          step: 1,
          message: {
            role: 'tool',
            toolCallId: 'call-9',
            content: [{ type: 'text', text: 'hi' }],
            isError: false,
          },
        },
      },
    },
    { event: { type: 'turn/end', time: 5, data: { turn: 4, reason: { kind: 'completed' } } } },
  ];

  const turn = projectRecords(records).turns[1]!;
  const tools = turn.blocks.filter(
    (block): block is Extract<Block, { kind: 'tool' }> => block.kind === 'tool',
  );
  assert.equal(tools.length, 1);
  assert.equal(tools[0]!.callId, 'call-9');
  assert.equal(tools[0]!.state, 'done');
  assert.equal(tools[0]!.detail, 'hi');
  assert.equal(turn.blocks.some((block) => block.kind === 'text' && block.text === '执行完成。'), true);
});

test('tool/result 的字符串正文也能回填，缺失/空 content 不造空块', () => {
  const records: RealRecord[] = [
    user('空内容'),
    assistant(5, []),
    {
      event: {
        type: 'assistant/message',
        time: 3,
        data: {
          turn: 5,
          step: 1,
          message: { id: 'msg-5-usage', role: 'assistant', content: '' },
          usage: { inputTokens: 2, outputTokens: 0 },
        },
      },
    },
    { event: { type: 'turn/end', time: 4, data: { turn: 5, reason: { kind: 'completed' } } } },
  ];

  const turn = projectRecords(records).turns[1]!;
  assert.equal(turn.status, 'done');
  assert.equal(turn.blocks.length, 0);
  assert.deepEqual(turn.usage, { inputTokens: 2, outputTokens: 0 });
});

test('空 assistant/message 不会清掉已流式拼出的正文', () => {
  const runId = 'turn:6';
  const turn: Turn = {
    id: canonicalTurnId(runId),
    runId,
    role: 'assistant',
    createdAt: 1,
    status: 'streaming',
    blocks: [{ kind: 'text', id: `${runId}:live:1:b0`, text: '已经流出来的正文' }],
  };

  const merged = mergeAssistantContent(turn, [], {
    textBlockId: (index) => `${runId}:b${index}`,
    streamBlockIds: new Map([[0, `${runId}:live:1:b0`]]),
    markDone: true,
  });

  assert.equal(merged.appended.length, 0);
  assert.equal(turn.blocks.length, 1);
  assert.equal(turn.blocks[0]!.kind === 'text' ? turn.blocks[0]!.text : '', '已经流出来的正文');
});

test('内容读取支持字符串正文与常见 tool-call 变体', () => {
  assert.deepEqual(readContent('纯文本'), [{ index: 0, kind: 'text', text: '纯文本' }]);
  const entries = readContent([
    { type: 'toolCall', toolCallId: 'a', toolName: 'read_file', input: { path: '/tmp/a' } },
    { type: 'tool_use', id: 'b', name: 'bash', input: { command: 'pwd' } },
  ]);
  assert.deepEqual(
    entries.map((entry) => [entry.kind, entry.callId, entry.name, entry.summary]),
    [
      ['tool', 'a', 'read_file', '/tmp/a'],
      ['tool', 'b', 'bash', 'pwd'],
    ],
  );
});
