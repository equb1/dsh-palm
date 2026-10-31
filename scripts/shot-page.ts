/** 打开一个页面并截图（通用工具） */
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const URL_ARG = process.argv[2] ?? 'http://127.0.0.1:8099/';
const OUT = process.argv[3] ?? 'artifacts/page.png';
const WAIT = Number(process.argv[4] ?? 3500);

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

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: URL_ARG });
  await delay(WAIT);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT, Buffer.from(r.data, 'base64'));
  console.log('saved', OUT);
  ws.close();
}

void main();
