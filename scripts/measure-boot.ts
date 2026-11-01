/**
 * 基线测量：在 Windows（无 proot）上启动同一个 dsh web，量到 token URL 的时间。
 * 用途：和手机上（proot）的 14 秒对比，算出 proot 的税有多重。
 */
import { spawn } from 'node:child_process';

const BIN = process.argv[2];
const PORT = process.argv[3] ?? '8899';
/** 端口之后的所有参数原样传给 dsh（例如 --patch xxx.yml） */
const EXTRA = process.argv.slice(4);

if (!BIN) {
  console.error('用法: node --import tsx scripts/measure-boot.ts <bin.js> [port]');
  process.exit(1);
}

const started = Date.now();
// EXTRA 非空时完全接管参数顺序（launcher 选项必须放在 profile 名之前）
const args = EXTRA.length > 0 ? [BIN, ...EXTRA] : [BIN, 'web', '--host', '127.0.0.1', '--port', PORT, '--no-open'];
const child = spawn(process.execPath, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DSH_HOME: process.env.DSH_HOME ?? 'C:\\tmp\\dshtest\\home' },
});

let out = '';
let done = false;

const finish = (ms: number, ok: boolean): void => {
  if (done) return;
  done = true;
  console.log(`启动耗时: ${ms} ms  ${ok ? '(成功)' : '(失败)'}`);
  if (out.trim()) console.log('--- 输出 ---\n' + out.trim().split('\n').slice(-12).join('\n'));
  child.kill();
  setTimeout(() => process.exit(0), 300);
};

child.stdout.on('data', (d) => {
  out += d.toString();
  if (out.includes('http://127.0.0.1')) finish(Date.now() - started, true);
});
child.stderr.on('data', (d) => {
  out += d.toString();
});
child.on('exit', (code) => finish(Date.now() - started, false));

setTimeout(() => finish(Date.now() - started, false), 90_000);
