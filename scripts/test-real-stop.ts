/**
 * 中断验证：发一个长回答，2 秒后 stop，看流是不是真的停了。
 *
 *   node --import tsx scripts/test-real-stop.ts <baseUrl> <token>
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

  await client.request('sessions.get', { sessionId: target.id });

  let deltas = 0;
  let finishedReason: string | null = null;
  client.onAny((e) => {
    if (e.event === 'block.delta') deltas++;
    if (e.event === 'run.finished') finishedReason = String((e.data as { reason: string }).reason);
  });

  await client.request('sessions.send', {
    sessionId: target.id,
    text: '请写一篇 800 字左右的散文，主题是秋天的杭州，要完整成文。',
  });
  console.log('已发送，等 2 秒后中断…');
  await new Promise((r) => setTimeout(r, 2000));

  const deltasBeforeStop = deltas;
  const res = await client.request('sessions.stop', { sessionId: target.id });
  console.log('stop ->', JSON.stringify(res), '| 中断时已收到', deltasBeforeStop, '个增量');

  await new Promise((r) => setTimeout(r, 6000));
  console.log('中断之后又收到', deltas - deltasBeforeStop, '个增量');
  console.log('run.finished reason =', finishedReason);

  const after = await client.request('sessions.get', { sessionId: target.id });
  const last = after.session.turns.filter((t) => t.role === 'assistant').slice(-1)[0];
  console.log('最后一轮 assistant:', last ? last.status + ' / ' + last.blocks.map((b) => b.kind).join(',') : '(无)');

  const ok = finishedReason !== null || deltas - deltasBeforeStop < 3;
  console.log(ok ? '\n✓ 中断生效' : '\n✗ 中断好像没生效，流还在继续');

  client.close();
  await bridge.close();
  process.exit(ok ? 0 : 1);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
