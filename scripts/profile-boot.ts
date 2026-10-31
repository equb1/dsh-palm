/**
 * 给 dsh 启动做 CPU 采样，找出时间到底花在哪些包上。
 *   node --import tsx scripts/profile-boot.ts <bin.js> <outDir>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BIN = process.argv[2];
const OUT = process.argv[3] ?? 'C:/tmp/dshtest/prof';
if (!BIN) {
  console.error('用法: node --import tsx scripts/profile-boot.ts <bin.js> [outDir]');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const started = Date.now();
const child = spawn(
  process.execPath,
  ['--cpu-prof', `--cpu-prof-dir=${OUT}`, BIN, '--profile', 'web', '--host', '127.0.0.1', '--port', '8899', '--no-open'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DSH_HOME: process.env.DSH_HOME ?? 'C:\\tmp\\dshtest\\home' } },
);

let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
});
child.stderr.on('data', (d) => {
  out += d.toString();
});

async function waitForUrl(): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (out.includes('http://127.0.0.1')) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function pickProfile(dir: string): string {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.cpuprofile'))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (files.length === 0) throw new Error('没有生成 .cpuprofile');
  return files[0]!;
}

function packageOf(url: string): string {
  if (!url) return '(native)';
  const m = url.replace(/\\/g, '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (m) return m[1]!;
  if (url.includes('node:')) return url.slice(0, 40);
  return url.replace(/\\/g, '/').split('/').slice(-2).join('/');
}

async function main(): Promise<void> {
  const ok = await waitForUrl();
  const elapsed = Date.now() - started;
  console.log(`启动 ${elapsed} ms  ${ok ? '(成功)' : '(超时)'}`);
  // SIGKILL 不会让 Node 落盘 profile，必须用 SIGINT 让它正常收尾
  await new Promise((r) => setTimeout(r, 800));
  child.kill('SIGINT');
  await new Promise((r) => setTimeout(r, 2500));

  const file = pickProfile(OUT);
  const prof = JSON.parse(readFileSync(file, 'utf8')) as {
    nodes: Array<{ id: number; callFrame: { url?: string; functionName?: string } }>;
    samples: number[];
    timeDeltas: number[];
  };

  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const selfTime = new Map<string, number>();

  for (let i = 0; i < prof.samples.length; i++) {
    const node = byId.get(prof.samples[i]!);
    if (!node) continue;
    const pkg = packageOf(node.callFrame.url ?? '');
    const dt = (prof.timeDeltas[i] ?? 0) / 1000; // ms
    selfTime.set(pkg, (selfTime.get(pkg) ?? 0) + dt);
  }

  const total = [...selfTime.values()].reduce((a, b) => a + b, 0);
  console.log(`\n采样总时长 ${Math.round(total)} ms，按包聚合（self time）：`);
  for (const [pkg, ms] of [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    const pct = ((ms / total) * 100).toFixed(1);
    console.log(`${String(Math.round(ms)).padStart(6)} ms  ${pct.padStart(5)}%  ${pkg}`);
  }
  console.log(`\nprofile: ${file}`);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
