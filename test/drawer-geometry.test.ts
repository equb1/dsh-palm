import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DRAWER_WIDTH,
  drawerProgress,
  shouldCloseDrawer,
  shouldOpenDrawer,
} from '../app/src/ui/drawerGeometry';

describe('会话抽屉手势几何', () => {
  it('进度按抽屉宽度 clamp 到 0..1', () => {
    assert.equal(drawerProgress(-20), 0);
    assert.equal(drawerProgress(0), 0);
    assert.equal(drawerProgress(DRAWER_WIDTH / 2), 0.5);
    assert.equal(drawerProgress(DRAWER_WIDTH), 1);
    assert.equal(drawerProgress(DRAWER_WIDTH * 2), 1);
    assert.equal(drawerProgress(Number.NaN), 0);
  });

  it('打开：拉过 1/4 或向右甩', () => {
    assert.equal(shouldOpenDrawer(0.25, 0), false);
    assert.equal(shouldOpenDrawer(0.26, 0), true);
    assert.equal(shouldOpenDrawer(0.1, 0.31), true);
    assert.equal(shouldOpenDrawer(0.1, 0.3), false);
  });

  it('关闭：退到 72% 以下或向左甩', () => {
    assert.equal(shouldCloseDrawer(0.72, 0), false);
    assert.equal(shouldCloseDrawer(0.71, 0), true);
    assert.equal(shouldCloseDrawer(0.9, -0.36), true);
    assert.equal(shouldCloseDrawer(0.9, -0.35), false);
  });
});
