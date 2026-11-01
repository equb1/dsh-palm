/** 从会话日志里挖 approval/asked、approval/decided、user-questions 相关的样本 */
import { readSessionLog } from '../engine/src/real/logReader';

const file = process.argv[2];
if (!file) {
  console.error('用法: node --import tsx scripts/dump-approval-samples.ts <session.v4.jsonl.zstd>');
  process.exit(1);
}

const records = readSessionLog(file) as Array<{ event?: { type?: string; data?: unknown } }>;
const wanted = ['approval/asked', 'approval/decided', 'approval/policy', 'user-questions', 'question'];
const seen = new Map<string, number>();
const samples = new Map<string, string>();

for (const r of records) {
  const ev = r.event;
  if (!ev?.type) continue;
  if (!wanted.some((w) => String(ev.type).includes(w))) continue;
  seen.set(String(ev.type), (seen.get(String(ev.type)) ?? 0) + 1);
  if (!samples.has(String(ev.type))) samples.set(String(ev.type), JSON.stringify(ev.data ?? {}).slice(0, 900));
}

console.log('记录数:', records.length);
for (const [type, n] of seen) {
  console.log(`\n=== ${type} x${n}`);
  console.log(samples.get(type));
}
if (seen.size === 0) console.log('（这个日志里没有审批/提问事件）');
