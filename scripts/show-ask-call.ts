/** 打印会话里 ask_user_question 的工具调用参数（重点看 timeout） */
import { readSessionLog } from '../engine/src/real/logReader';

const file = process.argv[2];
if (!file) {
  console.error('用法: node --import tsx scripts/show-ask-call.ts <session.v4.jsonl.zstd>');
  process.exit(1);
}

const records = readSessionLog(file) as Array<{ event?: { type?: string; data?: Record<string, any> } }>;
console.log('记录数:', records.length);
for (const r of records) {
  const ev = r.event;
  if (ev?.type === 'tool/call' && ev.data?.name === 'ask_user_question') {
    console.log('callId:', ev.data.callId);
    console.log('arguments:', String(ev.data.arguments).slice(0, 500));
  }
  if (ev?.type === 'tool/result' && String(ev.data?.toolCallId ?? '').startsWith('call_')) {
    const text = JSON.stringify(ev.data?.message?.content ?? '').slice(0, 200);
    console.log('tool/result:', String(ev.data?.toolCallId).slice(0, 30), '| isError:', ev.data?.message?.isError, '|', text);
  }
}
console.log('最后 6 个事件:', records.slice(-6).map((r) => r.event?.type).join(', '));
