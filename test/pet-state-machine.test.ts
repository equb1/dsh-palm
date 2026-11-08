import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PetStateMachine } from '../app/src/pet/PetStateMachine';
import type { PetAnimation, PetPack, PetState } from '../app/src/pet/types';

const anim = (name: string): PetAnimation => ({
  sheet: `${name}.png`,
  frameW: 128,
  frameH: 128,
  cols: 1,
  frames: [{ i: 0, ms: 100 }],
  loop: true,
});

const STATES: PetState[] = [
  'idle', 'thinking', 'working', 'juggling', 'sweeping', 'notification',
  'attention', 'error', 'carrying', 'sleeping', 'waking', 'roam',
];

const pack: PetPack = {
  id: 'test',
  name: 'Test',
  version: '1',
  canvas: { width: 128, height: 128 },
  anchor: { x: 0.5, y: 1 },
  contentBox: { x: 0, y: 0, width: 128, height: 128 },
  animations: Object.fromEntries(STATES.map((s) => [s, anim(s)])),
  states: Object.fromEntries(STATES.map((s) => [s, s])) as Record<PetState, string>,
  tiers: {
    working: { minTasks: 1, maxTasks: 1, anim: 'working' },
    juggling: { minTasks: 2, maxTasks: 2, anim: 'juggling' },
    sweeping: { minTasks: 3, maxTasks: 99, anim: 'sweeping' },
  },
  idlePool: [],
  reactions: { tapLeft: 'react-left', tapRight: 'react-right' },
  timings: { minDisplayMs: 0, autoReturnMs: 20, wakeMs: 10, sleepAfterMs: 30 },
};

function machine(): PetStateMachine {
  return new PetStateMachine(pack);
}

test('任务数映射 working / juggling / sweeping', () => {
  const sm = machine();
  sm.updateContext({ runningCount: 1, waitingApprovalCount: 0 });
  assert.equal(sm.state, 'working');
  sm.updateContext({ runningCount: 2, waitingApprovalCount: 0 });
  assert.equal(sm.state, 'juggling');
  sm.updateContext({ runningCount: 3, waitingApprovalCount: 0 });
  assert.equal(sm.state, 'sweeping');
  sm.destroy();
});

test('审批优先于任务，thinking 只在单任务时生效', () => {
  const sm = machine();
  sm.updateContext({ runningCount: 1, waitingApprovalCount: 1 });
  assert.equal(sm.state, 'attention');
  sm.updateContext({ runningCount: 1, waitingApprovalCount: 0, thinking: true });
  assert.equal(sm.state, 'thinking');
  sm.destroy();
});

test('任务结束触发 notification 瞬态', () => {
  const sm = machine();
  sm.updateContext({ runningCount: 1, waitingApprovalCount: 0 });
  assert.equal(sm.state, 'working');
  sm.updateContext({ runningCount: 0, waitingApprovalCount: 0 });
  assert.equal(sm.state, 'notification');
  sm.destroy();
});

test('交互 reaction 在 autoReturn 后回基础状态', async () => {
  const sm = machine();
  sm.updateContext({ runningCount: 1, waitingApprovalCount: 0 });
  sm.triggerReaction('tapLeft');
  assert.equal(sm.animation, 'react-left');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sm.animation, 'working');
  sm.destroy();
});

test('闲置超时进入 sleeping，收到活动进入 waking', async () => {
  const sm = machine();
  await new Promise((r) => setTimeout(r, 40));
  sm.updateContext({ runningCount: 0, waitingApprovalCount: 0 });
  assert.equal(sm.state, 'sleeping');
  sm.notifyActivity();
  assert.equal(sm.state, 'waking');
  sm.destroy();
});

test('destroy 后不再有计时器写入', () => {
  const sm = machine();
  sm.destroy();
  sm.updateContext({ runningCount: 1, waitingApprovalCount: 0 });
  assert.ok(sm.state);
});
