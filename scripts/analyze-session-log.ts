/**
 * 只读分析真 dsh 的会话日志（session.v4.jsonl.zstd）。
 *
 * 这个文件是**多个 zstd 帧拼起来的**（每次追加一帧），Node 的
 * zstdDecompressSync 只解第一帧，所以这里按 magic 切帧后再逐帧解。
 *
 * 隐私：只输出结构（键名 / 类型 / 字符串长度），不打印正文。
 */
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const file = process.argv[2];
if (!file) {
  console.error('用法: node --import tsx scripts/analyze-session-log.ts <session.v4.jsonl.zstd>');
  process.exit(1);
}

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const buf = readFileSync(file);

function splitFrames(data: Buffer): Buffer[] {
  const offsets: number[] = [];
  for (let i = 0; i + 4 <= data.length; i++) {
    if (data.compare(MAGIC, 0, 4, i, i + 4) === 0) offsets.push(i);
  }
  const frames: Buffer[] = [];
  for (let k = 0; k < offsets.length; k++) {
    let end = k + 1 < offsets.length ? offsets[k + 1]! : data.length;
    // magic 可能出现在压缩数据内部，解不开就把下一帧并进来重试
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        frames.push(zstdDecompressSync(data.subarray(offsets[k]!, end)));
        break;
      } catch {
        if (k + 2 >= offsets.length) break;
        k += 1;
        end = k + 1 < offsets.length ? offsets[k + 1]! : data.length;
      }
    }
  }
  return frames;
}

function shapeOf(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return [`array<${value.length}>`, value.length > 0 ? shapeOf(value[0], depth + 1) : null];
  }
  switch (typeof value) {
    case 'string':
      return value.length <= 18 ? value : `string(${value.length})`;
    case 'number':
    case 'boolean':
      return typeof value;
    case 'object':
      if (depth > 3) return '{…}';
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, shapeOf(v, depth + 1)]),
      );
    default:
      return typeof value;
  }
}

const frames = splitFrames(buf);
console.log('帧数:', frames.length, '| 文件', (buf.length / 1024 / 1024).toFixed(1), 'MB');

const counts = new Map<string, number>();
const samples = new Map<string, string>();

for (const frame of frames) {
  for (const line of frame.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const type: string = rec?.event?.type ?? rec?.type ?? 'unknown';
    counts.set(type, (counts.get(type) ?? 0) + 1);
    if (!samples.has(type)) {
      samples.set(type, JSON.stringify(shapeOf(rec.event ?? rec)).slice(0, 900));
    }
  }
}

console.log('\n--- 事件类型分布 ---');
for (const [t, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(6)}  ${t}`);
}

console.log('\n--- 每种类型的形状（首条，已脱敏）---');
for (const [t, s] of samples) {
  console.log(`\n[${t}]\n  ${s}`);
}
