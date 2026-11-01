/** 检查某个会话的 request/header 里 ask_user_question 是不是 timed 版（带 timeout） */
import { readSessionLog } from '../engine/src/real/logReader';

const file = process.argv[2];
if (!file) {
  console.error('用法: node --import tsx scripts/check-ask-tool.ts <session.v4.jsonl.zstd>');
  process.exit(1);
}

const records = readSessionLog(file) as Array<{ event?: { type?: string; data?: Record<string, any> } }>;
const header = records.find((r) => r.event?.type === 'request/header')?.event?.data?.header as
  | { tools?: Array<{ name?: string; parameters?: { properties?: Record<string, unknown> } }> }
  | undefined;

const tools = header?.tools ?? [];
console.log('工具数:', tools.length);
const ask = tools.find((t) => t.name === 'ask_user_question');
if (!ask) {
  console.log('这次请求里没有 ask_user_question');
} else {
  const keys = Object.keys(ask.parameters?.properties ?? {});
  console.log('ask_user_question 参数:', keys.join(', '));
  console.log('是否 timed（有 timeout 参数）:', keys.includes('timeout') ? '是 ✓' : '否 ✗');
}
