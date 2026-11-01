/**
 * 端到端：真 WebSocket 连真 mock 引擎，跑完一次完整对话 + 审批。
 *
 * 这一步验证的是 docs/02-architecture.md 里那条缝：
 *   UI ←(协议)→ 引擎
 * 只要这条缝是通的，UI 换成什么都无所谓。
 */

process.env.DSH_MOCK_SPEED = '0.15';

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

import { startEngine, type EngineServer } from '../engine/src/server';
import { EngineClient, type WebSocketCtor } from '../app/src/lib/client';
import type { Approval, EngineEvent, EventName, EventPayloads, Turn } from '../app/src/protocol';

let engine: EngineServer;
let client: EngineClient;

function waitFor<K extends EventName>(
  c: EngineClient,
  event: K,
  predicate: (data: EventPayloads[K]) => boolean = () => true,
  timeoutMs = 20_000,
): Promise<EventPayloads[K]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`等待事件超时：${event}`));
    }, timeoutMs);
    const off = c.on(event, (data) => {
      if (!predicate(data)) return;
      clearTimeout(timer);
      off();
      resolve(data);
    });
  });
}

before(async () => {
  engine = await startEngine(0);
  client = new EngineClient({
    url: `ws://127.0.0.1:${engine.port}/ws`,
    webSocketImpl: WebSocket as unknown as WebSocketCtor,
    autoReconnect: false,
  });
  await client.connect();
});

after(async () => {
  client.close();
  await engine.close();
});

test('握手返回能力：宿主信息、预设、事件表', () => {
  const caps = client.caps;
  assert.ok(caps, '应当拿到 capabilities');
  assert.equal(caps.protocol, 1);
  assert.equal(caps.host.kind, 'phone');
  assert.ok(caps.presets.length >= 3, '至少三个内置预设');
  assert.ok(caps.presets.some((p) => p.id === 'doc'));
  assert.ok(caps.events.includes('approval.requested'));
  assert.ok(caps.actions.includes('approve'));
});

test('能力契约：每个预设都声明了工具白名单', () => {
  const caps = client.caps!;
  for (const preset of caps.presets) {
    assert.ok(preset.contract.tools.length > 0, `${preset.id} 应当有工具`);
    assert.ok(preset.contract.net === 'allow' || preset.contract.net === 'deny');
  }
  const doc = caps.presets.find((p) => p.id === 'doc')!;
  assert.equal(doc.contract.net, 'deny', '文档预设默认禁网');
  assert.ok(doc.contract.exec === 'python-limited', '文档预设需要受限执行环境');
});

test('会话列表与创建', async () => {
  const { sessions } = await client.request('sessions.list', {});
  assert.ok(sessions.length >= 2, '预置了历史会话');

  const { session } = await client.request('sessions.create', { presetId: 'doc' });
  assert.equal(session.presetId, 'doc');
  assert.equal(session.status, 'idle');

  const { session: detail } = await client.request('sessions.get', { sessionId: session.id });
  assert.equal(detail.turns.length, 0);
  assert.equal(detail.contract.net, 'deny');
});

test('完整一轮：流式 → 工具 → 审批 → 批准 → 收尾', async () => {
  const { session } = await client.request('sessions.create', { presetId: 'doc' });

  const events: EngineEvent[] = [];
  const offAny = client.onAny((e) => events.push(e));
  /** 事件回调里发起的请求，跑完后统一 await，避免未处理拒绝 */
  const intents: Promise<void>[] = [];

  let approvalSeen: Approval | null = null;
  const approvalPromise = waitFor(client, 'approval.requested', (d) => {
    if (d.approval.sessionId !== session.id) return false;
    approvalSeen = d.approval;
    return true;
  });

  // 审批卡必须自包含：标题、原文、风险、摘要
  intents.push(
    approvalPromise.then(async (d) => {
      const a = d.approval;
      assert.ok(a.title.length > 0, '需要标题');
      assert.ok(a.command, '需要命令原文');
      assert.ok(['low', 'medium', 'high'].includes(a.risk));
      assert.ok(a.summary.length > 0, '需要人类可读的风险说明');
      await client.request('approvals.resolve', { approvalId: a.id, decision: 'approve' });
    }),
  );

  const { runId } = await client.request('sessions.send', { sessionId: session.id, text: '这份合同的金额帮我对一下' });

  const finished = await waitFor(client, 'run.finished', (d) => d.runId === runId);
  assert.equal(finished.reason, 'done');
  await Promise.all(intents);
  offAny();

  assert.ok(approvalSeen, '这一轮必须触发审批');
  assert.ok(events.some((e) => e.event === 'run.started'));
  assert.ok(events.filter((e) => e.event === 'block.delta').length > 10, '应当是流式输出');

  const { session: detail } = await client.request('sessions.get', { sessionId: session.id });
  const assistant = detail.turns.find((t: Turn) => t.role === 'assistant');
  assert.ok(assistant, '应当有 assistant 回合');
  assert.equal(assistant.status, 'done');

  const kinds = assistant.blocks.map((b) => b.kind);
  assert.ok(kinds.includes('thinking'), '要有思考块');
  assert.ok(kinds.includes('text'), '要有正文块');
  assert.ok(kinds.includes('tool'), '要有工具块');
  assert.ok(kinds.includes('approval'), '要有审批块');

  const text = assistant.blocks
    .filter((b) => b.kind === 'text')
    .map((b) => (b as { text: string }).text)
    .join('');
  assert.ok(text.includes('合同'), '正文内容应当落地');
});

test('拒绝审批：这一轮停下，不写文件', async () => {
  const { session } = await client.request('sessions.create', { presetId: 'doc' });
  const hit = waitFor(client, 'approval.requested', (d) => d.approval.sessionId === session.id);

  const { runId } = await client.request('sessions.send', { sessionId: session.id, text: '改合同' });

  // 先订阅再动作：解审批之后这一轮会立刻结束，晚一步就收不到 run.finished
  const finishedWait = waitFor(client, 'run.finished', (d) => d.runId === runId);

  const { approval } = await hit;
  await client.request('approvals.resolve', { approvalId: approval.id, decision: 'reject' });

  const finished = await finishedWait;
  assert.equal(finished.reason, 'stopped');

  const { session: detail } = await client.request('sessions.get', { sessionId: session.id });
  assert.equal(detail.status, 'idle');
  const last = detail.turns[detail.turns.length - 1]!;
  assert.equal(last.status, 'stopped');
});

test('会话内升级预设：契约跟着换', async () => {
  const { session } = await client.request('sessions.create', { presetId: 'vision' });
  const before = await client.request('sessions.get', { sessionId: session.id });
  assert.equal(before.session.contract.net, 'allow');

  const after = await client.request('sessions.setPreset', { sessionId: session.id, presetId: 'doc' });
  assert.equal(after.session.presetId, 'doc');
  assert.equal(after.session.contract.net, 'deny');
  assert.ok(after.session.contract.tools.includes('docs.write'));
});

test('模型：列目录 + 切模型写回会话', async () => {
  const { models, default: fallback } = await client.request('models.list', {});
  assert.ok(models.length > 0, '至少要有一个模型');
  assert.ok(models.every((m) => m.provider && m.id), '每个模型都要有 provider 和 id');
  assert.ok(fallback, '要给出宿主默认模型');

  const { session } = await client.request('sessions.create', { presetId: 'standard' });
  const target = models.find((m) => m.id !== fallback?.model) ?? models[0]!;
  const { session: updated } = await client.request('sessions.setModel', {
    sessionId: session.id,
    provider: target.provider,
    model: target.id,
    reasoningEffort: target.defaultEffort,
  });
  assert.equal(updated.model?.provider, target.provider);
  assert.equal(updated.model?.model, target.id);
});
test('权限：列预设 + 切预设写回会话', async () => {
  const { options, default: fallback } = await client.request('permissions.list', {});
  assert.ok(options.length >= 3, '至少三档权限');
  assert.ok(options.some((o) => o.value === 'read-only'));
  assert.ok(fallback, '要给出宿主默认权限');

  const { session } = await client.request('sessions.create', { presetId: 'standard' });
  const target = 'danger-full-access';
  const { session: updated } = await client.request('sessions.setPermission', {
    sessionId: session.id,
    preset: target,
  });
  assert.equal(updated.permission, target);

  const again = await client.request('sessions.get', { sessionId: session.id });
  assert.equal(again.session.permission, target, '切完要能读回来');
});
test('附件：上传拿到回执，能带进 sessions.send', async () => {
  const { session } = await client.request('sessions.create', { presetId: 'standard' });
  const data = Buffer.from('hello attachment', 'utf8').toString('base64');
  const uploaded = await client.request('attachments.upload', { sessionId: session.id, data, name: 'a.txt' });
  assert.ok(uploaded.receiptId.length > 0, '要返回回执');

  const res = await client.request('sessions.send', {
    sessionId: session.id,
    text: '带附件的一条',
    attachments: [uploaded.receiptId],
  });
  assert.equal(res.accepted, true);
});

test('工作区：列出现有工作区，能在指定工作区建会话', async () => {
  const { workspaces } = await client.request('workspaces.list', {});
  assert.ok(workspaces.length > 0, '至少一个工作区');
  assert.ok(workspaces[0]!.root.length > 0, '工作区要有真实路径');

  const target = workspaces[0]!;
  const { session } = await client.request('sessions.create', {
    presetId: 'standard',
    workspaceId: target.id,
  });
  assert.ok(session.workspaceId.length > 0);

  const created = await client.request('workspaces.create', { path: target.root });
  assert.equal(created.workspace.root, target.root);
});
test('错误路径：未知方法给出可读错误', async () => {
  await assert.rejects(
    () => (client.request as unknown as (m: string, p: unknown) => Promise<unknown>)('nope.nope', {}),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, 'unsupported');
      return true;
    },
  );
});
