/** 抓真 dsh web 的 /api 请求体与响应体 */
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const URL_ARG = process.argv[2] ?? 'http://127.0.0.1:8899/';
const OUT = process.argv[3] ?? 'artifacts/real-dsh-api.json';

async function main(): Promise<void> {
  const list = (await (await fetch('http://127.0.0.1:9222/json/list')).json()) as any[];
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((r) => ws.once('open', () => r()));

  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const wanted = new Map<string, { url: string; method: string; postData?: string }>();
  const samples: any[] = [];

  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as { id?: number; method?: string; params?: any };
    if (m.id !== undefined) {
      pending.get(m.id)?.(m);
      return;
    }
    if (m.method === 'Network.requestWillBeSent') {
      const r = m.params.request;
      if (r.url.includes('/api/') && r.method === 'POST') {
        wanted.set(m.params.requestId, { url: r.url, method: r.method, postData: r.postData });
      }
    }
    if (m.method === 'Network.loadingFinished' && wanted.has(m.params.requestId)) {
      const info = wanted.get(m.params.requestId)!;
      void (async () => {
        try {
          const body = await send('Network.getResponseBody', { requestId: m.params.requestId });
          samples.push({ ...info, response: String(body.body).slice(0, 4000) });
        } catch {
          /* ignore */
        }
      })();
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
  await send('Page.navigate', { url: URL_ARG });
  await delay(10_000);

  // 抓 session/list 的完整响应
  const seen = new Set<string>();
  for (const s of samples) {
    const key = new URL(s.url).pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log('===' + key + ' ===');
    console.log('  req: ' + (s.postData ?? '(none)').slice(0, 300));
    console.log('  res: ' + s.response.slice(0, 700));
    console.log('');
  }

  writeFileSync(OUT, JSON.stringify(samples, null, 2));
  console.log('saved -> ' + OUT + '  (' + samples.length + ' samples)');
  ws.close();
}

void main();
