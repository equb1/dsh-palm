/**
 * 真机 UI 小工具：用 adb + uiautomator 驱动 App，给 M1 真机验收用。
 *
 *   node --import tsx scripts/device-ui.ts dump [过滤词]
 *   node --import tsx scripts/device-ui.ts tap <文本/描述>
 *   node --import tsx scripts/device-ui.ts type <ASCII 文本>
 *   node --import tsx scripts/device-ui.ts key <KEYCODE>
 *   node --import tsx scripts/device-ui.ts swipe up|down
 *   node --import tsx scripts/device-ui.ts shot <名字>
 *   node --import tsx scripts/device-ui.ts wait <文本> [超时秒]
 *   node --import tsx scripts/device-ui.ts logcat <tag>
 *
 * 也导出给 `device-m1-check.ts` 复用。串口取 ADB_SERIAL，否则用唯一设备。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export const SERIAL = process.env.ADB_SERIAL ?? '';
export const OUT = 'artifacts';

export interface UiNode {
  text: string;
  desc: string;
  cls: string;
  bounds: { x1: number; y1: number; x2: number; y2: number };
}

export function adb(args: string[], binary = false): Buffer | string {
  const full = SERIAL ? ['-s', SERIAL, ...args] : args;
  return execFileSync('adb', full, {
    encoding: binary ? 'buffer' : 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }) as Buffer | string;
}

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function dumpNodes(): UiNode[] {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return dumpNodesOnce();
    } catch (error) {
      lastError = error;
      if (attempt < 2) sleepSync(250);
    }
  }
  throw lastError;
}

function dumpNodesOnce(): UiNode[] {
  adb(['shell', 'uiautomator', 'dump', '/sdcard/ui.xml']);
  const xml = String(adb(['exec-out', 'cat', '/sdcard/ui.xml']));
  if (!xml.includes('<hierarchy')) throw new Error('uiautomator dump 没有返回 hierarchy');
  const nodes: UiNode[] = [];
  for (const match of xml.matchAll(/<node\b([^>]*)>/g)) {
    const attrs = match[1] ?? '';
    const get = (name: string): string => {
      const found = new RegExp(`${name}="([^"]*)"`).exec(attrs);
      return found ? decodeAttr(found[1] ?? '') : '';
    };
    const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(get('bounds'));
    if (!bounds) continue;
    nodes.push({
      text: get('text'),
      desc: get('content-desc'),
      cls: get('class'),
      bounds: {
        x1: Number(bounds[1]),
        y1: Number(bounds[2]),
        x2: Number(bounds[3]),
        y2: Number(bounds[4]),
      },
    });
  }
  return nodes;
}

export function findNode(nodes: UiNode[], needle: string): UiNode | undefined {
  return (
    nodes.find((node) => node.text === needle) ??
    nodes.find((node) => node.desc === needle) ??
    nodes.find((node) => node.text.includes(needle)) ??
    nodes.find((node) => node.desc.includes(needle))
  );
}

export function tapNode(node: UiNode): void {
  const x = Math.round((node.bounds.x1 + node.bounds.x2) / 2);
  const y = Math.round((node.bounds.y1 + node.bounds.y2) / 2);
  adb(['shell', 'input', 'tap', String(x), String(y)]);
}

export function tryTap(needle: string): boolean {
  const node = findNode(dumpNodes(), needle);
  if (!node) return false;
  tapNode(node);
  return true;
}

export async function waitFor(needle: string, timeoutSec = 15, intervalMs = 700): Promise<UiNode | undefined> {
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const node = findNode(dumpNodes(), needle);
    if (node) return node;
    if (Date.now() > deadline) return undefined;
    await delay(intervalMs);
  }
}

export async function waitGone(needle: string, timeoutSec = 15, intervalMs = 700): Promise<boolean> {
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const node = findNode(dumpNodes(), needle);
    if (!node) return true;
    if (Date.now() > deadline) return false;
    await delay(intervalMs);
  }
}

export function typeText(text: string): void {
  adb(['shell', 'input', 'text', text.replace(/ /g, '%s')]);
}

export function keyevent(code: string): void {
  adb(['shell', 'input', 'keyevent', code.toUpperCase()]);
}

export function swipe(direction: 'up' | 'down' = 'up'): void {
  const up = direction === 'up';
  const from = up ? 1800 : 600;
  const to = up ? 600 : 1800;
  adb(['shell', 'input', 'swipe', '540', String(from), '540', String(to), '250']);
}

export function screenshot(name: string): string {
  mkdirSync(OUT, { recursive: true });
  const file = `${OUT}/${name}.png`;
  writeFileSync(file, adb(['exec-out', 'screencap', '-p'], true) as Buffer);
  return file;
}

export function logcat(tag = 'ReactNativeJS', lines = 200): string[] {
  const text = String(adb(['logcat', '-d', '-s', tag]));
  return text.split('\n').slice(-lines);
}

export function clearLogcat(): void {
  adb(['logcat', '-c']);
}

export function shell(command: string): string {
  return String(adb(['shell', command]));
}

/** 键盘挡住的控件 uiautomator 也会报，所以点之前要先确认它没被键盘盖住 */
export function keyboardShown(): boolean {
  return shell('dumpsys input_method').includes('mInputShown=true');
}

export function hideKeyboard(): void {
  if (keyboardShown()) {
    keyevent('BACK');
  }
}

/* ------------------------------- CLI ------------------------------- */

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ');
  switch (command) {
    case 'dump': {
      const nodes = dumpNodes().filter((node) => node.text || node.desc);
      const filtered = arg ? nodes.filter((node) => node.text.includes(arg) || node.desc.includes(arg)) : nodes;
      for (const node of filtered) {
        console.log(
          JSON.stringify({ text: node.text, desc: node.desc, cls: node.cls.split('.').pop(), bounds: node.bounds }),
        );
      }
      console.log(`# ${filtered.length} nodes`);
      return;
    }
    case 'tap':
      if (!tryTap(arg)) throw new Error(`找不到：${arg}`);
      console.log(`tap ${arg}`);
      return;
    case 'type':
      typeText(arg);
      return;
    case 'key':
      keyevent(arg);
      return;
    case 'swipe':
      swipe(arg === 'down' ? 'down' : 'up');
      return;
    case 'shot':
      console.log(`shot -> ${screenshot(arg || 'shot')}`);
      return;
    case 'wait':
      if (!(await waitFor(rest[0] ?? '', Number(rest[1] ?? 15)))) throw new Error(`等待超时：${rest[0]}`);
      console.log(`found ${rest[0]}`);
      return;
    case 'logcat':
      console.log(logcat(arg || 'ReactNativeJS').join('\n'));
      return;
    default:
      console.log('未知命令；支持 dump/tap/type/key/swipe/shot/wait/logcat');
  }
}

if (process.argv[1]?.endsWith('device-ui.ts')) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
