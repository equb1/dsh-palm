/** 看一个会话里 user/message 的内容块类型（验证附件有没有进去） */
import { readdirSync } from 'node:fs';

import { readSessionLog } from '../engine/src/real/logReader';

const sessionId = process.argv[2] ?? '';
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
if (!file) {
  console.error('找不到会话');
  process.exit(1);
}

const recs = readSessionLog(file) as Array<{ event?: { type?: string; data?: Record<string, any> } }>;
for (const r of recs) {
  if (r.event?.type !== 'user/message') continue;
  const content = (r.event.data?.content ?? []) as Array<Record<string, unknown>>;
  const kinds = content.map((c) => String(c.type));
  const textSample = JSON.stringify(content).slice(0, 260);
  console.log('parts:', kinds.join(','), '|', textSample);
}
console.log('tool/call:', recs.filter((r) => r.event?.type === 'tool/call').length);
console.log('tool/result:', recs.filter((r) => r.event?.type === 'tool/result').length);
