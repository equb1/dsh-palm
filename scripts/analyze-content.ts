/** 只看 content 数组里的块类型分布（不打印正文） */
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const file = process.argv[2]!;
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const buf = readFileSync(file);

function frames(data: Buffer): Buffer[] {
  const offs: number[] = [];
  for (let i = 0; i + 4 <= data.length; i++) if (data.compare(MAGIC, 0, 4, i, i + 4) === 0) offs.push(i);
  const out: Buffer[] = [];
  for (let k = 0; k < offs.length; k++) {
    let end = k + 1 < offs.length ? offs[k + 1]! : data.length;
    for (let a = 0; a < 4; a++) {
      try { out.push(zstdDecompressSync(data.subarray(offs[k]!, end))); break; }
      catch { if (k + 2 >= offs.length) break; k += 1; end = k + 1 < offs.length ? offs[k + 1]! : data.length; }
    }
  }
  return out;
}

const contentTypes = new Map<string, number>();
const toolNames = new Map<string, number>();
const roles = new Map<string, number>();
let assistantSample: string | null = null;

for (const frame of frames(buf)) {
  for (const line of frame.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    const ev = rec.event ?? rec;
    const data = ev.data ?? {};

    if (ev.type === 'assistant/message' || ev.type === 'user/message' || ev.type === 'tool/result') {
      const msg = data.message ?? data;
      const role = msg?.role ?? data.role ?? '?';
      roles.set(`${ev.type}/${role}`, (roles.get(`${ev.type}/${role}`) ?? 0) + 1);
      const content = msg?.content ?? data.content;
      for (const block of Array.isArray(content) ? content : []) {
        const t = block?.type ?? 'no-type';
        contentTypes.set(`${ev.type}:${t}`, (contentTypes.get(`${ev.type}:${t}`) ?? 0) + 1);
      }
      if (ev.type === 'assistant/message' && !assistantSample) {
        assistantSample = JSON.stringify(
          (Array.isArray(content) ? content : []).map((b: any) => ({ type: b?.type, keys: Object.keys(b ?? {}) })),
        );
      }
    }
    if (ev.type === 'tool/call') {
      const n = data.name ?? '?';
      toolNames.set(n, (toolNames.get(n) ?? 0) + 1);
    }
  }
}

console.log('--- content 块类型 ---');
for (const [k, v] of [...contentTypes.entries()].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k);
console.log('\n--- 角色 ---');
for (const [k, v] of roles) console.log(String(v).padStart(5), k);
console.log('\n--- 工具名 top10 ---');
for (const [k, v] of [...toolNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(String(v).padStart(5), k);
console.log('\n--- assistant content 首条结构 ---');
console.log(assistantSample);
