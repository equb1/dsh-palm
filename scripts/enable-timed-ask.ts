/**
 * 把 dsh 的 profile 配置里所有 tool-ask-user 改成 timed 模式。
 *
 *   node --import tsx scripts/enable-timed-ask.ts <dump.yml> <out.yml> [timeout秒]
 *
 * tool-ask-user 在 profile 里是嵌套在 agent preset 层里的，根级 --patch 够不到，
 * 所以直接改 profile 文件（dsh 启动时会读 $DSH_HOME/profiles/<name>/cordis.yml）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2];
const output = process.argv[3];
const timeout = Number(process.argv[4] ?? '120');
if (!input || !output) {
  console.error('用法: node --import tsx scripts/enable-timed-ask.ts <dump.yml> <out.yml> [timeout秒]');
  process.exit(1);
}

const text = readFileSync(input, 'utf8');
const lines = text.split('\n');
const out: string[] = [];

let changed = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]!;
  out.push(line);

  const m = line.match(/^(\s*)- id: tool-ask-user\s*$/);
  if (!m) continue;

  // 下一行应当是 name；紧接着插入 config
  const indent = m[1]!;
  const next = lines[i + 1] ?? '';
  if (!next.includes('dsh-tool-ask-user')) continue;
  out.push(next);
  i += 1;

  out.push(`${indent}  config:`);
  out.push(`${indent}    mode: timed`);
  out.push(`${indent}    timeout: ${timeout}`);
  changed += 1;
}

writeFileSync(output, out.join('\n'), 'utf8');
console.log(`处理完成：${changed} 处 tool-ask-user 改成 timed`);
if (changed === 0) process.exit(1);
