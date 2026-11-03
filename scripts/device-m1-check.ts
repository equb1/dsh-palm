/**
 * M1 真机验收：装测试包 → 工作区自检 → 连轻引擎（假模型）→ 提问/审批/流式。
 *
 *   node --import tsx scripts/device-m1-check.ts [apk路径]
 *
 * 前置：
 *   1. `adb reverse tcp:8799 tcp:8799`（本脚本会自己建）
 *   2. 另开一个终端跑 `node --import tsx scripts/mock-model-server.ts 8799`
 *   3. 手机连着 adb（无线调试）
 *
 * 测试包 applicationId 是 cool.cnb.dshpalm.m1，不影响手机上原有的正式包；
 * 所以 build.gradle 里那行是临时改的，验完要改回来。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import {
  adb,
  clearLogcat,
  dumpNodes,
  findNode,
  hideKeyboard,
  keyboardShown,
  keyevent,
  logcat,
  screenshot,
  shell,
  swipe,
  tapNode,
  tryTap,
  typeText,
  waitFor,
} from './device-ui';

const PKG = 'cool.cnb.dshpalm.m1';
const ACTIVITY = `${PKG}/cool.cnb.dshpalm.MainActivity`;
const MOCK_PORT = 8799;
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const APK = process.argv[2] ?? 'app/android/app/build/outputs/apk/release/app-release.apk';
const REPORT_DIR = 'artifacts/m1';

interface Step {
  name: string;
  ok: boolean;
  detail?: string;
}

const steps: Step[] = [];

function note(message: string): void {
  console.log(`[check] ${message}`);
}

async function step(name: string, body: () => Promise<void>): Promise<void> {
  const started = Date.now();
  try {
    await body();
    steps.push({ name, ok: true });
    note(`✅ ${name}（${Date.now() - started}ms）`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push({ name, ok: false, detail: message });
    try {
      screenshot(`fail-${name.replace(/[^\w]+/g, '-')}`);
    } catch {
      /* 截图失败就算了 */
    }
    const visible = dumpNodes().filter((node) => node.text || node.desc);
    console.error('[check] 当前可见节点：');
    for (const node of visible.slice(0, 60)) {
      console.error(JSON.stringify({ text: node.text, desc: node.desc }));
    }
    throw new Error(`${name}：${message}`);
  }
}

async function requireText(needle: string, timeout = 15): Promise<void> {
  const node = await waitFor(needle, timeout);
  if (!node) throw new Error(`等不到「${needle}」（${timeout}s）`);
}

/** 系统权限弹窗会挡住 App；能预授权的已预授权，这里只兜底点掉 */
function dismissPermissionDialog(): void {
  const nodes = dumpNodes();
  const hasDialog = nodes.some((node) => node.text.includes('通知') && node.text.includes('允许'));
  if (!hasDialog) return;
  const allow = findNode(nodes, '允许');
  if (allow) {
    tapNode(allow);
    note('点掉了系统通知权限弹窗');
  }
}

/** 往下滚着找；找不到再滚回顶部找一圈 */
async function scrollTo(needle: string, maxSwipes = 8): Promise<ReturnType<typeof findNode>> {
  for (let i = 0; i < maxSwipes; i += 1) {
    const node = findNode(dumpNodes(), needle);
    if (node) return node;
    swipe('up');
    await delay(500);
  }
  for (let i = 0; i < maxSwipes; i += 1) {
    const node = findNode(dumpNodes(), needle);
    if (node) return node;
    swipe('down');
    await delay(400);
  }
  return undefined;
}

async function fillField(label: string, value: string, verify = false): Promise<void> {
  // 键盘会盖住下面的输入框：uiautomator 照样报坐标，但点下去是点在键盘上
  hideKeyboard();
  await delay(300);
  const node = await scrollToInput(label, 8);
  if (!node) throw new Error(`找不到输入框「${label}」`);
  tapNode(node);
  await delay(400);
  keyevent('MOVE_END');
  shell('for i in $(seq 1 160); do input keyevent 67; done');
  await delay(200);
  typeText(value);
  await delay(300);
  if (verify) {
    const check = findInput(dumpNodes(), label);
    if (!check?.text.includes(value)) {
      throw new Error(`输入没有生效：期望「${value}」，实际「${check?.text ?? ''}」`);
    }
  }
}

/** 输入框的 accessibilityLabel 在 content-desc 上；文本同名时优先 desc（API Key 的标签和输入框同名） */
function findInput(nodes: ReturnType<typeof dumpNodes>, label: string): ReturnType<typeof findNode> {
  return (
    nodes.find((node) => node.desc === label) ??
    nodes.find((node) => node.desc.includes(label)) ??
    nodes.find((node) => node.text === label) ??
    nodes.find((node) => node.text.includes(label))
  );
}

async function scrollToInput(label: string, maxSwipes = 8): Promise<ReturnType<typeof findNode>> {
  for (let i = 0; i < maxSwipes; i += 1) {
    const node = findInput(dumpNodes(), label);
    if (node) return node;
    swipe('up');
    await delay(500);
  }
  for (let i = 0; i < maxSwipes; i += 1) {
    const node = findInput(dumpNodes(), label);
    if (node) return node;
    swipe('down');
    await delay(400);
  }
  return undefined;
}

/**
 * Gboard 默认是中文拼音：input text 会被 IME 折成全角/候选词。
 * KEYCODE_LANGUAGE_SWITCH(204) 切到英文后再输入就是原样 ASCII。
 */
async function ensureAsciiKeyboard(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    hideKeyboard();
    await delay(250);
    const field = await scrollToInput('模型 Base URL', 8);
    if (!field) throw new Error('找不到 Base URL 输入框');
    tapNode(field);
    await delay(400);
    keyevent('MOVE_END');
    shell('for i in $(seq 1 160); do input keyevent 67; done');
    keyevent('204');
    await delay(250);
    typeText('ascii-probe');
    await delay(400);
    const check = findInput(dumpNodes(), '模型 Base URL');
    if (check?.text.includes('ascii-probe')) {
      note('键盘已切到 ASCII');
      return;
    }
    note(`键盘还没切到 ASCII（第 ${attempt + 1} 次）：${check?.text ?? ''}`);
  }
  throw new Error('Gboard 切不到英文输入');
}

async function main(): Promise<void> {
  mkdirSync(REPORT_DIR, { recursive: true });
  if (!existsSync(APK)) throw new Error(`找不到 APK：${APK}`);
  note(`APK = ${APK}`);

  await step('adb 连接与反向端口', async () => {
    const devices = shell('getprop ro.product.model').trim();
    note(`设备型号 = ${devices}`);
    adb(['reverse', `tcp:${MOCK_PORT}`, `tcp:${MOCK_PORT}`]);
    await delay(500);
    const health = shell(`curl -s --max-time 5 http://127.0.0.1:${MOCK_PORT}/health`).trim();
    if (!health.includes('ok')) throw new Error(`手机访问不到 mock 服务：${health}`);
  });

  await step('安装测试包', async () => {
    const out = shell(`pm list packages ${PKG}`).trim();
    note(out || '（未安装）');
    const install = String(adb(['install', '-r', APK])).trim();
    note(install.split('\n').slice(-3).join(' '));
    if (!/success/i.test(install)) throw new Error(`安装失败：${install}`);
    // 连接时 App 会申请通知权限：能预授权最好，不行就靠 dismissPermissionDialog 兜底
    try {
      shell(`pm grant ${PKG} android.permission.POST_NOTIFICATIONS`);
    } catch {
      note('pm grant 被系统拒绝（华为/Android 16 不给 shell 授权），改为运行时点掉弹窗');
    }
  });

  await step('启动 App', async () => {
    clearLogcat();
    shell(`am force-stop ${PKG}`);
    await delay(500);
    shell(`am start -n ${ACTIVITY}`);
    await requireText('设置 · 账号 / 引擎', 40);
    screenshot('01-connect');
  });

  await step('进入设置 → 实验室', async () => {
    if (!tryTap('设置 · 账号 / 引擎')) {
      const row = await waitFor('设置', 10);
      if (!row) throw new Error('找不到设置入口');
      tapNode(row);
    }
    // 设置页很长，实验室在下面：滚着找标题和入口
    const title = await scrollTo('实验室 · M1', 8);
    if (!title) throw new Error('设置页里找不到「实验室 · M1」');
    const entry = await scrollTo('轻引擎（工作区 + 模型）', 4);
    if (!entry) throw new Error('找不到「轻引擎（工作区 + 模型）」');
    tapNode(entry);
    await requireText('运行自检', 15);
    screenshot('02-light-lab');
  });

  await step('工作区自检（真实目录）', async () => {
    if (!tryTap('运行自检')) throw new Error('点不到「运行自检」');
    await requireText('条命令', 60);
    await delay(800);
    screenshot('03-selfcheck');
    const lines = logcat('ReactNativeJS', 400).filter((line) => line.includes('[selfcheck]'));
    note(lines.length > 0 ? lines.slice(-12).join('\n') : '（logcat 里没有 [selfcheck]，看界面结果）');
    const failed = findNode(dumpNodes(), '条命令失败');
    if (failed) throw new Error('自检有失败项（见截图 03-selfcheck）');
  });

  await step('配置假模型并连接轻引擎', async () => {
    await ensureAsciiKeyboard();
    await fillField('模型 Base URL', MOCK_URL, true);
    await fillField('模型名', 'mock-model');
    await fillField('API Key', 'test-key');
    hideKeyboard(); // 收键盘
    await delay(400);
    const button = await scrollTo('连接轻引擎', 6);
    if (!button) throw new Error('找不到「连接轻引擎」按钮');
    tapNode(button);
    // 连接成功后 App 会申请通知权限：弹窗会在几秒内出现，边等边点掉
    let reached = false;
    for (let i = 0; i < 40; i += 1) {
      dismissPermissionDialog();
      if (findNode(dumpNodes(), '模型与凭据')) {
        reached = true;
        break;
      }
      await delay(700);
    }
    if (!reached) throw new Error('连接后没回到设置页');
    screenshot('04-after-connect');
    const lines = logcat('ReactNativeJS', 200).filter((line) => line.includes('[light]'));
    note(lines.slice(-4).join('\n'));
  });

  await step('回到首页并发送消息', async () => {
    keyevent('BACK'); // 设置 → 首页
    await requireText('给锦囊发消息', 20);
    await fillField('输入框', 'make a demo file please');
    if (!tryTap('发送')) {
      hideKeyboard();
      await delay(300);
      if (!tryTap('发送')) throw new Error('点不到「发送」');
    }
    await requireText('纪要要什么格式', 45);
    screenshot('05-question');
  });

  await step('回答提问', async () => {
    const option = await scrollTo('Markdown', 4);
    if (!option) throw new Error('点不到选项「Markdown」');
    tapNode(option);
    await requireText('执行命令', 45);
    screenshot('06-approval');
  });

  await step('批准 bash 并等流式收尾', async () => {
    const approve = await scrollTo('批准', 4);
    if (!approve) throw new Error('点不到「批准」');
    tapNode(approve);
    await requireText('真机链路跑通了', 60);
    await delay(500);
    screenshot('07-done');
  });

  await step('核对工作区与日志', async () => {
    const lines = logcat('ReactNativeJS', 300);
    const samples = lines.filter((line) => line.includes('[selfcheck]') || line.includes('[light]'));
    const report = {
      when: new Date().toISOString(),
      steps,
      logs: samples.slice(-40),
    };
    writeFileSync(`${REPORT_DIR}/report.json`, JSON.stringify(report, null, 2));
    note('logcat 摘要：\n' + samples.slice(-15).join('\n'));
  });

  note('全部通过');
  writeFileSync(`${REPORT_DIR}/report.json`, JSON.stringify({ when: new Date().toISOString(), steps }, null, 2));
}

void main().catch((error: unknown) => {
  console.error('[check] 失败：', error instanceof Error ? error.message : String(error));
  writeFileSync(`${REPORT_DIR}/report.json`, JSON.stringify({ when: new Date().toISOString(), steps }, null, 2));
  process.exit(1);
});
