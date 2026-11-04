/**
 * EngineManager 状态机单测（纯 reducer，不碰 react-native / 原生）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  badgeFor,
  canSwitch,
  IDLE_RECLAIM_MS,
  initialEngineState,
  PROOT_BOOT_TIMEOUT_MS,
  reduceEngine,
  type EngineEvent,
  type EngineSnapshot,
} from '../app/src/state/engineManager';

function apply(state: EngineSnapshot, ...events: EngineEvent[]): { state: EngineSnapshot; effects: string[][] } {
  let current = state;
  const effects: string[][] = [];
  for (const event of events) {
    const result = reduceEngine(current, event);
    current = result.state;
    effects.push(result.effects);
  }
  return { state: current, effects };
}

function booted(): EngineSnapshot {
  return apply(initialEngineState, { type: 'BOOT', now: 1_000 }, { type: 'LIGHT_READY', now: 1_000 }).state;
}

test('初始状态：轻引擎默认、触发式预热、不预热 proot', () => {
  assert.equal(initialEngineState.mode, 'light');
  assert.equal(initialEngineState.target, 'light');
  assert.equal(initialEngineState.tier, 'trigger');
  assert.equal(initialEngineState.link, null);
  assert.equal(initialEngineState.lightReady, false);
  assert.equal(initialEngineState.prootWarm, false);
  assert.equal(initialEngineState.busy, false);
  assert.equal(initialEngineState.attemptId, 0);
  assert.equal(IDLE_RECLAIM_MS, 10 * 60_000);
  assert.equal(PROOT_BOOT_TIMEOUT_MS, 90_000);
});

test('BOOT 只发 connect-light：永远不 warm-host / connect-proot（回归锁）', () => {
  for (const tier of ['trigger', 'smart', 'always'] as const) {
    const result = reduceEngine(initialEngineState, { type: 'BOOT', tier, now: 123 });
    assert.deepEqual(result.effects, ['connect-light']);
    assert.equal(result.effects.includes('warm-host'), false);
    assert.equal(result.effects.includes('connect-proot'), false);
    assert.equal(result.state.tier, tier);
    assert.equal(result.state.mode, 'light');
    assert.equal(result.state.target, 'light');
    assert.equal(result.state.idleSince, 123);
  }
});

test('LIGHT_READY：链路与 lightReady 落地', () => {
  const result = reduceEngine(initialEngineState, { type: 'LIGHT_READY', now: 500 });
  assert.equal(result.state.lightReady, true);
  assert.equal(result.state.link, 'light');
  assert.equal(result.state.mode, 'light');
  assert.deepEqual(result.effects, []);
});

test('切完整引擎期间轻引擎重连成功：不把 mode/target 拽回 light', () => {
  const switched = apply(booted(), { type: 'SWITCH', target: 'full' }).state;
  const reconnected = reduceEngine(switched, { type: 'LIGHT_READY', now: 3_000 });
  assert.equal(reconnected.state.mode, 'starting-proot');
  assert.equal(reconnected.state.target, 'full');
  assert.equal(reconnected.state.lightReady, true);
});

test('忙 / 有审批时 canSwitch 拒绝，SWITCH 不产生任何 effect', () => {
  const busyState = { ...booted(), busy: true };
  assert.equal(canSwitch(busyState).ok, false);
  assert.match(canSwitch(busyState).reason ?? '', /回合/);
  assert.deepEqual(reduceEngine(busyState, { type: 'SWITCH', target: 'full' }).effects, []);
  assert.equal(reduceEngine(busyState, { type: 'SWITCH', target: 'full' }).state, busyState);

  const approvalState = { ...booted(), pendingApprovals: 1 };
  assert.equal(canSwitch(approvalState).ok, false);
  assert.deepEqual(reduceEngine(approvalState, { type: 'SWITCH', target: 'full' }).effects, []);
});

test('SWITCH→full：进入 starting-proot 并只发 warm-host', () => {
  const result = reduceEngine(booted(), { type: 'SWITCH', target: 'full', now: 2_000 });
  assert.deepEqual(result.effects, ['warm-host']);
  assert.equal(result.state.mode, 'starting-proot');
  assert.equal(result.state.target, 'full');
  assert.equal(result.state.attemptId, 1);
  assert.equal(result.state.progress, 0);
  assert.equal(result.state.idleSince, 0);
});

test('HOST_STATUS：进度/frames/prootWarm 推进，就绪后才发 connect-proot', () => {
  const switched = apply(booted(), { type: 'SWITCH', target: 'full' }).state;
  const starting = reduceEngine(switched, {
    type: 'HOST_STATUS',
    host: {
      engine: 'starting',
      bridge: 'stopped',
      port: 8788,
      error: null,
      since: 1,
      phase: '解压 Python 层',
      progress: 42,
    },
  });
  assert.equal(starting.state.progress, 42);
  assert.equal(starting.state.prootWarm, true);
  assert.equal(starting.state.frames, 1);
  assert.deepEqual(starting.effects, []);

  const ready = reduceEngine(starting.state, {
    type: 'HOST_STATUS',
    host: { engine: 'ready', bridge: 'ready', port: 8788, error: null, since: 1, phase: '就绪', progress: 100 },
  });
  assert.equal(ready.state.progress, 100);
  assert.equal(ready.state.frames, 2);
  assert.deepEqual(ready.effects, ['connect-proot']);

  // 已经在轻引擎模式下热着 proot 时，状态帧不能顺手把 UI 切走
  const warmLight = apply(booted(), {
    type: 'HOST_STATUS',
    host: { engine: 'ready', bridge: 'ready', port: 8788, error: null, since: 1, progress: 100 },
  });
  assert.equal(warmLight.state.mode, 'light');
  assert.deepEqual(warmLight.effects[0], []);
});

test('PROOT_CONNECTED：进入 full 且 link=proot', () => {
  const switched = apply(booted(), { type: 'SWITCH', target: 'full' }).state;
  const result = reduceEngine(switched, { type: 'PROOT_CONNECTED' });
  assert.equal(result.state.mode, 'full');
  assert.equal(result.state.target, 'full');
  assert.equal(result.state.link, 'proot');
  assert.equal(result.state.prootWarm, true);
  assert.equal(result.state.progress, 100);
  assert.deepEqual(result.effects, []);
});

test('PROOT_TIMEOUT：回轻引擎 + stop-host，保留 lightReady', () => {
  const light = booted();
  const switched = apply(light, { type: 'SWITCH', target: 'full' }).state;
  const result = reduceEngine(switched, {
    type: 'PROOT_TIMEOUT',
    error: '完整引擎 90 秒内没就绪',
    attemptId: switched.attemptId,
    now: 9_999,
  });
  assert.equal(result.state.mode, 'light');
  assert.equal(result.state.target, 'light');
  assert.equal(result.state.lightReady, true);
  assert.equal(result.state.link, 'light');
  assert.equal(result.state.prootWarm, true); // 等 RECLAIMED 真正停掉
  assert.match(result.state.error ?? '', /90 秒/);
  assert.deepEqual(result.effects, ['stop-host', 'report']);

  // 旧 attempt 的超时不能顶掉新一轮切换
  const stale = reduceEngine(switched, {
    type: 'PROOT_TIMEOUT',
    attemptId: switched.attemptId - 1,
  });
  assert.equal(stale.state, switched);
  assert.deepEqual(stale.effects, []);
});

test('PROOT_FAILED：同样回轻引擎并停宿主', () => {
  const switched = apply(booted(), { type: 'SWITCH', target: 'full' }).state;
  const result = reduceEngine(switched, { type: 'PROOT_FAILED', error: '桥没起来', attemptId: switched.attemptId });
  assert.equal(result.state.mode, 'light');
  assert.equal(result.state.lightReady, true);
  assert.deepEqual(result.effects, ['stop-host', 'report']);
});

test('RECLAIM：空闲到期才停宿主；忙/审批/完整链路都挡住；RECLAIMED 清 prootWarm', () => {
  const warm = apply(booted(), {
    type: 'HOST_STATUS',
    host: { engine: 'ready', bridge: 'ready', port: 8788, error: null, since: 1, progress: 100 },
  }).state;
  assert.equal(warm.prootWarm, true);

  const tooEarly = reduceEngine(warm, { type: 'RECLAIM', now: warm.idleSince + IDLE_RECLAIM_MS - 1 });
  assert.deepEqual(tooEarly.effects, []);

  const due = reduceEngine(warm, { type: 'RECLAIM', now: warm.idleSince + IDLE_RECLAIM_MS });
  assert.deepEqual(due.effects, ['stop-host']);

  const busy = reduceEngine({ ...warm, busy: true }, { type: 'RECLAIM', now: warm.idleSince + IDLE_RECLAIM_MS });
  assert.deepEqual(busy.effects, []);

  const approvals = reduceEngine(
    { ...warm, pendingApprovals: 2 },
    { type: 'RECLAIM', now: warm.idleSince + IDLE_RECLAIM_MS },
  );
  assert.deepEqual(approvals.effects, []);

  const reclaimed = reduceEngine(warm, { type: 'RECLAIMED' });
  assert.equal(reclaimed.state.prootWarm, false);
  assert.equal(reclaimed.state.host?.engine, 'stopped');

  // 手动回收不看 10 分钟窗口
  const manual = reduceEngine(warm, { type: 'RECLAIM', reason: 'manual', now: warm.idleSince + 1 });
  assert.deepEqual(manual.effects, ['stop-host']);
});

test('badgeFor：轻 / 完整 42% / 完整', () => {
  assert.deepEqual(badgeFor(initialEngineState), { kind: 'light', label: '轻' });
  assert.deepEqual(badgeFor({ ...initialEngineState, mode: 'starting-proot', progress: 42 }), {
    kind: 'remote',
    label: '完整 42%',
  });
  assert.deepEqual(badgeFor({ ...initialEngineState, mode: 'full', link: 'proot' }), {
    kind: 'remote',
    label: '完整',
  });
  assert.equal(badgeFor({ ...initialEngineState, mode: 'starting-proot', progress: 0 }).label, '完整 启动中');
});

test('canSwitch：远程宿主链路 / 启动中都拒绝，空闲轻引擎可以切完整', () => {
  const light = booted();
  assert.deepEqual(canSwitch(light, 'full'), { ok: true });

  const remote = { ...light, mode: 'full' as const, target: 'full' as const, link: 'remote' as const };
  assert.equal(canSwitch(remote).ok, false);
  assert.match(canSwitch(remote).reason ?? '', /另一台电脑/);

  const starting = { ...light, mode: 'starting-proot' as const, target: 'full' as const };
  assert.equal(canSwitch(starting).ok, false);

  const full = { ...light, mode: 'full' as const, target: 'full' as const, link: 'proot' as const, lightReady: false };
  assert.deepEqual(canSwitch(full, 'light'), { ok: true });
});

test('LINK_LOST：回轻引擎并重连轻引擎', () => {
  const full = apply(booted(), { type: 'SWITCH', target: 'full' }, { type: 'PROOT_CONNECTED' }).state;
  const result = reduceEngine(full, { type: 'LINK_LOST', error: '完整引擎已停止', now: 12_345 });
  assert.equal(result.state.mode, 'light');
  assert.equal(result.state.target, 'light');
  assert.equal(result.state.link, null);
  assert.equal(result.state.lightReady, false);
  assert.equal(result.state.prootWarm, false);
  assert.deepEqual(result.effects, ['connect-light']);
});

test('SWITCH→light：先连轻引擎再停宿主', () => {
  const full = apply(booted(), { type: 'SWITCH', target: 'full' }, { type: 'PROOT_CONNECTED' }).state;
  const result = reduceEngine(full, { type: 'SWITCH', target: 'light', now: 50_000 });
  assert.deepEqual(result.effects, ['connect-light', 'stop-host']);
  assert.equal(result.state.mode, 'light');
  assert.equal(result.state.target, 'light');
});

test('SET_TIER / USER_ACTIVITY：档位落状态、空闲计时刷新', () => {
  const tiered = reduceEngine(booted(), { type: 'SET_TIER', tier: 'always' });
  assert.equal(tiered.state.tier, 'always');
  assert.deepEqual(tiered.effects, []);

  const active = reduceEngine(booted(), { type: 'USER_ACTIVITY', now: 77_000 });
  assert.equal(active.state.idleSince, 77_000);

  const busy = reduceEngine({ ...booted(), busy: true }, { type: 'USER_ACTIVITY', now: 77_000 });
  assert.equal(busy.state.idleSince, 1_000);
});

test('SET_BUSY：忙时清空 idle，忙转闲才开始计时', () => {
  const idle = booted();
  const busy = reduceEngine(idle, { type: 'SET_BUSY', busy: true, now: 1_000 });
  assert.equal(busy.state.idleSince, 0);
  const free = reduceEngine(busy.state, { type: 'SET_BUSY', busy: false, now: 2_000 });
  assert.equal(free.state.idleSince, 2_000);
  const stillFree = reduceEngine(free.state, { type: 'SET_BUSY', busy: false, now: 3_000 });
  assert.equal(stillFree.state.idleSince, 2_000);
});
