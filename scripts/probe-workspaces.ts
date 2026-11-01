/** 探 workspace/follow 流的 baseline 形状 */
import WebSocket from 'ws';

import { DshRealClient } from '../engine/src/real/dshClient';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();
  const cookie = (client as unknown as { cookie: string }).cookie;
  const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/api/remote.mux', { headers: { cookie } } as never);
  const streamId = crypto.randomUUID();

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'open', streamId, endpoint: 'workspace/follow', payload: { args: {} } }));
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw)) as { streamId?: string; value?: unknown };
    if (msg.streamId !== streamId) return;
    console.log('RAW: ' + String(JSON.stringify(msg)).slice(0, 1200));
  });
  await new Promise((r) => setTimeout(r, 3000));
  ws.close();
  process.exit(0);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
