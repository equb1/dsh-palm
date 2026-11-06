/**
 * M2.2：轻引擎 sessions.import 的结构化回放 / 幂等 / v1 兼容测试。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { NodeBackend } from '../app/src/engine/fs/nodeBackend';
import { createDataSandbox, createWorkspaceMount } from '../app/src/engine/fs/mount';
import { ShellRunner } from '../app/src/engine/shell/bash';
import { LightHost } from '../app/src/engine/light/host';
import {
  buildHandoff,
  buildReplayFromTurns,
  buildSeedText,
  type HandoffHistoryMessage,
} from '../app/src/lib/handoff';
import type { LightModelConfig } from '../app/src/engine/light/types';
import type { Turn } from '../app/src/protocol';

const roots: string[] = [];
const MODEL: LightModelConfig = {
  baseURL: 'https://example.invalid/v1',
  apiKey: 'test-key',
  model: 'fake-model',
  providerName: 'Fake',
};

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

async function makeHost(dataRoot: string): Promise<LightHost> {
  const workspaceRoot = await tempDir('dsh-palm-handoff-ws-');
  const mount = await createWorkspaceMount({ backend: new NodeBackend({ root: workspaceRoot }) });
  const dataFs = await createDataSandbox(new NodeBackend({ root: dataRoot }));
  const shell = new ShellRunner({ fs: mount.fs, beforeRun: () => mount.workspace.refreshIndex() });
  const host = new LightHost({
    workspace: mount.workspace,
    shell,
    dataFs,
    model: MODEL,
    maxSteps: 1,
  });
  await host.ready();
  return host;
}

function turnsWithTools(): Turn[] {
  return [
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
        { kind: 'text', id: 'ab1', text: '我先读文件' },
        { kind: 'thinking', id: 'ab2', text: '需要确认格式', done: true },
        {
          kind: 'tool',
          id: 'tb1',
          callId: 'call_read',
          name: 'read_file',
          summary: '读取 uploads/report.docx',
          state: 'done',
          detail: '读取成功',
        },
        {
          kind: 'tool',
          id: 'tb2',
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
      blocks: [{ kind: 'text', id: 'ab3', text: '处理完成' }],
    },
  ];
}

function historyWithTools(): HandoffHistoryMessage[] {
  return [
    { role: 'user', content: '整理报告' },
    {
      role: 'assistant',
      content: '我先读文件',
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
}

function handoffForImport() {
  const history = historyWithTools();
  const turns = turnsWithTools();
  const replay = buildReplayFromTurns(turns, history);
  return buildHandoff({
    conversationId: 's_full_1',
    reason: 'continue_in_light',
    from: { engine: 'full', sessionId: 's_full_1' },
    presetId: 'standard',
    history,
    turns,
    userText: '继续',
    now: 1,
  });
}

function storedSession(host: LightHost, sessionId: string) {
  return (
    host as unknown as {
      sessions: Map<
        string,
        {
          turns: Turn[];
          history: HandoffHistoryMessage[];
          handoffId?: string;
        }
      >;
    }
  ).sessions.get(sessionId);
}

describe('Handoff · 轻引擎导入（M2.2）', () => {
  it('按 replay 重建 turns/history：思考/工具卡可还原，工具结果顺序正确', async () => {
    const dataRoot = await tempDir('dsh-palm-handoff-data-');
    const host = await makeHost(dataRoot);
    const handoff = handoffForImport();
    assert.ok(handoff.replay);

    const { session } = await host.request('sessions.import', {
      title: '报告整理',
      text: buildSeedText(handoff),
      handoffId: handoff.handoffId,
      seedMarker: handoff.seedMarker,
      replay: handoff.replay,
    });
    const { session: detail } = await host.request('sessions.get', { sessionId: session.id });
    assert.equal(detail.turns.length, handoff.replay.turns.length + 1, '重建回合 + seed 回合');
    assert.equal(detail.turns.at(-1)?.role, 'user');
    assert.match(
      JSON.stringify(detail.turns.at(-1)?.blocks),
      /\[dsh-handoff:h_/,
      'seed 仍是最后一条 user 消息',
    );

    const assistant = detail.turns.find((turn) => turn.role === 'assistant');
    const kinds = assistant?.blocks.map((block) => block.kind);
    assert.deepEqual(kinds, ['text', 'thinking', 'tool', 'tool']);
    const tools = assistant?.blocks.filter((block) => block.kind === 'tool') ?? [];
    assert.deepEqual(
      tools.map((block) => (block.kind === 'tool' ? `${block.callId}:${block.state}` : '')),
      ['call_read:done', 'call_write:error'],
    );
    assert.equal(
      tools[0]?.kind === 'tool' ? tools[0].detail : '',
      '读取成功',
    );

    const stored = storedSession(host, session.id);
    assert.ok(stored);
    assert.equal(stored?.handoffId, handoff.handoffId);
    assert.deepEqual(
      stored?.history.map((message) => message.role),
      ['user', 'assistant', 'tool', 'tool', 'assistant', 'user'],
    );
    assert.deepEqual(
      stored?.history.filter((message) => message.role === 'tool').map((message) => message.tool_call_id),
      ['call_read', 'call_write'],
    );
    const call = stored?.history.find((message) => message.role === 'assistant')?.tool_calls?.[0];
    assert.equal(call?.function.arguments, '{"path":"uploads/report.docx"}');
  });

  it('sessions.handoff 从已导入会话生成 v2 包：带 replay 与工具状态', async () => {
    const dataRoot = await tempDir('dsh-palm-handoff-data-');
    const host = await makeHost(dataRoot);
    const handoff = handoffForImport();
    const { session } = await host.request('sessions.import', {
      title: '报告整理',
      text: buildSeedText(handoff),
      handoffId: handoff.handoffId,
      seedMarker: handoff.seedMarker,
      replay: handoff.replay,
    });
    const packed = await host.request('sessions.handoff', {
      sessionId: session.id,
      reason: 'pre_route',
    });
    assert.equal(packed.version, 2);
    assert.ok(packed.replay);
    const tools = packed.replay.turns.flatMap((turn) =>
      turn.blocks.filter((block) => block.kind === 'tool'),
    );
    assert.deepEqual(
      tools.map((block) => (block.kind === 'tool' ? `${block.callId}:${block.state}` : '')),
      ['call_read:done', 'call_write:error'],
    );
    assert.equal(
      tools[0]?.kind === 'tool' ? tools[0].arguments : '',
      '{"path":"uploads/report.docx"}',
    );
  });

  it('重复导入同一个 handoffId：返回同一会话，回合不翻倍（重启后也幂等）', async () => {
    const dataRoot = await tempDir('dsh-palm-handoff-data-');
    const host = await makeHost(dataRoot);
    const handoff = handoffForImport();
    const params = {
      title: '报告整理',
      text: buildSeedText(handoff),
      handoffId: handoff.handoffId,
      seedMarker: handoff.seedMarker,
      replay: handoff.replay,
    };

    const first = await host.request('sessions.import', params);
    const before = await host.request('sessions.get', { sessionId: first.session.id });
    const second = await host.request('sessions.import', params);
    const after = await host.request('sessions.get', { sessionId: first.session.id });
    assert.equal(second.session.id, first.session.id);
    assert.equal(after.session.turns.length, before.session.turns.length);
    assert.equal((await host.request('sessions.list', {})).sessions.length, 1);

    // 模拟 App/引擎重启：同一个数据目录重新加载，仍然返回原会话
    const restarted = await makeHost(dataRoot);
    const third = await restarted.request('sessions.import', params);
    assert.equal(third.session.id, first.session.id);
    assert.equal((await restarted.request('sessions.list', {})).sessions.length, 1);
  });

  it('旧客户端只带 seed marker：也按 handoffId 幂等', async () => {
    const dataRoot = await tempDir('dsh-palm-handoff-data-');
    const host = await makeHost(dataRoot);
    const text = '[dsh-handoff:h_seed001]\n继续之前的会话';
    const first = await host.request('sessions.import', { text });
    const second = await host.request('sessions.import', { text });
    assert.equal(second.session.id, first.session.id);
    assert.equal((await host.request('sessions.list', {})).sessions.length, 1);
  });

  it('v1 兼容：没有 replay 时只导入 seed 回合', async () => {
    const dataRoot = await tempDir('dsh-palm-handoff-data-');
    const host = await makeHost(dataRoot);
    const handoff = buildHandoff({
      conversationId: 's_full_1',
      reason: 'continue_in_light',
      presetId: 'standard',
      history: historyWithTools(),
      userText: '继续',
      version: 1,
      now: 1,
    });
    const { session } = await host.request('sessions.import', {
      text: buildSeedText(handoff),
      handoffId: handoff.handoffId,
      seedMarker: handoff.seedMarker,
    });
    const { session: detail } = await host.request('sessions.get', { sessionId: session.id });
    assert.equal(detail.turns.length, 1);
    assert.equal(detail.turns[0]?.role, 'user');
    assert.match(JSON.stringify(detail.turns[0]?.blocks), /\[dsh-handoff:h_/);
  });

  it('replay 结构不合法：拒绝导入，不留下半成品会话', async () => {
    const dataRoot = await tempDir('dsh-palm-handoff-data-');
    const host = await makeHost(dataRoot);
    await assert.rejects(
      () =>
        host.request('sessions.import', {
          text: '坏交接',
          handoffId: 'h_bad',
          replay: { schema: 'nope', turns: [] } as never,
        }),
      /交接回放结构不合法/,
    );
    assert.equal((await host.request('sessions.list', {})).sessions.length, 0);
  });
});
