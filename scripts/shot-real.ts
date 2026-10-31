/** 让 App 连真引擎桥，截图：首页 → 抽屉 → 会话 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const APP = 'http://127.0.0.1:8099/';
const ENGINE = process.argv[2] ?? 'ws://127.0.0.1:8788/ws';
const OUT = process.argv[3] ?? 'artifacts';
mkdirSync(OUT, { recursive: true });

async function main(): Promise<void> {
  const list = (await (await fetch('http://127.0.0.1:9222/json/list')).json()) as any[];
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((r) => ws.once('open', () => r()));

  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as { id?: number; result?: any };
    if (m.id !== undefined) pending.get(m.id)?.(m.result);
  });
  const send = (method: string, params?: unknown): Promise<any> =>
    new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params: params ?? {} }));
    });
  const ev = async (expr: string): Promise<any> =>
    (await send('Runtime.evaluate', { expression: expr, returnByValue: true }))?.result?.value;
  const shot = async (name: string): Promise<void> => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
    console.log('  shot ->', name);
  };
  const waitText = async (needle: string, ms = 15000): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const t = (await ev('document.body ? document.body.innerText : ""')) as string;
      if (t && t.includes(needle)) return;
      await delay(300);
    }
    throw new Error('等待文本超时: ' + needle);
  };
  const click = (label: string): Promise<string> =>
    ev(`(() => {
      const el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
      if (!el) return 'not-found:${label}';
      el.click();
      return 'clicked:${label}';
    })()`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: APP });
  await waitText('装进口袋的智能体');

  await ev(`(() => {
    const el = document.querySelector('input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(ENGINE)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`);
  await delay(200);
  console.log(await click('连接'));

  await waitText('需要我做点什么');
  await delay(800);
  await shot('real-01-home');

  console.log(await click('打开会话列表'));
  await delay(800);
  await shot('real-02-drawer');

  // 点第一条真实会话
  const opened = await ev(`(() => {
    const rows = [...document.querySelectorAll('[aria-label^="会话："]')];
    if (!rows.length) return 'no-session';
    rows[0].click();
    return 'opened:' + rows[0].getAttribute('aria-label');
  })()`);
  console.log(opened);
  await delay(1500);
  await shot('real-03-chat');

  ws.close();
}

void main().catch((err) => {
  console.error('FAILED', err.message);
  process.exit(1);
});
