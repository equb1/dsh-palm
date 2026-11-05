/**
 * 真机 UI 回归（E5 第一步）：用 adb + uiautomator 跑一遍关键路径。
 *
 * 前置：设备已连接（无线 adb）、Metro 8081 在跑、当前分支 bundle 已加载过。
 *   node --import tsx scripts/device-regression.ts
 *
 * 覆盖：冷启动 → 会话抽屉（筛选/全部功能）→ 全部功能网格 → 文件浏览 →
 * 返回 → 设置首页（6 组）。失败时抛出并保留截图。
 */
import assert from 'node:assert/strict';

import { adb, dumpNodes, hideKeyboard, keyevent, screenshot, tryTap, typeText, waitFor } from './device-ui';

const PKG = 'cool.cnb.dshpalm';

function textNodes(): string[] {
  return dumpNodes()
    .map((node) => `${node.text} ${node.desc}`.trim())
    .filter(Boolean);
}

function hasText(needle: string): boolean {
  return textNodes().some((text) => text.includes(needle));
}

function step(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error: unknown) => {
      screenshot(`ui-regression-fail-${name.replace(/[^a-z0-9]+/gi, '-')}`);
      throw error;
    });
}

async function main(): Promise<void> {
  await step('冷启动到首页', async () => {
    adb(['shell', `am force-stop ${PKG}`]);
    adb(['shell', `am start -W -n ${PKG}/.MainActivity`]);
    const home = await waitFor('需要我做点什么？', 40);
    assert.ok(home, '首页问候没出现（bundle/引擎没起？）');
  });

  await step('抽屉筛选与全部功能入口', async () => {
    assert.ok(tryTap('打开会话列表'), '抽屉按钮没找到');
    assert.ok(await waitFor('全部功能', 10), '抽屉里没有全部功能');
    assert.ok(hasText('待确认'), '筛选胶囊缺失');
    assert.ok(hasText('未读'), '筛选胶囊缺失');
  });

  await step('全部功能卡片网格', async () => {
    assert.ok(tryTap('全部功能'), '点不到全部功能');
    assert.ok(await waitFor('新对话', 10), '全部功能网格没出现');
    assert.ok(hasText('文件'), '文件卡片缺失');
    assert.ok(hasText('终端'), '终端卡片缺失');
    assert.ok(hasText('插件'), '插件卡片缺失');
  });

  await step('文件浏览根目录', async () => {
    assert.ok(tryTap('文件'), '点不到文件卡片');
    assert.ok(await waitFor('工作区', 10), '文件页没出现');
    assert.ok(hasText('目录') || hasText('文件'), '目录列表为空');
    screenshot('ui-regression-files');
  });

  await step('返回首页', async () => {
    keyevent('BACK');
    assert.ok(await waitFor('需要我做点什么？', 10), '返回后没回首页');
  });

  await step('设置首页 6 组', async () => {
    assert.ok(tryTap('打开会话列表'), '抽屉按钮没找到');
    assert.ok(await waitFor('账号与设置', 10), '抽屉底部账号行没出现');
    assert.ok(tryTap('账号与设置'), '点不到设置');
    assert.ok(await waitFor('搜索设置', 10), '设置页没出现');
    assert.ok(hasText('AI'), 'AI 组缺失');
    assert.ok(hasText('能力'), '能力组缺失');
    assert.ok(hasText('外观'), '外观组缺失');
    assert.ok(hasText('通用'), '通用组缺失');
    screenshot('ui-regression-settings');
  });

  await step('全文搜索', async () => {
    keyevent('BACK');
    assert.ok(await waitFor('需要我做点什么？', 10), '设置返回后没回首页');
    assert.ok(tryTap('打开会话列表'), '抽屉按钮没找到');
    assert.ok(await waitFor('全文', 10), '抽屉里没有全文入口');
    assert.ok(tryTap('全文'), '点不到全文搜索');
    assert.ok(await waitFor('搜索会话', 10), '搜索页没出现');
    typeText('python');
    assert.ok(await waitFor('处匹配', 15), '正文搜索没有结果');
    screenshot('ui-regression-search');
    hideKeyboard();
    await new Promise((resolve) => setTimeout(resolve, 300));
    keyevent('BACK');
    assert.ok(await waitFor('需要我做点什么？', 10), '搜索返回后没回首页');
  });

  console.log('\n真机 UI 回归通过（E5 第一步）');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
