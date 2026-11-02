/**
 * 真模型验收：深链配好 provider → 发一条英文指令 → 批准 bash → 等流式收尾。
 *
 *   $env:LIGHT_BASE="https://api.deepseek.com/v1"
 *   $env:LIGHT_MODEL="deepseek-chat"
 *   $env:LIGHT_KEY="sk-…"
 *   node --import tsx scripts/device-real-check.ts [apk路径]
 *
 * Key 只从环境变量读，不落盘、不写进仓库；深链会出现在 adb 命令里，
 * 所以只用一次性测试 Key。测试包 applicationId 是 cool.cnb.dshpalm.m1。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import {
  adb,
  clearLogcat,
  dumpNodes,
  findNode,
  hideKeyboard,
  keyevent,
  logcat,
  screenshot,
  shell,
  tapNode,
  tryTap,
  typeText,
  waitFor,
} from './device-ui';

const PKG = 'cool.cnb.dshpalm.m1';
const ACTIVITY = `${PKG}/cool.cnb.dshpalm.MainActivity`;
const APK = process.argv[2] ?? 'app/android/app/build/outputs/apk/release/app-release.apk';
const BASE = process.env.LIGHT_BASE ?? '';
const MODEL = process.env.LIGHT_MODEL ?? '';
const KEY = process.env.LIGHT_KEY ?? '';
const NAME = process.env.LIGHT_NAME ?? 'DeepSeek';
const REPORT_DIR = 'artifacts/m1';

const PROMPT =
  'Use the bash tool to create hello.txt in the workspace with exactly the text real-model-ok, ' +
  'then cat it. Keep the final answer short and in Chinese.';

interface Step {
  name: string;
  ok: boolean;
  detail?: string;
  ms?: number;
}
const steps: Step[] = [];

function note(message: string): void {
  console.log(`[real] ${message}`);
}

async function step(name: string, body: () => Promise<void>): Promise<void> {
  const started = Date.now();
  try {
    await body();
    steps.push({ name, ok: true, ms: Date.now() - started });
    note(`✅ ${name}（${Date.now() - started}ms）`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push({ name, ok: false, detail: message, ms: Date.now() - started });
    try {
      screenshot(`real-fail-${name.replace(/[^\w]+/g, '-')}`);
    } catch {
      /* 截图失败就算了 */
    }
    throw new Error(`${name}：${message}`);
  }
}

function findInput(label: string): ReturnType<typeof findNode> {
  const nodes = dumpNodes();
  return nodes.find((node) => node.desc === label) ?? nodes.find((node) => node.desc.includes(label));
}

async function waitForAny(needles: string[], timeoutSec = 30): Promise<string | null> {
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const nodes = dumpNodes();
    for (const needle of needles) {
      if (findNode(nodes, needle)) return needle;
    }
    if (Date.now() > deadline) return null;
    await delay(700);
  }
}

/** 中文输入法会把 ASCII 折成全角；用 204 切到英文并验证 */
async function typeAscii(label: string, text: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    hideKeyboard();
    await delay(250);
    const field = findInput(label);
    if (!field) throw new Error(`找不到输入框「${label}」`);
    tapNode(field);
    await delay(350);
    keyevent('MOVE_END');
    shell('for i in $(seq 1 200); do input keyevent 67; done');
    if (attempt === 0) keyevent('204');
    await delay(200);
    typeText('ascii-probe');
    await delay(350);
    const check = findInput(label);
    const ok = check?.text.includes('ascii-probe') ?? false;
    shell('for i in $(seq 1 200); do input keyevent 67; done');
    if (ok) {
      typeText(text);
      await delay(300);
      return;
    }
    note(`输入法还不是 ASCII（第 ${attempt + 1} 次）：${check?.text ?? ''}`);
    keyevent('204');
    await delay(200);
  }
  throw new Error('切不到 ASCII 输入');
}

function deepLink(): string {
  const params = new URLSearchParams({ base: BASE, model: MODEL, key: KEY, name: NAME });
  return `dshpalm://light?${params.toString()}`;
}

async function main(): Promise<void> {
  mkdirSync(REPORT_DIR, { recursive: true });
  if (!BASE || !MODEL || !KEY) throw new Error('缺少 LIGHT_BASE / LIGHT_MODEL / LIGHT_KEY 环境变量');
  if (!existsSync(APK)) throw new Error(`找不到 APK：${APK}`);

  await step('安装并启动', async () => {
    const install = String(adb(['install', '-r', APK])).trim();
    if (!/success/i.test(install)) throw new Error(`安装失败：${install}`);
    clearLogcat();
    shell(`am force-stop ${PKG}`);
    await delay(400);
    // 直接带深链冷启动：App 收到 dshpalm://light 就会配置并连接轻引擎
    shell(
      `am start -a android.intent.action.VIEW -d "${deepLink()}" -n ${ACTIVITY}`,
    );
    const reached = await waitForAny(['给锦囊发消息', '轻引擎'], 60);
    if (!reached) throw new Error('等不到首页（深链可能没触发连接）');
    await delay(800);
    screenshot('10-real-home');
    const lines = logcat('ReactNativeJS', 120).filter((line) => line.includes('[light]'));
    note(lines.slice(-3).join('\n'));
    const modelVisible = findNode(dumpNodes(), MODEL);
    if (!modelVisible) note(`（首页没显示模型名 ${MODEL}，继续）`);
  });

  await step('发送指令（英文，避免中文 IME）', async () => {
    await typeAscii('输入框', PROMPT);
    hideKeyboard();
    await delay(300);
    if (!tryTap('发送')) throw new Error('点不到「发送」');
    const card = await waitForAny(['执行命令', '需要你确认'], 120);
    if (!card) throw new Error('等不到审批卡');
    await delay(400);
    screenshot('11-real-approval');
    note(`收到审批卡：${logcat('ReactNativeJS', 40).slice(-2).join(' ')}`);
  });

  await step('批准并等流式收尾', async () => {
    const approve = findNode(dumpNodes(), '批准');
    if (!approve) throw new Error('找不到「批准」');
    tapNode(approve);
    // 流式中间截一张，证明不是等整段
    await delay(1200);
    screenshot('12-real-stream');
    const done = await waitForAny(['就绪'], 180);
    if (!done) throw new Error('180s 内没有回到就绪');
    await delay(600);
    screenshot('13-real-done');
    const nodes = dumpNodes();
    const sawContent = findNode(nodes, 'real-model-ok');
    note(sawContent ? '回答里看到了真实文件内容' : '回答里没直接出现 real-model-ok（模型可能只复述）');
    const text = nodes
      .filter((node) => node.text.length > 20)
      .map((node) => node.text)
      .slice(-6)
      .join('\n---\n');
    writeFileSync(`${REPORT_DIR}/real-answer.txt`, text);
  });

  await step('记录日志', async () => {
    const lines = logcat('ReactNativeJS', 300);
    const errors = lines.filter((line) => /error|Error|exception/i.test(line));
    const light = lines.filter((line) => line.includes('[light]'));
    writeFileSync(
      `${REPORT_DIR}/real-report.json`,
      JSON.stringify({ when: new Date().toISOString(), model: MODEL, base: BASE, steps, light }, null, 2),
    );
    note(`[light] 行：\n${light.slice(-5).join('\n')}`);
    if (errors.length > 0) note(`logcat 报错行（前 8 条）：\n${errors.slice(0, 8).join('\n')}`);
  });

  note('全部完成');
}

void main().catch((error: unknown) => {
  console.error('[real] 失败：', error instanceof Error ? error.message : String(error));
  try {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(
      `${REPORT_DIR}/real-report.json`,
      JSON.stringify({ when: new Date().toISOString(), model: MODEL, base: BASE, steps }, null, 2),
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
