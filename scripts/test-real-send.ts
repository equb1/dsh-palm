/**
 * 真引擎发消息验证：真的往 session/prompt 里投一条。
 *
 *   node --import tsx scripts/test-real-send.ts <baseUrl> <token>
 *
 * 注意：隔离实例没有模型凭据，所以「回合跑完」会失败，
 * 但「提示被接纳」（accepted:true）就足以证明发送链路是通的。
 */
import WebSocket from 'ws';

import { EngineClient, type WebSocketCtor } from '../app/src/lib/client';
import { startRealBridge } from '../engine/src/real/server';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';

async function main(): Promise<void> {
  if (!token) {
    console.error('用法: node --import tsx scripts/test-real-send.ts <baseUrl> <token>');
    process.exit(1);
  }

  const bridge = await startRealBridge({ baseUrl, token, port: 0, pairCode: '' });
  const client = new EngineClient({
    url: `ws://127.0.0.1:${bridge.port}/ws`,
    webSocketImpl: WebSocket as unknown as WebSocketCtor,
    autoReconnect: false,
  });
  await client.connect();

  const { sessions } = await client.request('sessions.list', {});
  console.log('会话数:', sessions.length);
  let target = sessions[0];
  if (!target) {
    console.log('没有会话，创建一个…');
    const created = await client.request('sessions.create', { presetId: 'standard', title: '手机端测试' });
    target = created.session;
    console.log('已创建:', target.id);
  }
  console.log('目标会话:', target.id, '|', target.title);

  const res = await client.request('sessions.send', { sessionId: target.id, text: '你好，这是一条来自手机端的测试消息' });
  console.log('send ->', JSON.stringify(res));

  // 等一会儿，看事件流里有没有东西（没模型的话会是一个错误回合）
  await new Promise((r) => setTimeout(r, 6000));

  const { session } = await client.request('sessions.get', { sessionId: target.id });
  console.log('回合数:', session.turns.length);
  for (const t of session.turns.slice(-4)) {
    console.log(`  [${t.role}/${t.status}]`, t.blocks.map((b) => b.kind).join(','));
  }

  client.close();
  await bridge.close();
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
