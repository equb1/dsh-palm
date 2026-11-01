/**
 * 探 session/control 这个 mux 端点需要什么参数（从错误信息里读 descriptor）。
 * 不发真实消息，只开流。
 */
import WebSocket from 'ws';

import { DshRealClient } from '../engine/src/real/dshClient';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8899';
const token = process.argv[3] ?? '';

async function openAndWait(cookie: string, endpoint: string, args: unknown): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/api/remote.mux', { headers: { cookie } } as never);
    const streamId = crypto.randomUUID();
    let acc: string[] = [];
    const done = (): void => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(acc.join('\n'));
    };
    const timer = setTimeout(done, 2500);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { streamId?: string; value?: unknown };
      if (msg.streamId !== streamId) return;
      acc.push(JSON.stringify(msg.value ?? msg).slice(0, 1200));
      if (acc.length >= 2) {
        clearTimeout(timer);
        done();
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      acc.push('WS 错误: ' + String((e as Error).message));
      done();
    });
  });
}

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();
  const cookie = (client as unknown as { cookie: string }).cookie;

  const sessions = await client.listSessions();
  const sid = sessions.items[0]?.sessionId;
  console.log('会话:', sid ?? '(无)');

  for (const args of [
    {},
    { request: {} },
    sid ? { request: { sessionId: sid } } : null,
  ]) {
    if (!args) continue;
    console.log('\n--- session/control args = ' + JSON.stringify(args));
    console.log(await openAndWait(cookie, 'session/control', args));
  }
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
