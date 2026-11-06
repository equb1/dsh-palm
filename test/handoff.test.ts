/**
 * Handoff v1 纯函数测试：摘要、最近 8 条、已完成/未执行、确定性 id、seed、合并。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildHandoff,
  buildReplayFromHistory,
  buildReplayFromTurns,
  buildReverseSeedText,
  buildSeedText,
  detailHasSeedMarker,
  HANDOFF_VERSION,
  handoffIdFromSeed,
  logicalIdFor,
  mergeDetail,
  parseHandoffReplay,
  physicalIdFor,
  replayToHistory,
  replayToTurns,
  seedMarkerFor,
  stripEngineNoticeTurns,
  truncateTurns,
  turnDetailToHistory,
  type ConversationLink,
  type HandoffHistoryMessage,
} from '../app/src/lib/handoff';
import type { SessionDetail, Turn } from '../app/src/protocol';

const CONVERSATION = 's_light_1';

function historyWithTools(): HandoffHistoryMessage[] {
  return [
    { role: 'user', content: '把报告整理一下' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_read',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"uploads/report.docx"}' },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: 'call_read',
      name: 'read_file',
      content: '/workspace/uploads/report.docx（共 20 行）\n...',
    },
    {
      role: 'assistant',
      content: '读完了',
    },
    { role: 'user', content: '再导出成 docx' },
  ];
}

function link(): ConversationLink {
  return {
    id: CONVERSATION,
    lightSessionId: CONVERSATION,
    fullSessionId: 's_full_1',
    title: '报告整理',
    presetId: 'light',
    activeSide: 'full',
    status: 'active',
    handoffId: 'h_test',
    seedMarker: '[dsh-handoff:h_test]',
    updatedAt: 1,
  };
}

function baseDetail(id: string, turns: Turn[]): SessionDetail {
  return {
    id,
    title: '报告整理',
    presetId: 'light',
    workspaceId: 'local',
    hostId: 'host',
    status: 'idle',
    updatedAt: 10,
    unread: 0,
    preview: '',
    turns,
    contract: { tools: [], net: 'allow' },
  };
}

describe('Handoff · 纯函数', () => {
  it('最近 8 条：超长截断，开头不留下孤立的 tool 结果', () => {
    const history: HandoffHistoryMessage[] = [];
    for (let i = 0; i < 6; i += 1) {
      history.push({ role: 'user', content: `问题 ${i}` });
      history.push({ role: 'assistant', content: `回答 ${i}` });
    }
    const recent = truncateTurns(history, 8);
    assert.equal(recent.length, 8);
    assert.equal(recent[0]?.role, 'user');
    assert.match(recent[recent.length - 1]?.content ?? '', /回答 5/);
    assert.notEqual(recent[0]?.role, 'tool');
  });

  it('completed 只算有结果的调用；未执行的 blocked 原样带参数', () => {
    const history = historyWithTools();
    history.push({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_write',
          type: 'function',
          function: { name: 'write_file', arguments: '{"path":"uploads/out.docx","content":"x"}' },
        },
      ],
    });
    const handoff = buildHandoff({
      conversationId: CONVERSATION,
      reason: 'capability_missing',
      presetId: 'light',
      history,
      blocked: [
        {
          callId: 'call_write',
          name: 'write_file',
          args: { path: 'uploads/out.docx', content: 'x' },
        },
      ],
      missing: ['python-docx'],
      userText: '再导出成 docx',
      now: 100,
    });
    assert.deepEqual(
      handoff.completedSteps.map((step) => step.callId),
      ['call_read'],
    );
    assert.equal(handoff.pendingIntent.blocked[0]?.callId, 'call_write');
    assert.equal(handoff.pendingIntent.blocked[0]?.args.path, 'uploads/out.docx');
    assert.deepEqual(handoff.pendingIntent.missing, ['python-docx']);
    assert.ok(handoff.fileRefs.some((file) => file.relPath === 'uploads/report.docx'));
    assert.match(handoff.summary, /用户请求：再导出成 docx/);
    assert.match(handoff.summary, /read_file/);
    assert.match(handoff.summary, /uploads\/report\.docx/);
  });

  it('handoffId / seedMarker 确定性：同输入两次完全一致', () => {
    const input = {
      conversationId: CONVERSATION,
      reason: 'capability_missing',
      presetId: 'light',
      history: historyWithTools(),
      userText: '再导出成 docx',
    };
    const first = buildHandoff({ ...input, now: 1 });
    const second = buildHandoff({ ...input, now: 999 });
    assert.equal(first.handoffId, second.handoffId);
    assert.equal(first.seedMarker, second.seedMarker);
    assert.equal(seedMarkerFor(first.handoffId), first.seedMarker);
    assert.match(first.seedMarker, /^\[dsh-handoff:h_[0-9a-f]{8}\]$/);
    assert.match(first.handoffId, /^h_[0-9a-f]{8}$/);
  });

  it('seed 文本：marker 开头、明确「不要重做已完成步骤」、不重放工具', () => {
    const handoff = buildHandoff({
      conversationId: CONVERSATION,
      reason: 'capability_missing',
      presetId: 'light',
      history: historyWithTools(),
      blocked: [{ callId: 'call_write', name: 'write_file', args: { path: 'a.txt' } }],
      userText: '再导出成 docx',
      now: 10,
    });
    const seed = buildSeedText(handoff);
    assert.ok(seed.startsWith(handoff.seedMarker), 'seed 第一行必须是 marker');
    assert.match(seed, /不要重做已完成步骤/);
    assert.match(seed, /已完成步骤/);
    assert.match(seed, /read_file/);
    assert.match(seed, /未执行的调用/);
    assert.match(seed, /call_write/);
    assert.match(seed, /再导出成 docx/);
    assert.match(seed, /uploads\/report\.docx/);
  });

  it('摘要里的用户请求 ≤500 字', () => {
    const long = '整理'.repeat(600);
    const handoff = buildHandoff({
      conversationId: CONVERSATION,
      reason: 'pre_route',
      presetId: 'light',
      history: [{ role: 'user', content: long }],
      userText: long,
      now: 1,
    });
    const ask = handoff.summary.replace(/^用户请求：/, '').split('\n')[0] ?? '';
    assert.ok(ask.length <= 500, `摘要长度 ${ask.length}`);
  });

  it('mergeDetail：轻引擎回合 + 完整引擎回合，去掉 seed 用户消息', () => {
    const light = baseDetail(CONVERSATION, [
      {
        id: 'u1',
        role: 'user',
        createdAt: 1,
        status: 'done',
        blocks: [{ kind: 'text', id: 'b1', text: '把报告整理一下' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        status: 'done',
        blocks: [{ kind: 'text', id: 'b2', text: '轻引擎回答' }],
      },
    ]);
    const marker = '[dsh-handoff:h_test]';
    const full = baseDetail('s_full_1', [
      {
        id: 'seed',
        role: 'user',
        createdAt: 3,
        status: 'done',
        blocks: [{ kind: 'text', id: 'b3', text: `${marker}\n交接说明` }],
      },
      {
        id: 'a2',
        role: 'assistant',
        createdAt: 4,
        status: 'done',
        blocks: [{ kind: 'text', id: 'b4', text: '完整引擎继续' }],
      },
    ]);
    const merged = mergeDetail(link(), light, full);
    assert.ok(merged);
    assert.equal(merged?.id, CONVERSATION);
    assert.equal(merged?.turns.length, 3);
    assert.equal(merged?.turns.some((turn) => turn.id === 'seed'), false);
    assert.match(JSON.stringify(merged?.turns), /完整引擎继续/);
    assert.equal(detailHasSeedMarker(full, marker), true);
  });

  it('mergeDetail：反向交接已重建轻引擎回合时，不再追加完整侧（避免重复）', () => {
    const marker = '[dsh-handoff:h_test]';
    const light = baseDetail(CONVERSATION, [
      {
        id: 'u1',
        role: 'user',
        createdAt: 1,
        status: 'done',
        blocks: [{ kind: 'text', id: 'b1', text: '完整侧旧问题' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        status: 'done',
        blocks: [{ kind: 'text', id: 'b2', text: '重建的完整侧回答' }],
      },
      {
        id: 'seed',
        role: 'user',
        createdAt: 3,
        status: 'done',
        blocks: [{ kind: 'text', id: 'b3', text: `${marker}\n继续` }],
      },
    ]);
    const full = baseDetail('s_full_1', [
      {
        id: 'fu1',
        role: 'user',
        createdAt: 1,
        status: 'done',
        blocks: [{ kind: 'text', id: 'fb1', text: '完整侧旧问题' }],
      },
      {
        id: 'fa1',
        role: 'assistant',
        createdAt: 2,
        status: 'done',
        blocks: [{ kind: 'text', id: 'fb2', text: '重建的完整侧回答' }],
      },
    ]);
    const reverseLink: ConversationLink = { ...link(), handoffDirection: 'full_to_light' };
    const merged = mergeDetail(reverseLink, light, full);
    assert.ok(merged);
    assert.deepEqual(merged?.turns.map((turn) => turn.id), ['u1', 'a1']);
    assert.equal(JSON.stringify(merged?.turns).match(/重建的完整侧回答/g)?.length, 1);
    assert.equal(JSON.stringify(merged?.turns).includes(marker), false);
  });

  it('mergeDetail：过滤完整引擎的 approval policy 提示，不误删真实用户消息', () => {
    const light = baseDetail(CONVERSATION, [
      {
        id: 'u1',
        role: 'user',
        createdAt: 1,
        status: 'done',
        blocks: [{ kind: 'text', id: 'b1', text: '运行 python3' }],
      },
    ]);
    const marker = '[dsh-handoff:h_test]';
    const full = baseDetail('s_full_1', [
      {
        id: 'seed',
        role: 'user',
        createdAt: 2,
        status: 'done',
        blocks: [{ kind: 'text', id: 'b2', text: `${marker}\n交接说明` }],
      },
      {
        id: 'notice',
        role: 'user',
        createdAt: 3,
        status: 'done',
        blocks: [
          {
            kind: 'text',
            id: 'b3',
            text: 'The approval policy changed from "ask" to "never" (changed by the user).',
          },
        ],
      },
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 4,
        status: 'done',
        blocks: [{ kind: 'text', id: 'b4', text: '完整引擎输出 42' }],
      },
      {
        id: 'u2',
        role: 'user',
        createdAt: 5,
        status: 'done',
        blocks: [{ kind: 'text', id: 'b5', text: '再加一页' }],
      },
    ]);
    const merged = mergeDetail(link(), light, full);
    assert.ok(merged);
    const texts = merged!.turns.map((turn) =>
      turn.blocks.map((block) => (block.kind === 'text' ? block.text : '')).join(''),
    );
    assert.equal(texts.some((text) => text.includes('approval policy changed')), false);
    assert.equal(texts.some((text) => text.includes('再加一页')), true);
    assert.equal(texts.some((text) => text.includes('完整引擎输出 42')), true);
  });

  it('stripEngineNoticeTurns：完整引擎的 policy 提示不显示，真实用户消息保留', () => {
    const user = (id: string, text: string): Turn => ({
      id,
      role: 'user',
      createdAt: 1,
      status: 'done',
      blocks: [{ kind: 'text', id: `${id}-b`, text }],
    });
    const turns: Turn[] = [
      user('u1', 'hi'),
      user('notice', 'The approval policy changed from "ask" to "never" (changed by the user).'),
      user('u2', 'please continue'),
      { id: 'a1', role: 'assistant', createdAt: 2, status: 'done', blocks: [] },
    ];
    const out = stripEngineNoticeTurns(turns);
    assert.deepEqual(out.map((turn) => turn.id), ['u1', 'u2', 'a1']);
  });

  it('turnDetailToHistory + buildHandoff：完整会话的工具结果进摘要/最近轮次', () => {
    const turns: Turn[] = [
      {
        id: 'u1',
        role: 'user',
        createdAt: 1,
        status: 'done',
        blocks: [{ kind: 'text', id: 'b1', text: '整理报告' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        status: 'done',
        blocks: [
          { kind: 'text', id: 'b2', text: '我来读文件' },
          {
            kind: 'tool',
            id: 'tool1',
            name: 'read_file',
            summary: '读取 docs/a.docx',
            state: 'done',
            detail: '正文内容',
          },
        ],
      },
      {
        id: 'u2',
        role: 'user',
        createdAt: 3,
        status: 'done',
        blocks: [{ kind: 'text', id: 'b3', text: '再导出' }],
      },
    ];
    const history = turnDetailToHistory(turns);
    assert.deepEqual(history.map((message) => message.role), ['user', 'assistant', 'tool', 'user']);
    const handoff = buildHandoff({
      conversationId: 's_full',
      reason: 'continue_in_light',
      from: { engine: 'full', sessionId: 's_full' },
      presetId: 'standard',
      history,
      turns,
    });
    assert.equal(handoff.completedSteps.length, 1);
    assert.equal(handoff.completedSteps[0]?.name, 'read_file');
    assert.match(buildReverseSeedText(handoff), /回到手机轻引擎/);
    assert.equal(buildReverseSeedText(handoff).includes(handoff.seedMarker), true);
  });

  it('结构化回放：thinking/tool 参数与结果按序生成，可解析往返', () => {
    const history: HandoffHistoryMessage[] = [
      { role: 'user', content: '整理报告' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_read',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"uploads/report.docx"}' },
          },
          {
            id: 'call_write',
            type: 'function',
            function: { name: 'write_file', arguments: '{"path":"uploads/out.docx"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_read', name: 'read_file', content: '读取成功' },
      { role: 'tool', tool_call_id: 'call_write', name: 'write_file', content: '[错误] 磁盘已满' },
      { role: 'assistant', content: '处理完成' },
    ];
    const turns: Turn[] = [
      {
        id: 'u1',
        role: 'user',
        createdAt: 1,
        status: 'done',
        blocks: [{ kind: 'text', id: 'ub1', text: '整理报告' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        status: 'done',
        blocks: [
          { kind: 'text', id: 'ab1', text: '我先读文件' },
          { kind: 'thinking', id: 'ab2', text: '需要先确认格式', done: true },
          {
            kind: 'tool',
            id: 'ab3',
            callId: 'call_read',
            name: 'read_file',
            summary: '读取 uploads/report.docx',
            state: 'done',
            detail: '读取成功',
          },
          {
            kind: 'tool',
            id: 'ab4',
            callId: 'call_write',
            name: 'write_file',
            summary: '写入 uploads/out.docx',
            state: 'error',
            detail: '[错误] 磁盘已满',
          },
        ],
      },
      {
        id: 'a2',
        role: 'assistant',
        createdAt: 3,
        status: 'done',
        blocks: [{ kind: 'text', id: 'ab5', text: '处理完成' }],
      },
    ];

    const replay = buildReplayFromTurns(turns, history);
    assert.equal(replay.source, 'light-turns');
    assert.deepEqual(replay.stats, { turns: 3, blocks: 6, tools: 2, truncated: false });
    assert.deepEqual(
      replay.turns[1]?.blocks.map((block) => block.kind),
      ['text', 'thinking', 'tool', 'tool'],
    );
    const firstTool = replay.turns[1]?.blocks[2];
    assert.equal(firstTool?.kind === 'tool' ? firstTool.arguments : '', '{"path":"uploads/report.docx"}');
    const parsed = parseHandoffReplay(replay);
    assert.ok(parsed);
    assert.deepEqual(parsed, replay);

    const rebuilt = replayToTurns(parsed);
    assert.deepEqual(rebuilt.map((turn) => turn.role), ['user', 'assistant', 'assistant']);
    const tools = rebuilt.flatMap((turn) =>
      turn.blocks.filter((block) => block.kind === 'tool'),
    );
    assert.deepEqual(
      tools.map((block) => (block.kind === 'tool' ? `${block.callId}:${block.state}` : '')),
      ['call_read:done', 'call_write:error'],
    );

    const rebuiltHistory = replayToHistory(parsed);
    assert.deepEqual(
      rebuiltHistory.map((message) => message.role),
      ['user', 'assistant', 'tool', 'tool', 'assistant'],
    );
    assert.deepEqual(
      rebuiltHistory.filter((message) => message.role === 'tool').map((message) => message.tool_call_id),
      ['call_read', 'call_write'],
    );
    assert.deepEqual(
      rebuiltHistory[1]?.tool_calls?.map((call) => call.function.name),
      ['read_file', 'write_file'],
    );
  });

  it('只有 history 时重建回放：工具结果按 callId 回填，参数不丢', () => {
    const replay = buildReplayFromHistory(historyWithTools());
    assert.equal(replay.source, 'history');
    assert.deepEqual(
      replay.turns.map((turn) => turn.role),
      ['user', 'assistant', 'assistant', 'user'],
    );
    const tool = replay.turns[1]?.blocks[0];
    assert.equal(tool?.kind, 'tool');
    if (tool?.kind === 'tool') {
      assert.equal(tool.callId, 'call_read');
      assert.equal(tool.state, 'done');
      assert.equal(tool.arguments, '{"path":"uploads/report.docx"}');
      assert.match(tool.detail ?? '', /report\.docx/);
    }
    const rebuilt = replayToHistory(replay);
    assert.deepEqual(
      rebuilt.filter((message) => message.role === 'tool').map((message) => message.tool_call_id),
      ['call_read'],
    );
  });

  it('v1 兼容：不生成 replay，seed 不含结构化回放；解析为空时安全降级', () => {
    const handoff = buildHandoff({
      conversationId: CONVERSATION,
      reason: 'capability_missing',
      presetId: 'light',
      history: historyWithTools(),
      userText: '再导出成 docx',
      version: 1,
      now: 1,
    });
    assert.equal(handoff.version, 1);
    assert.equal(handoff.replay, undefined);
    assert.equal(buildSeedText(handoff).includes('结构化回放'), false);
    assert.equal(parseHandoffReplay(handoff.replay), null);
    assert.deepEqual(replayToHistory(handoff.replay), []);
    assert.deepEqual(replayToTurns(handoff.replay), []);
  });

  it('v2 默认带结构化回放；seed 明说完整引擎只做文本降级', () => {
    const turns: Turn[] = [
      {
        id: 'u1',
        role: 'user',
        createdAt: 1,
        status: 'done',
        blocks: [{ kind: 'text', id: 'ub', text: '整理报告' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        status: 'done',
        blocks: [
          { kind: 'thinking', id: 'th', text: '先读文件', done: true },
          {
            kind: 'tool',
            id: 'tb',
            callId: 'call_read',
            name: 'read_file',
            summary: '读取 report.docx',
            state: 'done',
            detail: '正文',
          },
          { kind: 'image', id: 'img', ref: 'uploads/shot.png', mime: 'image/png' },
        ],
      },
    ];
    const handoff = buildHandoff({
      conversationId: CONVERSATION,
      reason: 'pre_route',
      presetId: 'light',
      history: historyWithTools(),
      turns,
      userText: '继续',
      now: 1,
    });
    assert.equal(handoff.version, HANDOFF_VERSION);
    assert.ok(handoff.replay);
    const seed = buildSeedText(handoff);
    assert.match(seed, /## 结构化回放/);
    assert.match(seed, /THINKING: 先读文件/);
    assert.match(seed, /TOOL read_file #call_read \[done\]/);
    assert.match(seed, /完整引擎不支持原生事件导入/);
    assert.match(handoff.replay?.unsupported.join(',') ?? '', /block:image/);
    assert.match(seed, /未回放：block:image/);
    const reverse = buildReverseSeedText(handoff);
    assert.match(reverse, /轻引擎会按结构化 turn\/block\/tool 重建上下文/);
    assert.equal(reverse.includes('完整引擎不支持原生事件导入'), false);
  });

  it('handoffIdFromSeed：旧客户端只传 text 也能拿到幂等 id', () => {
    const handoff = buildHandoff({
      conversationId: CONVERSATION,
      reason: 'pre_route',
      presetId: 'light',
      history: [{ role: 'user', content: 'hi' }],
      now: 1,
    });
    const seed = buildSeedText(handoff);
    assert.equal(handoffIdFromSeed(seed), handoff.handoffId);
    assert.equal(handoffIdFromSeed('没有 marker'), undefined);
  });

  it('logical / physical 映射：两个物理 id 都归到一条逻辑会话', () => {
    const current = link();
    assert.equal(physicalIdFor(current, 'light'), CONVERSATION);
    assert.equal(physicalIdFor(current, 'full'), 's_full_1');
    assert.equal(logicalIdFor(current, 's_full_1'), CONVERSATION);
    assert.equal(logicalIdFor(current, CONVERSATION), CONVERSATION);
    assert.equal(logicalIdFor(current, 'other'), undefined);
  });
});
