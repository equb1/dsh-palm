/**
 * ask_user_question 端到端：让 Agent 提问 -> 桥推送"请选择" -> 回答 -> Agent 继续。
 *
 *   node --import tsx scripts/test-real-question.ts <baseUrl> <token>
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

  const target = (await client.request('sessions.create', { presetId: 'standard' })).session;
  await client.request('sessions.get', { sessionId: target.id });
  console.log('会话:', target.id);

  let question: { id: string; questionId?: string; title: string; summary: string; options?: Array<{ label: string }> } | null =
    null;
  let resolved = false;
  let textAfterAnswer = '';

  client.onAny((e) => {
    if (e.event === 'approval.requested') {
      const a = (e.data as { approval: typeof question }).approval;
      if (a) {
        question = a;
        console.log('\n收到提问：');
        console.log('  标题:', a.title);
        console.log('  问题:', a.summary);
        console.log('  选项:', (a.options ?? []).map((o) => o.label).join(' / '));
        console.log('  questionId:', a.questionId, '| callId:', a.id);
      }
    }
    if (e.event === 'approval.resolved') resolved = true;
    if (e.event === 'block.delta' && question) {
      const d = e.data as { text: string };
      textAfterAnswer += d.text;
    }
  });

  await client.request('sessions.send', {
    sessionId: target.id,
    text: '用 ask_user_question 问我今天想先做哪件事，给三个选项：写代码、写文档、瘫着。',
  });
  console.log('已发送，等 Agent 提问…');

  for (let i = 0; i < 40 && !question; i++) await new Promise((r) => setTimeout(r, 500));
  if (!question) {
    console.error('✗ 没等到提问');
    client.close();
    await bridge.close();
    process.exit(1);
  }

  const options = (question as { options?: Array<{ label: string }> }).options ?? [];
  const pick = options[0]?.label ?? '写代码';
  console.log('\n回答：', pick);

  textAfterAnswer = '';
  await client.request('questions.answer', {
    sessionId: target.id,
    callId: (question as { id: string }).id,
    answers: [{ id: (question as { questionId?: string }).questionId ?? '', selected: [pick] }],
  });

  console.log('已回答，等 Agent 继续…');
  await new Promise((r) => setTimeout(r, 12_000));

  console.log('\napproval.resolved:', resolved);
  console.log('回答后收到的流式文本（前 160 字）:');
  console.log('  ' + textAfterAnswer.slice(0, 160).replace(/\n/g, ' '));

  const ok = resolved && textAfterAnswer.length > 0;
  console.log(ok ? '\n✓ 提问 -> 回答 -> 继续，全链路通了' : '\n✗ 有一环没通');

  client.close();
  await bridge.close();
  process.exit(ok ? 0 : 1);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
