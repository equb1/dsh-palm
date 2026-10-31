/** 打开真 dsh web，抓 Network 请求，摸清 API 面 */
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const URL_ARG = process.argv[2] ?? 'http://127.0.0.1:8899/';
const OUT = process.argv[3] ?? 'artifacts/real-dsh-network.json';

async function main(): Promise<void> {
  const list = (await (await fetch('http://127.0.0.1:9222/json/list')).json()) as any[];
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((r) => ws.once('open', () => r()));

  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const requests: any[] = [];

  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as { id?: number; method?: string; params?: any };
    if (m.id !== undefined) {
      pending.get(m.id)?.(m);
      return;
    }
    if (m.method === 'Network.requestWillBeSent') {
      const r = m.params.request;
      requests.push({ url: r.url, method: r.method, type: m.params.type });
    }
    if (m.method === 'Network.webSocketCreated') {
      requests.push({ url: m.params.url, method: 'WS', type: 'websocket' });
    }
  });

  const send = (method: string, params?: unknown): Promise<any> =>
    new Promise((res) => {
      const mid = ++id;
      pending.set(mid, (m) => res(m.result));
      ws.send(JSON.stringify({ id: mid, method, params: params ?? {} }));
    });

  await send('Network.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.navigate', { url: URL_ARG });

  await delay(12_000);

  const api = requests.filter(
    (r) => !/\.(js|css|png|svg|woff2?|ico)(\?|$)/.test(r.url) && !r.url.startsWith('data:'),
  );

  console.log('--- 请求 ---');
  for (const r of api) console.log(`${r.method.padEnd(6)} ${r.type.padEnd(10)} ${r.url.slice(0, 160)}`);

  writeFileSync(OUT, JSON.stringify(requests, null, 2));

  const text = await send('Runtime.evaluate', {
    expression: 'document.body ? document.body.innerText.slice(0, 600) : ""',
    returnByValue: true,
  });
  console.log('--- 页面文本 ---');
  console.log(text.result.value);

  ws.close();
}

void main();
