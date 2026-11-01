/**
 * 盯着一个会话的原始流，把每一帧都打出来（含事件类型和 data 片段）。
 * 用来抓 approval/asked、user-questions 这类只在运行时出现的形状。
 *
 *   node --import tsx scripts/watch-session-events.ts <baseUrl> <token> "<提示词>" [秒数]
 */
import WebSocket from 'ws';

import { DshRealClient } from '../engine/src/real/dshClient';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';
const PROMPT = process.argv[4] ?? '';
const SECONDS = Number(process.argv[5] ?? '25');

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();

  const ws = await client.rpc<{ workspace: { workspaceId: string } }>('workspace/initializeDefault', {});
  const sessionId = 'session-' + crypto.randomUUID();
  await client.rpc('session/create', {
    request: { workspaceId: ws.workspace.workspaceId, sessionId, agentPreset: 'standard' },
  });
  console.log('会话:', sessionId);

  const cookie = (client as unknown as { cookie: string }).cookie;
  const sock = new WebSocket(baseUrl.replace('http', 'ws') + '/api/remote.mux', { headers: { cookie } } as never);
  const streamId = crypto.randomUUID();
  sock.on('open', () => {
    sock.send(
      JSON.stringify({
        type: 'open',
        streamId,
        endpoint: 'session/follow',
        payload: {
          args: { request: { address: { kind: 'session', sessionId }, assistantStream: true, maxMessages: 200 } },
        },
      }),
    );
  });
  sock.on('message', (raw) => {
    const msg = JSON.parse(String(raw)) as { streamId?: string; value?: Record<string, any> };
    if (msg.streamId !== streamId || !msg.value) return;
    const v = msg.value;
    if (v.type === 'error') {
      console.log('STREAM ERROR :: ' + JSON.stringify(v).slice(0, 400));
      return;
    }
    if (v.type === 'event') {
      const t = String(v.event?.type ?? '?');
      // 跳过噪音
      if (t.includes('delta') || t.includes('delivery-accepted')) return;
      console.log(`event ${t} :: ${JSON.stringify(v.event?.data ?? {}).slice(0, 500)}`);
      return;
    }
    if (v.type === 'snapshot') {
      console.log('snapshot records=', v.records?.length ?? 0);
      return;
    }
    if (v.type !== 'assistant-stream') console.log('item', JSON.stringify(v).slice(0, 300));
  });

  await new Promise((r) => setTimeout(r, 600));
  if (PROMPT) {
    await client.rpc('session/prompt', {
      request: { requestId: crypto.randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: PROMPT }] },
    });
    console.log('已发送:', PROMPT);
  }
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  sock.close();
  process.exit(0);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
