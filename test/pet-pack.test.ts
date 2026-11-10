/**
 * 小寄（xiaoji）桌宠资源包契约：
 *  - pack.json 与 RN sprite sheet 一一对应；
 *  - 12 个状态、4 个交互反应都有动画；
 *  - sheet 尺寸与 pack 的 frameW/frameH/cols 对齐（PNG 头直接读宽高，不引原生依赖）。
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const PET = join(ROOT, 'app', 'assets', 'pets', 'xiaoji');

interface Animation {
  sheet: string;
  frameW: number;
  frameH: number;
  cols: number;
  frames: Array<{ i: number; ms: number }>;
  loop: boolean;
}

interface Pack {
  id: string;
  name: string;
  states: Record<string, string>;
  animations: Record<string, Animation>;
  reactions: Record<string, string>;
  tiers: Record<string, { anim: string }>;
  timings: { minDisplayMs: number; sleepAfterMs: number };
}

const pack = JSON.parse(readFileSync(join(PET, 'pack.json'), 'utf8')) as Pack;

const STATES = [
  'idle',
  'thinking',
  'working',
  'juggling',
  'sweeping',
  'notification',
  'attention',
  'error',
  'carrying',
  'sleeping',
  'waking',
  'roam',
];

function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  assert.equal(buf.subarray(1, 4).toString('ascii'), 'PNG', `${path} 不是 PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('xiaoji pack：品牌角色与 12 个状态映射完整', () => {
  assert.equal(pack.id, 'xiaoji');
  assert.match(pack.name, /小寄/);
  for (const state of STATES) {
    assert.ok(pack.states[state], `缺少状态 ${state}`);
    assert.ok(pack.animations[pack.states[state]!], `状态 ${state} 指向的动画不存在`);
  }
  for (const reaction of ['tapLeft', 'tapRight', 'tickle', 'drag']) {
    assert.ok(pack.reactions[reaction], `缺少交互反应 ${reaction}`);
    assert.ok(pack.animations[pack.reactions[reaction]!], `反应 ${reaction} 动画不存在`);
  }
});

test('xiaoji pack：多任务阶梯与最短展示时间', () => {
  assert.equal(pack.animations[pack.tiers.working!.anim]!.loop, true);
  assert.equal(pack.animations[pack.tiers.juggling!.anim]!.loop, true);
  assert.equal(pack.animations[pack.tiers.sweeping!.anim]!.loop, true);
  assert.ok(pack.timings.minDisplayMs >= 600, '最短展示时间不能低于 600ms');
  assert.ok(pack.timings.sleepAfterMs >= 30_000);
});

test('xiaoji pack：每张 sprite sheet 存在且尺寸与 manifest 一致', () => {
  for (const [name, animation] of Object.entries(pack.animations)) {
    const path = join(PET, animation.sheet);
    assert.ok(existsSync(path), `${name} 缺少 sheet：${animation.sheet}`);
    const size = pngSize(path);
    assert.equal(size.height, animation.frameH, `${name} 高度不对`);
    assert.equal(size.width, animation.frameW * animation.cols, `${name} 宽度不对`);
    assert.ok(animation.frames.length > 0, `${name} 没有帧`);
    for (const frame of animation.frames) {
      assert.ok(frame.i >= 0 && frame.i < animation.cols, `${name} 帧索引越界`);
      assert.ok(frame.ms >= 40, `${name} 帧时长过短`);
    }
  }
});

test('xiaoji pack：完成/唤醒/交互是一次性动画，其余循环', () => {
  const oneshot = ['notification', 'waking', 'react-left', 'react-right', 'react-tickle', 'react-drag'];
  for (const [name, animation] of Object.entries(pack.animations)) {
    assert.equal(animation.loop, !oneshot.includes(name), `${name} 循环标记不对`);
  }
});

test('xiaoji pack：状态机在真实 pack 上能跑', async () => {
  const { PetStateMachine } = await import('../app/src/pet/PetStateMachine');
  // 最短展示 600ms 是产品要求；测试里设为 0，只看映射不等待
  const fast = {
    ...pack,
    timings: { ...pack.timings, minDisplayMs: 0, sleepAfterMs: 60_000 },
  } as unknown as import('../app/src/pet/types').PetPack;
  const machine = new PetStateMachine(fast);
  try {
    machine.updateContext({ runningCount: 1, waitingApprovalCount: 0 });
    assert.equal(machine.state, 'working');
    assert.equal(machine.animation, 'working');
    machine.updateContext({ runningCount: 1, waitingApprovalCount: 0, thinking: true });
    assert.equal(machine.state, 'thinking');
    assert.equal(machine.animation, 'thinking');
    machine.updateContext({ runningCount: 2, waitingApprovalCount: 0 });
    assert.equal(machine.state, 'juggling');
    machine.updateContext({ runningCount: 3, waitingApprovalCount: 0 });
    assert.equal(machine.state, 'sweeping');
    machine.updateContext({ runningCount: 0, waitingApprovalCount: 1 });
    assert.equal(machine.state, 'attention');
    machine.updateContext({ runningCount: 0, waitingApprovalCount: 0 });
    assert.equal(machine.state, 'notification');
  } finally {
    machine.destroy();
  }
});
