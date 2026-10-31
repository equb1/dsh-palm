/** 手动排查用：连上 mock 引擎，把事件流全打出来 */
import WebSocket from 'ws';

import { EngineClient, type WebSocketCtor } from '../app/src/lib/client';
import { startEngine } from '../engine/src/server';

process.env.DSH_MOCK_SPEED = '0.2';

async function main(): Promise<void> {
  const engine = await startEngine(0);
  const client = new EngineClient({
    url: `ws://127.0.0.1:${engine.port}/ws`,
    webSocketImpl: WebSocket as unknown as WebSocketCtor,
    autoReconnect: false,
  });

  client.onStateChange((s) => console.log('[state]', s));
  await client.connect();

  client.onAny((e) => {
    console.log(`[${e.seq}] ${e.event} ${JSON.stringify(e.data).slice(0, 90)}`);
  });

  client.on('approval.requested', (d) => {
    console.log('>>> 收到审批，自动批准', d.approval.id);
    void client
      .request('approvals.resolve', { approvalId: d.approval.id, decision: 'approve' })
      .then(() => console.log('>>> 已批准'))
      .catch((err) => console.log('>>> 批准失败', err));
  });

  const { session } = await client.request('sessions.create', { presetId: 'doc' });
  console.log('session', session.id);

  const { runId } = await client.request('sessions.send', { sessionId: session.id, text: '帮我改合同' });
  console.log('runId', runId);

  setTimeout(() => {
    void (async () => {
      const { session: detail } = await client.request('sessions.get', { sessionId: session.id });
      console.log('--- turns ---');
      for (const t of detail.turns) {
        console.log(t.role, t.status, t.blocks.map((b) => b.kind).join(','));
      }
      client.close();
      await engine.close();
      process.exit(0);
    })();
  }, 6000);
}

void main();
