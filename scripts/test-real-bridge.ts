/**
 * 真引擎桥的端到端验证：
 * 起桥 → 用我们的 EngineClient 连上去 → 读真实会话列表和详情。
 */
import WebSocket from 'ws';

import { EngineClient, type WebSocketCtor } from '../app/src/lib/client';
import { startRealBridge } from '../engine/src/real/server';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8899';
const token = process.argv[3] ?? '';

async function main(): Promise<void> {
  if (!token) {
    console.error('用法: node --import tsx scripts/test-real-bridge.ts <baseUrl> <token>');
    process.exit(1);
  }

  const bridge = await startRealBridge({ baseUrl, token, port: 0 });
  console.log('bridge port:', bridge.port);

  const client = new EngineClient({
    url: `ws://127.0.0.1:${bridge.port}/ws`,
    webSocketImpl: WebSocket as unknown as WebSocketCtor,
    autoReconnect: false,
  });

  const caps = await client.connect();
  console.log('宿主:', caps.host.name, '| kind =', caps.host.kind);
  console.log('预设:', caps.presets.map((p) => `${p.id}(${p.name})`).join(', '));

  const { sessions } = await client.request('sessions.list', {});
  console.log('会话数:', sessions.length);
  for (const s of sessions) {
    console.log('  -', s.title, '|', s.status, '|', s.preview, '|', new Date(s.updatedAt).toLocaleString());
  }

  if (sessions[0]) {
    const { session } = await client.request('sessions.get', { sessionId: sessions[0].id });
    console.log('详情:', session.title, '| preset =', session.presetId, '| turns =', session.turns.length);

    // 未实现的方法必须给出可读错误，而不是静默失败
    try {
      await client.request('sessions.send', { sessionId: session.id, text: 'hi' });
      console.error('✗ sessions.send 本应报不支持');
    } catch (err) {
      console.log('sessions.send 预期内不支持:', (err as Error).message);
    }
  }

  client.close();
  await bridge.close();
  console.log('done');
}

void main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
