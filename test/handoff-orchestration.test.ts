/**
 * Handoff 编排测试（注入假 client / 假切换）：
 *  - 切换失败 → 不 create、源会话保留；
 *  - create 失败 → 不 send、源 currentId/detail 恢复；
 *  - 并发 begin → 只 create/send 一次；
 *  - send 报错但完整引擎里已有 marker → 认定成功，且绝不重发。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Store, type HandoffDeps } from '../app/src/state/store';
import { initialEngineState } from '../app/src/state/engineManager';
import { buildHandoff } from '../app/src/lib/handoff';
import type {
  Capabilities,
  HandoffV1,
  SessionDetail,
  SessionSummary,
} from '../app/src/protocol';

const SOURCE_ID = 'light-1';
const FULL_ID = 'full-1';

const sourceDetail: SessionDetail = {
  id: SOURCE_ID,
  title: '整理报告',
  presetId: 'light',
  workspaceId: 'local',
  hostId: 'light-local',
  status: 'idle',
  updatedAt: 10,
  unread: 0,
  preview: '帮我跑 python',
  turns: [
    {
      id: 'u1',
      role: 'user',
      createdAt: 1,
      status: 'done',
      blocks: [{ kind: 'text', id: 'b1', text: '帮我跑 python 脚本' }],
    },
    {
      id: 'a1',
      role: 'assistant',
      createdAt: 2,
      status: 'done',
      blocks: [
        {
          kind: 'capability',
          id: 'cap_call',
          code: 'capability_missing',
          tool: 'bash',
          summary: '执行命令：python a.py',
          reason: '轻引擎不能运行 Python',
          missing: ['python'],
          command: 'python a.py',
          status: 'pending',
          callId: 'call_py',
        },
      ],
    },
  ],
  contract: { tools: [], net: 'allow' },
};

const summary: SessionSummary = {
  id: SOURCE_ID,
  title: '整理报告',
  presetId: 'light',
  workspaceId: 'local',
  hostId: 'light-local',
  status: 'idle',
  updatedAt: 10,
  unread: 0,
  preview: '帮我跑 python',
};

const caps: Capabilities = {
  protocol: 1,
  host: { id: 'light-local', name: '轻引擎', kind: 'phone', platform: 'test', engineVersion: '0' },
  events: [],
  actions: [],
  presets: [
    {
      id: 'standard',
      name: '标准',
      glyph: '标',
      tagline: '',
      version: '0',
      builtin: true,
      contract: { tools: [] },
      modelPolicy: {},
    },
    {
      id: 'minimal',
      name: '精简',
      glyph: '简',
      tagline: '',
      version: '0',
      builtin: true,
      contract: { tools: [] },
      modelPolicy: {},
    },
  ],
  workspaces: [],
  limits: { maxAttachmentMB: 20, maxFetchFileMB: 20 },
};

function fullDetail(handoff: HandoffV1, answer: string, withSeed = true): SessionDetail {
  return {
    id: FULL_ID,
    title: '整理报告',
    presetId: 'standard',
    workspaceId: 'ws',
    hostId: 'proot',
    status: 'idle',
    updatedAt: 100,
    unread: 0,
    preview: answer,
    turns: [
      ...(withSeed
        ? [
            {
              id: 'seed-turn',
              role: 'user' as const,
              createdAt: 90,
              status: 'done' as const,
              blocks: [{ kind: 'text' as const, id: 'seed-block', text: `${handoff.seedMarker}\n交接` }],
            },
          ]
        : []),
      {
        id: 'full-a1',
        role: 'assistant',
        createdAt: 99,
        status: 'done',
        blocks: [{ kind: 'text', id: 'full-b1', text: answer }],
      },
    ],
    contract: { tools: [], net: 'allow' },
  };
}

interface FakeOptions {
  switchOk?: boolean;
  createFail?: boolean;
  modelsEmpty?: boolean;
  sendFail?: boolean;
  markerFound?: boolean;
}

function makeHarness(options: FakeOptions = {}) {
  const counts = { create: 0, send: 0, get: 0, rename: 0, permission: 0, model: 0 };
  let handoff: HandoffV1 | null = null;
  const fullRequests: string[] = [];

  const requestLight = (async (method: string) => {
    if (method !== 'sessions.handoff') throw new Error(`unexpected light method ${method}`);
    handoff = buildHandoff({
      conversationId: SOURCE_ID,
      reason: 'capability_missing',
      presetId: 'light',
      history: [
        { role: 'user', content: '帮我跑 python 脚本' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_py',
              type: 'function',
              function: { name: 'bash', arguments: '{"command":"python a.py"}' },
            },
          ],
        },
      ],
      blocked: [{ callId: 'call_py', name: 'bash', args: { command: 'python a.py' } }],
      userText: '帮我跑 python 脚本',
      now: 50,
    });
    return handoff;
  }) as unknown as HandoffDeps['requestLight'];

  const requestFull = (async (method: string) => {
    fullRequests.push(method);
    const current = handoff;
    if (!current) throw new Error('handoff 还没生成');
    switch (method) {
      case 'models.list':
        return options.modelsEmpty
          ? { models: [] }
          : {
              models: [{ provider: 'deepseek', providerName: 'DeepSeek', id: 'deepseek-chat', name: 'chat' }],
              default: { provider: 'deepseek', model: 'deepseek-chat' },
            };
      case 'sessions.create': {
        counts.create += 1;
        if (options.createFail) throw new Error('create 失败');
        return {
          session: { ...summary, id: FULL_ID, hostId: 'proot', presetId: 'standard' },
        };
      }
      case 'sessions.rename':
        counts.rename += 1;
        return { session: fullDetail(current, '') };
      case 'sessions.setPermission':
        counts.permission += 1;
        return { session: fullDetail(current, '') };
      case 'sessions.setModel':
        counts.model += 1;
        return { session: fullDetail(current, '') };
      case 'sessions.send':
        counts.send += 1;
        if (options.sendFail) throw new Error('send 结果不确定');
        return { accepted: true, runId: 'r1' };
      case 'sessions.get':
        counts.get += 1;
        return {
          session: fullDetail(
            current,
            '完整引擎继续跑完了',
            options.sendFail ? options.markerFound === true : true,
          ),
        };
      default:
        throw new Error(`unexpected full method ${method}`);
    }
  }) as unknown as HandoffDeps['requestFull'];

  const store = new Store(
    {
      hostAvailable: true,
      hostStatus: async () => null,
      startHost: async () => true,
      stopHost: async () => true,
      deviceConditions: async () => null,
      setRunActive: () => undefined,
      loadLightConfig: async () => null,
      now: () => 1_000,
    },
    {
      requestLight,
      requestFull,
      switchToFull: async () => options.switchOk !== false,
      switchToLight: async () => true,
    },
  );

  (store as unknown as { patch: (next: unknown) => void }).patch({
    conn: 'connected',
    engine: {
      ...initialEngineState,
      mode: 'light',
      target: 'light',
      link: 'light',
      lightReady: true,
      idleSince: 1,
    },
    currentId: SOURCE_ID,
    detail: sourceDetail,
    sessions: [summary],
    caps,
  });

  const input = {
    logicalId: SOURCE_ID,
    reason: 'capability_missing',
    userText: '帮我跑 python 脚本',
    blockedCallIds: ['call_py'],
    blockId: 'cap_call',
    escalate: true,
  };
  return { store, counts, fullRequests, input, marker: () => handoff?.seedMarker ?? '' };
}

describe('Handoff 编排', () => {
  it('切换失败：不 create、不 send，源会话保留', async () => {
    const harness = makeHarness({ switchOk: false });
    const ok = await harness.store.beginHandoff(harness.input);
    assert.equal(ok, false);
    assert.equal(harness.counts.create, 0);
    assert.equal(harness.counts.send, 0);
    assert.equal(harness.store.getSnapshot().currentId, SOURCE_ID);
    assert.equal(harness.store.getSnapshot().detail?.id, SOURCE_ID);
    assert.ok(harness.store.getSnapshot().error);
  });

  it('create 失败：不 send，源 currentId/detail 恢复，不留可用 link', async () => {
    const harness = makeHarness({ createFail: true });
    const ok = await harness.store.beginHandoff(harness.input);
    assert.equal(ok, false);
    assert.equal(harness.counts.create, 1);
    assert.equal(harness.counts.send, 0);
    assert.equal(harness.store.getSnapshot().currentId, SOURCE_ID);
    assert.equal(harness.store.getSnapshot().detail?.id, SOURCE_ID);
    assert.equal(harness.store.getSnapshot().links.length, 0);
  });

  it('models.list 为空：create 之前回滚', async () => {
    const harness = makeHarness({ modelsEmpty: true });
    const ok = await harness.store.beginHandoff(harness.input);
    assert.equal(ok, false);
    assert.equal(harness.counts.create, 0);
    assert.equal(harness.counts.send, 0);
    assert.equal(harness.store.getSnapshot().currentId, SOURCE_ID);
  });

  it('并发 begin：只 create / send 一次，最后 link active=full', async () => {
    const harness = makeHarness();
    const [a, b] = await Promise.all([
      harness.store.beginHandoff(harness.input),
      harness.store.beginHandoff(harness.input),
    ]);
    assert.equal(a, true);
    assert.equal(b, true);
    assert.equal(harness.counts.create, 1);
    assert.equal(harness.counts.send, 1);
    const snapshot = harness.store.getSnapshot();
    assert.equal(snapshot.currentId, SOURCE_ID);
    assert.equal(snapshot.links.length, 1);
    assert.equal(snapshot.links[0]?.activeSide, 'full');
    assert.equal(snapshot.links[0]?.status, 'active');
    assert.equal(snapshot.links[0]?.fullSessionId, FULL_ID);
    assert.equal(snapshot.detail?.id, SOURCE_ID);
    assert.match(JSON.stringify(snapshot.detail?.turns), /完整引擎继续跑完了/);
    assert.equal(snapshot.detail?.turns.some((turn) => turn.id === 'seed-turn'), false);
    assert.equal(snapshot.busy, false);
  });

  it('seed send 报错但 marker 已在完整引擎：认定成功，不重发', async () => {
    const harness = makeHarness({ sendFail: true, markerFound: true });
    const ok = await harness.store.beginHandoff(harness.input);
    assert.equal(ok, true);
    assert.equal(harness.counts.create, 1);
    assert.equal(harness.counts.send, 1, 'seed 只允许发一次');
    const snapshot = harness.store.getSnapshot();
    assert.equal(snapshot.links[0]?.status, 'active');
    assert.equal(snapshot.links[0]?.activeSide, 'full');
    assert.equal(snapshot.links[0]?.seedTurnId, 'seed-turn');
    assert.equal(snapshot.busy, false);
    // 能力卡回填 handed_off
    const blocks = snapshot.detail?.turns.flatMap((turn) => turn.blocks) ?? [];
    const card = blocks.find((block) => block.kind === 'capability');
    assert.equal(card?.kind === 'capability' ? card.status : '', 'handed_off');
  });

  it('refreshSessions：隐藏完整物理会话，只留一条逻辑条目', async () => {
    const harness = makeHarness();
    assert.equal(await harness.store.beginHandoff(harness.input), true);
    const fullSummary: SessionSummary = {
      ...summary,
      id: FULL_ID,
      title: '整理报告',
      presetId: 'standard',
      hostId: 'proot',
      updatedAt: 200,
    };
    (harness.store as unknown as { client: unknown }).client = {
      request: async (method: string) => {
        if (method === 'sessions.list') return { sessions: [summary, fullSummary] };
        throw new Error(`unexpected method ${method}`);
      },
    };
    await harness.store.refreshSessions();
    const sessions = harness.store.getSnapshot().sessions;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.id, SOURCE_ID);
    assert.equal(sessions[0]?.updatedAt, 200);
    assert.equal(sessions.some((session) => session.id === FULL_ID), false);
  });

  it('seed send 失败且 marker 不在：回滚源会话，不重发', async () => {
    const harness = makeHarness({ sendFail: true, markerFound: false });
    const ok = await harness.store.beginHandoff(harness.input);
    assert.equal(ok, false);
    assert.equal(harness.counts.send, 1);
    assert.equal(harness.store.getSnapshot().currentId, SOURCE_ID);
    assert.equal(harness.store.getSnapshot().detail?.id, SOURCE_ID);
    assert.equal(harness.store.getSnapshot().links[0]?.status, 'failed');
  });
});
