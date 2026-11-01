/**
 * 试 userQuestions/answer 的参数形状。
 *   node --import tsx scripts/probe-question-answer.ts <baseUrl> <token> <sessionId>
 */
import { DshRealClient } from '../engine/src/real/dshClient';
import { readSessionLog } from '../engine/src/real/logReader';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';
const sessionId = process.argv[4] ?? '';

interface Rec {
  event?: { type?: string; data?: Record<string, unknown> };
}

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();

  // 从日志里找那条还没回答的 ask_user_question
  const dir = `C:/tmp/dshtest/home/sessions`;
  const { readdirSync, statSync } = await import('node:fs');
  let target = '';
  for (const d of readdirSync(dir)) {
    const sub = `${dir}/${d}`;
    for (const s of readdirSync(sub)) {
      if (s.includes(sessionId)) target = `${sub}/${s}/session.v4.jsonl.zstd`;
    }
  }
  if (!target) {
    console.error('找不到日志');
    process.exit(1);
  }
  const records = readSessionLog(target) as Rec[];
  const calls = records.filter((r) => r.event?.type === 'tool/call');
  const results = new Set(records.filter((r) => r.event?.type === 'tool/result').map((r) => String(r.event?.data?.toolCallId)));
  const asked = calls.find((c) => String(c.event?.data?.name) === 'ask_user_question' && !results.has(String(c.event?.data?.callId)));
  if (!asked) {
    console.error('这条会话没有待回答的问题');
    process.exit(1);
  }
  const callId = String(asked.event?.data?.callId);
  const args = JSON.parse(String(asked.event?.data?.arguments ?? '{}')) as { questions?: Array<{ id: string; options?: Array<{ label: string }> }> };
  const q = args.questions?.[0];
  const questionId = String(q?.id ?? '');
  const label = String(q?.options?.[0]?.label ?? '好');
  console.log('callId:', callId, '| questionId:', questionId, '| 选项:', label);

  const variants: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: 'agentId 字段', args: { agentId: sessionId, callId, answer: { answers: [{ id: questionId, selected: [label] }] } } },
    { name: 'agent 字段', args: { agent: sessionId, callId, answer: { answers: [{ id: questionId, selected: [label] }] } } },
  ];

  for (const v of variants) {
    try {
      const r = await client.rpc('userQuestions/answer', v.args);
      console.log(`✓ ${v.name} -> ${JSON.stringify(r)}`);
    } catch (e) {
      console.log(`· ${v.name} -> ${(e as Error).message.slice(0, 220)}`);
    }
    await new Promise((r) => setTimeout(r, 2500));
    const after = readSessionLog(target) as Rec[];
    console.log('   记录数:', after.length, after.length > records.length ? '（有新增，说明生效）' : '（没变）');
    if (after.length > records.length) break;
  }
  process.exit(0);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
