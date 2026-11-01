/**
 * 流式端到端：桥把真引擎的 assistant-stream 翻成我们的 block.delta。
 *
 *   node --import tsx scripts/test-real-stream.ts <baseUrl> <token>
 */
import WebSocket from 'ws';

import { EngineClient, type WebSocketCtor } from '../app/src/lib/client';
import { startRealBridge } from '../engine/src/real/server';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';

async function main(): Promise<void> {
  const bridge = await startRealBridge({ baseUrl, token, port: 0, pairCode: '' });
  const client = new EngineClient({
    url: `ws://127.0.0.1:${bridge.port}/ws`,
    webSocketImpl: WebSocket as unknown as WebSocketCtor,
    autoReconnect: false,
  });
  await client.connect();

  const { sessions } = await client.request('sessions.list', {});
  const target = sessions[0] ?? (await client.request('sessions.create', { presetId: 'standard' })).session;
  console.log('会话:', target.id);

  // 打开会话 -> 桥开始跟流
  await client.request('sessions.get', { sessionId: target.id });

  const counts = new Map<string, number>();
  let streamed = '';
  const turnsSeen = new Set<string>();

  client.onAny((e) => {
    counts.set(e.event, (counts.get(e.event) ?? 0) + 1);
    if (e.event === 'block.delta') {
      const d = e.data as { text: string };
      streamed += d.text;
    }
    if (e.event === 'run.started') {
      const d = e.data as { turnId: string };
      turnsSeen.add(d.turnId);
    }
  });

  await client.request('sessions.send', { sessionId: target.id, text: '用三句话介绍杭州' });
  console.log('已发送，收集 20 秒事件…');
  await new Promise((r) => setTimeout(r, 20_000));

  console.log('\n事件统计:');
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);

  console.log('\n流式拼出来的文本（前 200 字）:');
  console.log('  ' + streamed.slice(0, 200).replace(/\n/g, ' '));

  console.log('\nrun 数:', turnsSeen.size, '| 流式字符数:', streamed.length);

  if (streamed.length === 0) {
    console.error('✗ 没收到任何 block.delta');
    process.exitCode = 1;
  }

  client.close();
  await bridge.close();
  process.exit(0);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
