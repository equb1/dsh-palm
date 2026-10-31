/** 抓真 dsh web 的 WebSocket 帧格式 */
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const URL_ARG = process.argv[2] ?? 'http://127.0.0.1:8899/';

async function main(): Promise<void> {
  const list = (await (await fetch('http://127.0.0.1:9222/json/list')).json()) as any[];
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((r) => ws.once('open', () => r()));

  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const frames: Array<{ dir: string; len: number; preview: string }> = [];

  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as { id?: number; method?: string; params?: any };
    if (m.id !== undefined) {
      pending.get(m.id)?.(m);
      return;
    }
    if (m.method === 'Network.webSocketFrameSent' || m.method === 'Network.webSocketFrameReceived') {
      const p = m.params.response ?? m.params;
      const data = String(p.payloadData ?? '');
      frames.push({
        dir: m.method === 'Network.webSocketFrameSent' ? '→' : '←',
        len: p.payloadDataLength ?? data.length,
        preview: data.slice(0, 260),
      });
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
  await delay(9000);

  console.log(`frames: ${frames.length}`);
  for (const f of frames.slice(0, 24)) {
    console.log(`${f.dir} [${f.len}] ${f.preview.replace(/\s+/g, ' ')}`);
  }
  ws.close();
}

void main();
