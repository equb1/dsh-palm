/**
 * 验证审批通道：让 Agent 往工作区外写文件 -> 触发 approval/request waterfall
 * -> 用 $events/result 回答 -> 看工具拿到什么结果。
 *
 *   node --import tsx scripts/probe-approval.ts <baseUrl> <token>
 */
import WebSocket from 'ws';

import { DshRealClient } from '../engine/src/real/dshClient';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';
const DECISION = (process.argv[4] ?? 'rejected') as 'allowed-once' | 'rejected';

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();
  const cookie = (client as unknown as { cookie: string }).cookie;

  const ws = await client.rpc<{ workspace: { workspaceId: string } }>('workspace/initializeDefault', {});
  const sessionId = 'session-' + crypto.randomUUID();
  await client.rpc('session/create', {
    request: { workspaceId: ws.workspace.workspaceId, sessionId, agentPreset: 'standard' },
  });
  console.log('会话:', sessionId);

  const sock = new WebSocket(baseUrl.replace('http', 'ws') + '/api/remote.mux', { headers: { cookie } } as never);
  const streamId = crypto.randomUUID();
  let clientId = '';
  let sawApproval = false;

  function submit(eventId: string, value: unknown): void {
    void fetch(baseUrl + '/api/$events/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: crypto.randomUUID(),
        method: '$events/result',
        payload: { args: { clientId, eventId, outcome: { kind: 'result', value } } },
      }),
    }).then((r) => console.log('    作答 HTTP', r.status));
  }

  sock.on('open', () => {
    sock.send(JSON.stringify({ type: 'open', streamId, endpoint: '$events', payload: { args: {} } }));
  });
  sock.on('message', (raw) => {
    const msg = JSON.parse(String(raw)) as { streamId?: string; value?: Record<string, any> };
    if (msg.streamId !== streamId || !msg.value) return;
    const f = msg.value;
    if (f.type === 'ready') {
      clientId = String(f.clientId);
      console.log('ready, clientId =', clientId);
      return;
    }
    if (f.type === 'waterfall' && f.event === 'approval/request') {
      sawApproval = true;
      console.log('\n>>> approval/request');
      console.log('    eventId:', f.eventId, '| agentId:', String(f.agentId).slice(0, 20));
      console.log('    request:', JSON.stringify(f.request ?? {}).slice(0, 500));
      submit(String(f.eventId), DECISION);
      console.log('    已作答:', DECISION);
    }
    if (f.type === 'waterfall' && f.event === 'user-questions/request') {
      const q = f.request?.questions?.[0];
      submit(String(f.eventId), { answers: [{ id: String(q?.id ?? ''), selected: [String(q?.options?.[0]?.label ?? '好')] }] });
    }
  });

  await new Promise((r) => setTimeout(r, 800));

  await client.rpc('session/prompt', {
    request: {
      requestId: crypto.randomUUID(),
      sessionId,
      mode: 'queue',
      content: [
        {
          type: 'text',
          text: '请把 hello 写进 C:\\Windows\\Temp\\dsh-palm-outside.txt（这个路径在工作区之外），用 pwsh 执行。',
        },
      ],
    },
  });
  console.log('已发送，等审审批…');

  await new Promise((r) => setTimeout(r, 45_000));

  const snap = await client.snapshot(sessionId, 4000);
  const recs = (snap?.records ?? []) as Array<{ event?: { type?: string; data?: Record<string, any> } }>;
  const asked = recs.filter((r) => r.event?.type === 'approval/asked').length;
  const decided = recs.filter((r) => r.event?.type === 'approval/decided');
  console.log('\n记录数:', recs.length, '| approval/asked:', asked, '| approval/decided:', decided.length);
  if (decided.length > 0) console.log('decided outcome:', JSON.stringify(decided[0]!.event?.data));
  const tr = recs.find((r) => r.event?.type === 'tool/result');
  console.log('tool/result:', tr ? JSON.stringify(tr.event?.data?.message?.content ?? '').slice(0, 300) : '(无)');
  console.log('收到 approval/request:', sawApproval);

  sock.close();
  process.exit(0);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
