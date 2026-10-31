/** 端到端：连接 → 抽屉 → 模型与凭据 → 保存 Key → 状态变已配置 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const APP = 'http://127.0.0.1:8099/';
const ENGINE = process.argv[2] ?? 'ws://127.0.0.1:8787/ws';
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

  console.log(await click('打开会话列表'));
  await delay(600);
  console.log(await click('模型与凭据'));
  await waitText('DeepSeek API Key');
  await delay(600);
  await shot('cred-01-empty');

  // 填 Key
  await ev(`(() => {
    const el = document.querySelector('[aria-label="API Key"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'sk-demo-1234567890');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await delay(300);
  console.log(await click('保存'));
  await delay(1200);
  await shot('cred-02-saved');

  const text = (await ev('document.body.innerText')) as string;
  console.log('状态显示已配置:', text.includes('已配置'));
  ws.close();
}

void main().catch((err) => {
  console.error('FAILED', err.message);
  process.exit(1);
});
