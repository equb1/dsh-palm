/**
 * 验证：关掉 attachWait 流 -> 等待结算为 pending -> answer 是否变成 true。
 *   node --import tsx scripts/probe-question-flow.ts <baseUrl> <token> <sessionId>
 */
import WebSocket from 'ws';

import { DshRealClient } from '../engine/src/real/dshClient';
import { readSessionLog } from '../engine/src/real/logReader';
import { readdirSync } from 'node:fs';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';
const sessionId = process.argv[4] ?? '';

function findPending(sid: string): { callId: string; questionId: string; label: string; log: string } | null {
  const root = 'C:/tmp/dshtest/home/sessions';
  let file = '';
  for (const d of readdirSync(root)) {
    const sub = `${root}/${d}`;
    try {
      for (const s of readdirSync(sub)) if (s.includes(sid)) file = `${sub}/${s}/session.v4.jsonl.zstd`;
    } catch {
      /* ignore */
    }
  }
  if (!file) return null;
  const records = readSessionLog(file) as Array<{ event?: { type?: string; data?: Record<string, unknown> } }>;
  const done = new Set(records.filter((r) => r.event?.type === 'tool/result').map((r) => String(r.event?.data?.toolCallId)));
  for (const r of records) {
    if (r.event?.type !== 'tool/call' || String(r.event.data?.name) !== 'ask_user_question') continue;
    const callId = String(r.event.data?.callId);
    if (done.has(callId)) continue;
    const args = JSON.parse(String(r.event.data?.arguments ?? '{}')) as {
      questions?: Array<{ id: string; options?: Array<{ label: string }> }>;
    };
    const q = args.questions?.[0];
    return { callId, questionId: String(q?.id ?? ''), label: String(q?.options?.[0]?.label ?? '好'), log: file };
  }
  return null;
}

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();
  const pending = findPending(sessionId);
  if (!pending) {
    console.error('没有待回答的问题');
    process.exit(1);
  }
  console.log('待回答:', pending.callId);

  const cookie = (client as unknown as { cookie: string }).cookie;
  const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/api/remote.mux', { headers: { cookie } } as never);
  const streamId = crypto.randomUUID();
  ws.on('open', () => {
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
    const msg = JSON.parse(String(raw)) as { streamId?: string; type?: string; value?: unknown };
    if (msg.streamId === streamId) console.log('  attachWait 帧:', JSON.stringify(msg.value ?? msg).slice(0, 120));
  });

  await new Promise((r) => setTimeout(r, 1500));
  console.log('关掉 attachWait 流（模拟客户端倒计时结束）…');
  ws.close();

  // 等它结算成 pending
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const recs = readSessionLog(pending.log) as Array<{ event?: { type?: string; data?: Record<string, unknown> } }>;
    const hasResult = recs.some((r) => r.event?.type === 'tool/result' && String(r.event.data?.toolCallId) === pending.callId);
    if (hasResult) {
      console.log(`结算为 pending（第 ${i} 次检查）`);
      break;
    }
  }

  const delivered = await client.rpc('userQuestions/answer', {
    agentId: sessionId,
    callId: pending.callId,
    answer: { answers: [{ id: pending.questionId, selected: [pending.label] }] },
  });
  console.log('answer 返回:', delivered);
  await new Promise((r) => setTimeout(r, 3000));

  const recs = readSessionLog(pending.log) as Array<{ event?: { type?: string } }>;
  console.log('最终记录数:', recs.length, '| 最后几个事件:', recs.slice(-3).map((r) => r.event?.type).join(', '));
  process.exit(0);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
