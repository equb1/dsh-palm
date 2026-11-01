/**
 * 单独验证 attachWait 流：开流 -> 打印收到的帧 -> 再回答 -> 看返回值。
 *   node --import tsx scripts/probe-attach-wait.ts <baseUrl> <token> <sessionId>
 */
import WebSocket from 'ws';

import { DshRealClient } from '../engine/src/real/dshClient';
import { readSessionLog } from '../engine/src/real/logReader';
import { readdirSync } from 'node:fs';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';
const sessionId = process.argv[4] ?? '';

async function findPending(sessionId: string): Promise<{ callId: string; questionId: string; label: string } | null> {
  const root = 'C:/tmp/dshtest/home/sessions';
  let file = '';
  for (const d of readdirSync(root)) {
    const sub = `${root}/${d}`;
    try {
      for (const s of readdirSync(sub)) if (s.includes(sessionId)) file = `${sub}/${s}/session.v4.jsonl.zstd`;
    } catch {
      /* ignore */
    }
  }
  if (!file) return null;
  const records = readSessionLog(file) as Array<{ event?: { type?: string; data?: Record<string, unknown> } }>;
  const done = new Set(records.filter((r) => r.event?.type === 'tool/result').map((r) => String(r.event?.data?.toolCallId)));
  for (const r of records) {
    if (r.event?.type !== 'tool/call') continue;
    if (String(r.event.data?.name) !== 'ask_user_question') continue;
    const callId = String(r.event.data?.callId);
    if (done.has(callId)) continue;
    const args = JSON.parse(String(r.event.data?.arguments ?? '{}')) as {
      questions?: Array<{ id: string; options?: Array<{ label: string }> }>;
    };
    const q = args.questions?.[0];
    return { callId, questionId: String(q?.id ?? ''), label: String(q?.options?.[0]?.label ?? '好') };
  }
  return null;
}

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();
  const pending = await findPending(sessionId);
  if (!pending) {
    console.error('没有待回答的问题');
    process.exit(1);
  }
  console.log('待回答:', JSON.stringify(pending));

  const cookie = (client as unknown as { cookie: string }).cookie;
  const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/api/remote.mux', { headers: { cookie } } as never);
  const streamId = crypto.randomUUID();

  ws.on('open', () => {
    console.log('mux 已连，开 attachWait 流…');
    ws.send(
      JSON.stringify({
        type: 'open',
        streamId,
        endpoint: 'userQuestions/attachWait',
        payload: { args: { agentId: sessionId, callId: pending.callId } },
      }),
    );
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw)) as { streamId?: string; type?: string; value?: unknown; error?: unknown };
    if (msg.streamId !== streamId) return;
    console.log('  帧:', JSON.stringify(msg).slice(0, 300));
  });
  ws.on('error', (e) => console.error('ws 错误:', (e as Error).message));

  await new Promise((r) => setTimeout(r, 2000));

  const delivered = await client.rpc('userQuestions/answer', {
    agentId: sessionId,
    callId: pending.callId,
    answer: { answers: [{ id: pending.questionId, selected: [pending.label] }] },
  });
  console.log('answer 返回:', delivered);

  await new Promise((r) => setTimeout(r, 3000));
  ws.close();
  process.exit(0);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
