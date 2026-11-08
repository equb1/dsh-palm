import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PetRuntime } from '../app/src/pet/PetRuntime';
import type { PetAnimation } from '../app/src/pet/types';

const anim = (over: Partial<PetAnimation> = {}): PetAnimation => ({
  sheet: 'idle.png',
  frameW: 128,
  frameH: 128,
  cols: 4,
  frames: [
    { i: 0, ms: 100 },
    { i: 1, ms: 100 },
    { i: 2, ms: 100 },
    { i: 3, ms: 100 },
  ],
  loop: true,
  ...over,
});

test('逐帧推进：按 ms 换帧', () => {
  const rt = new PetRuntime();
  rt.play(anim());
  assert.equal(rt.frameIndex, 0);
  assert.equal(rt.advance(50), null, '半帧不换');
  const f = rt.advance(60);
  assert.equal(f?.index, 1);
  assert.equal(f?.frame.i, 1);
});

test('循环动画回到第一帧', () => {
  const rt = new PetRuntime();
  rt.play(anim());
  rt.advance(350); // 0→1→2
  const f = rt.advance(50); // 3 帧走完，回 0
  assert.equal(f?.index, 0);
  assert.equal(f?.finished, false);
});

test('一次性动画停在最后一帧并标记 finished', () => {
  const rt = new PetRuntime();
  rt.play(anim({ frames: [
    { i: 0, ms: 50 },
    { i: 1, ms: 50 },
  ], loop: false }));
  const f = rt.advance(200);
  assert.equal(f?.finished, true);
  assert.equal(f?.index, 1);
  assert.equal(rt.advance(1000), null, '播完不再推进');
});

test('同一动画默认不重播，restart 可强制从头', () => {
  const rt = new PetRuntime();
  const idle = anim();
  rt.play(idle);
  rt.advance(160);
  assert.equal(rt.frameIndex, 1);
  assert.equal(rt.play(idle), false);
  assert.equal(rt.play(idle, { restart: true }), true);
  assert.equal(rt.frameIndex, 0);
});

test('超大 delta 不会卡死', () => {
  const rt = new PetRuntime();
  rt.play(anim());
  const f = rt.advance(10_000_000);
  assert.ok(f);
  assert.ok(rt.frameIndex >= 0 && rt.frameIndex < 4);
});

test('空动画/非法 delta 安全返回 null', () => {
  const rt = new PetRuntime();
  assert.equal(rt.advance(16), null);
  rt.play(anim({ frames: [] }));
  assert.equal(rt.advance(16), null);
  assert.equal(rt.advance(Number.NaN), null);
  assert.equal(rt.advance(-1), null);
});
