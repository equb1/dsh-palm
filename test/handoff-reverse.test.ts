/**
 * M2.2：完整 → 轻的反向交接编排测试。
 *  - import 带上结构化 replay / handoffId；
 *  - 重建后的轻引擎回合不再被完整侧重复追加；
 *  - import 失败不回滚出坏 link。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Store, type HandoffDeps } from '../app/src/state/store';
import { initialEngineState } from '../app/src/state/engineManager';
import { replayToTurns } from '../app/src/lib/handoff';
import type {
  HandoffReplay,
  RequestParams,
  SessionDetail,
  SessionSummary,
  Turn,
} from '../app/src/protocol';

const FULL_ID = 's_full_1';
const LIGHT_ID = 's_light_new';

const fullTurns: Turn[] = [
  {
    id: 'fu1',
    role: 'user',
    createdAt: 1,
    status: 'done',
    blocks: [{ kind: 'text', id: 'fub', text: '整理报告' }],
  },
  {
    id: 'fa1',
    role: 'assistant',
    createdAt: 2,
    status: 'done',
    blocks: [
      { kind: 'text', id: 'fab1', text: '完整侧回答' },
      { kind: 'thinking', id: 'fab2', text: '完整侧思考', done: true },
      {
        kind: 'tool',
        id: 'fab3',
        callId: 'call_read',
        name: 'read_file',
        summary: '读取 report.docx',
        state: 'done',
        detail: '正文',
      },
    ],
  },
];

const fullDetail: SessionDetail = {
  id: FULL_ID,
  title: '整理报告',
  presetId: 'standard',
  workspaceId: 'ws',
  hostId: 'proot',
  status: 'idle',
  updatedAt: 10,
  unread: 0,
  preview: '完整侧回答',
  turns: fullTurns,
  contract: { tools: [], net: 'allow' },
};

const summary: SessionSummary = {
  id: LIGHT_ID,
  title: '整理报告',
  presetId: 'standard',
  workspaceId: 'local',
  hostId: 'light-local',
  status: 'idle',
  updatedAt: 20,
  unread: 0,
  preview: '完整侧回答',
};

function makeStore(options: { importFail?: boolean } = {}) {
  let importParams: RequestParams['sessions.import'] | undefined;
  let importedDetail: SessionDetail | undefined;

  const requestFull = (async (method: string) => {
    if (method !== 'sessions.get') throw new Error(`unexpected full method ${method}`);
    return { session: fullDetail };
  }) as unknown as HandoffDeps['requestFull'];

  const requestLight = (async (method: string, params: RequestParams['sessions.import']) => {
    if (method === 'sessions.import') {
      if (options.importFail) throw new Error('导入失败');
      importParams = params;
      const replay = params.replay as HandoffReplay | undefined;
      importedDetail = {
        ...summary,
        contract: { tools: [], net: 'allow' },
        turns: [
          ...replayToTurns(replay),
          {
            id: 'seed-turn',
            role: 'user',
            createdAt: 99,
            status: 'done',
            blocks: [{ kind: 'text', id: 'seed-block', text: `${params.seedMarker}\n继续` }],
          },
        ],
      };
      return { session: summary };
    }
    if (method === 'sessions.get') {
      if (!importedDetail) throw new Error('还没导入');
      return { session: importedDetail };
    }
    throw new Error(`unexpected light method ${method}`);
  }) as unknown as HandoffDeps['requestLight'];

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
      switchToFull: async () => true,
      switchToLight: async () => true,
    },
  );
  (store as unknown as { patch: (next: unknown) => void }).patch({
    conn: 'connected',
    engine: {
      ...initialEngineState,
      mode: 'full',
      target: 'full',
      link: 'full',
      lightReady: true,
      idleSince: 1,
    },
    engineKind: 'remote',
    currentId: FULL_ID,
    detail: fullDetail,
    sessions: [],
  });
  return { store, params: () => importParams };
}

describe('Handoff · 完整 → 轻（M2.2）', () => {
  it('导入带 replay/handoffId，重建轻回合且不重复完整侧', async () => {
    const harness = makeStore();
    const ok = await harness.store.continueFullInLight(FULL_ID);
    assert.equal(ok, true);
    const params = harness.params();
    assert.ok(params);
    assert.match(String(params.handoffId), /^h_[0-9a-f]{8}$/);
    assert.ok(params.replay && params.replay.turns.length > 0);
    assert.match(params.text, /\[dsh-handoff:h_[0-9a-f]{8}\]/);
    assert.match(params.text, /结构化回放/);

    const snapshot = harness.store.getSnapshot();
    assert.equal(snapshot.currentId, LIGHT_ID);
    assert.equal(snapshot.links.length, 1);
    assert.equal(snapshot.links[0]?.activeSide, 'light');
    assert.equal(snapshot.links[0]?.handoffDirection, 'full_to_light');
    assert.equal(snapshot.links[0]?.fullSessionId, FULL_ID);

    const turns = snapshot.detail?.turns ?? [];
    assert.equal(turns.some((turn) => turn.id === 'seed-turn'), false, 'seed 仍被隐藏');
    const kinds = turns.flatMap((turn) => turn.blocks.map((block) => block.kind));
    assert.ok(kinds.includes('thinking'));
    assert.ok(kinds.includes('tool'));
    const text = JSON.stringify(turns);
    assert.equal((text.match(/完整侧回答/g) ?? []).length, 1, '完整侧不能重复追加');
  });

  it('import 失败：不产生 link，保留错误提示', async () => {
    const harness = makeStore({ importFail: true });
    const ok = await harness.store.continueFullInLight(FULL_ID);
    assert.equal(ok, false);
    const snapshot = harness.store.getSnapshot();
    assert.equal(snapshot.links.length, 0);
    assert.ok(snapshot.error);
  });
});
