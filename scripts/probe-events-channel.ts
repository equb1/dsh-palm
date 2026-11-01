/**
 * 验证 $events 远程事件通道：
 *   开 $events 流 -> 收到 approval/request 或 user-questions/request 的 waterfall 帧
 *   -> 用 $events/result 当场作答 -> 看工具是不是立刻返回。
 *
 *   node --import tsx scripts/probe-events-channel.ts <baseUrl> <token>
 */
import WebSocket from 'ws';

import { DshRealClient } from '../engine/src/real/dshClient';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';

interface Frame {
  type?: string;
  clientId?: string;
  event?: string;
  eventId?: string;
  agentId?: string;
  request?: Record<string, any>;
}

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();
  const cookie = (client as unknown as { cookie: string }).cookie;

  // 1. 建会话
  const ws = await client.rpc<{ workspace: { workspaceId: string } }>('workspace/initializeDefault', {});
  const sessionId = 'session-' + crypto.randomUUID();
  await client.rpc('session/create', {
    request: { workspaceId: ws.workspace.workspaceId, sessionId, agentPreset: 'standard' },
  });
  console.log('会话:', sessionId);

  // 2. 开 $events 流
  const sock = new WebSocket(baseUrl.replace('http', 'ws') + '/api/remote.mux', { headers: { cookie } } as never);
  const streamId = crypto.randomUUID();
  let clientId = '';

  sock.on('open', () => {
    sock.send(JSON.stringify({ type: 'open', streamId, endpoint: '$events', payload: { args: {} } }));
  });

  sock.on('message', async (raw) => {
    const msg = JSON.parse(String(raw)) as { streamId?: string; value?: Frame };
    if (msg.streamId !== streamId || !msg.value) return;
    const f = msg.value;

    if (f.type === 'ready') {
      clientId = String(f.clientId);
      console.log('ready: clientId =', clientId, '| host =', (f as any).host);
      return;
    }

    if (f.type === 'waterfall') {
      console.log('\n>>> waterfall:', f.event, '| eventId =', f.eventId);
      console.log('    request =', JSON.stringify(f.request ?? {}).slice(0, 400));

      if (f.event === 'user-questions/request') {
        const q = f.request?.questions?.[0];
        const label = q?.options?.[0]?.label ?? '好';
        const custom = process.argv[4];
        const answer = custom
          ? { answers: [{ id: String(q?.id ?? ''), selected: [], custom }] }
          : { answers: [{ id: String(q?.id ?? ''), selected: [label] }] };
        await submit(f.eventId!, { kind: 'result', value: answer });
        console.log('    已当场作答:', JSON.stringify(answer));
      }

      if (f.event === 'approval/request') {
        await submit(f.eventId!, { kind: 'result', value: 'allowed-once' });
        console.log("    已当场批准: allowed-once");
      }
      return;
    }

    if (f.type === 'emit') {
      console.log('emit:', f.event);
    }
  });

  function submit(eventId: string, outcome: unknown): Promise<void> {
    const body = {
      type: 'client-request',
      rpcId: crypto.randomUUID(),
      method: '$events/result',
      payload: { args: { clientId, eventId, outcome } },
    };
    return fetch(baseUrl + '/api/$events/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    })
      .then(async (r) => {
        const text = await r.text();
        console.log('    result HTTP', r.status, text.slice(0, 200));
      })
      .catch((e) => console.error('    result 失败:', e.message));
  }

  await new Promise((r) => setTimeout(r, 700));

  // 3. 发一个会触发提问的prompt
  await client.rpc('session/prompt', {
    request: {
      requestId: crypto.randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: '用 ask_user_question 问我今天先做哪件事，三个选项：写代码、写文档、瘫着。' }],
    },
  });
  console.log('已发送，等 waterfall 帧…');

  await new Promise((r) => setTimeout(r, 40_000));

  // 4. 看会话里工具有没有返回
  const snap = await client.snapshot(sessionId, 4000);
  const recs = (snap?.records ?? []) as Array<{ event?: { type?: string; data?: Record<string, any> } }>;
  const result = recs.find((r) => r.event?.type === 'tool/result');
  console.log('\n记录数:', recs.length);
  console.log('tool/result:', result ? JSON.stringify(result.event?.data?.message?.content ?? '').slice(0, 200) : '(无)');

  sock.close();
  process.exit(0);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
