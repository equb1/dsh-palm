/**
 * 验证"单文件桥"功能完好：连上去 -> 列会话 -> 建会话 -> 发消息 -> 收流式。
 *
 *   node --import tsx scripts/test-bundled-bridge.ts <wsPort>
 */
import WebSocket from 'ws';

import { EngineClient, type WebSocketCtor } from '../app/src/lib/client';

const port = process.argv[2] ?? '8799';

async function main(): Promise<void> {
  const client = new EngineClient({
    url: `ws://127.0.0.1:${port}/ws`,
    webSocketImpl: WebSocket as unknown as WebSocketCtor,
    autoReconnect: false,
  });
  await client.connect();

  const caps = await client.request('capabilities.get', {});
  console.log('host:', caps.host.name, '| engine:', caps.host.engineVersion ?? '-');

  const { sessions } = await client.request('sessions.list', {});
  console.log('会话数:', sessions.length);

  const { session } = await client.request('sessions.create', { presetId: 'standard', title: '单文件桥验证' });
  console.log('已建会话:', session.id);

  let deltas = 0;
  let finished = false;
  client.onAny((e) => {
    if (e.event === 'block.delta') deltas++;
    if (e.event === 'run.finished') finished = true;
  });

  await client.request('sessions.get', { sessionId: session.id });
  await client.request('sessions.send', { sessionId: session.id, text: '用五个字回答：你好' });
  console.log('已发送，等流式…');

  for (let i = 0; i < 40 && !finished; i++) await new Promise((r) => setTimeout(r, 500));

  console.log('增量数:', deltas, '| run.finished:', finished);
  client.close();
  process.exit(deltas > 0 ? 0 : 1);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
