/** 打印会话日志里所有 turn/end / step/end 的 data，用来确认 reason.kind 的取值 */
import { readSessionLog } from '../engine/src/real/logReader';

const file = process.argv[2];
if (!file) {
  console.error('用法: node --import tsx scripts/dump-turn-end.ts <session.v4.jsonl.zstd>');
  process.exit(1);
}

const records = readSessionLog(file) as Array<{ event?: { type?: string; data?: unknown } }>;
const seen = new Map<string, string>();
for (const r of records) {
  const ev = r.event;
  if (ev?.type !== 'turn/end' && ev?.type !== 'step/end') continue;
  const json = JSON.stringify(ev.data ?? {});
  const key = String(ev.type) + ' ' + json.slice(0, 160);
  if (!seen.has(key)) seen.set(key, '');
}
console.log('记录数:', records.length);
console.log('不同的收尾形状:');
for (const k of seen.keys()) console.log('  ' + k);
