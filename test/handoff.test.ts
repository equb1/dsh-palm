/**
 * Handoff v1 纯函数测试：摘要、最近 8 条、已完成/未执行、确定性 id、seed、合并。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildHandoff,
  buildSeedText,
  detailHasSeedMarker,
  logicalIdFor,
  mergeDetail,
  physicalIdFor,
  seedMarkerFor,
  truncateTurns,
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

  it('logical / physical 映射：两个物理 id 都归到一条逻辑会话', () => {
    const current = link();
    assert.equal(physicalIdFor(current, 'light'), CONVERSATION);
    assert.equal(physicalIdFor(current, 'full'), 's_full_1');
    assert.equal(logicalIdFor(current, 's_full_1'), CONVERSATION);
    assert.equal(logicalIdFor(current, CONVERSATION), CONVERSATION);
    assert.equal(logicalIdFor(current, 'other'), undefined);
  });
});
