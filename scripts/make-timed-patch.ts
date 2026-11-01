/**
 * 生成能真正生效的 profile patch：
 *   1) 三个 agent preset 里的 tool-ask-user 切成 timed（timeout 为正数）
 *   2) 在这些 preset 的 persona 里加一句约束，避免模型把 timeout 传成 -1
 *
 *   node --import tsx scripts/make-timed-patch.ts <dump.yml> <out.yml> [timeout秒]
 *
 * 为什么要整块抄 preset：tool-ask-user 嵌套在 preset-* 的 config.plugins 里，
 * 根级 patch 用 id 找不到它；而 patch 的语义是 "config 整块替换"，
 * 所以只能把整个 preset 的 config 抄下来、只改需要改的那几行。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2];
const output = process.argv[3];
const timeout = Number(process.argv[4] ?? '60');
if (!input || !output) {
  console.error('用法: node --import tsx scripts/make-timed-patch.ts <dump.yml> <out.yml> [timeout秒]');
  process.exit(1);
}

const text = readFileSync(input, 'utf8').replace(/^\uFEFF/, '');
const lines = text.split('\n');

const roots: number[] = [];
for (let i = 0; i < lines.length; i++) if (/^- id: /.test(lines[i]!)) roots.push(i);

const TARGETS = ['preset-standard', 'preset-ptc', 'preset-cordis'];
const PERSONA_PREFIX = /^(\s+)prefix: You are a coding agent powered by the \{\{model\}\} model\.\s*$/;

const out: string[] = ['# 自动生成：agent preset 里的 ask_user_question 切成 timed，并约束模型传正数 timeout'];

for (const target of TARGETS) {
  const start = roots.find((i) => new RegExp('^- id: ' + target + '\\s*$').test(lines[i]!));
  if (start === undefined) {
    console.warn('跳过 ' + target + '（找不到）');
    continue;
  }
  const nextRoot = roots.find((i) => i > start) ?? lines.length;
  const end = nextRoot;

  let configLine = -1;
  for (let i = start + 1; i < end; i++) {
    if (/^  config:\s*$/.test(lines[i]!)) {
      configLine = i;
      break;
    }
  }
  if (configLine < 0) {
    console.warn('跳过 ' + target + '（没有 config）');
    continue;
  }
  const askIdx = lines.slice(start, end).findIndex((l) => /- id: tool-ask-user\s*$/.test(l));
  if (askIdx < 0) {
    console.warn('跳过 ' + target + '（没有 tool-ask-user）');
    continue;
  }

  out.push('- id: ' + target);
  for (let i = configLine; i < end; i++) {
    const line = lines[i]!;
    const idxInBlock = i - start;

    const persona = line.match(PERSONA_PREFIX);
    if (persona) {
      const indent = persona[1]!;
      out.push(indent + 'prefix: >-');
      out.push(indent + '  You are a coding agent powered by the {{model}} model.');
      out.push(indent + '  调用 ask_user_question 工具时，timeout 参数必须传一个正整数，且不要超过 20（推荐 15），不要传 -1；');
      out.push(indent + '  -1 表示无限等待，会让手机端的用户无法作答。');
      continue;
    }

    out.push(line);
    if (idxInBlock === askIdx + 1 && /dsh-tool-ask-user/.test(line)) {
      const indent = line.match(/^(\s*)/)![1]!;
      out.push(indent + 'config:');
      out.push(indent + '  mode: timed');
      out.push(indent + '  timeout: ' + String(timeout));
    }
  }
}

writeFileSync(output, out.join('\n'), 'utf8');
console.log('生成 ' + String(out.length) + ' 行 -> ' + output);
