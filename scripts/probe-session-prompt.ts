/** 探 session/prompt 的参数形状：故意少传，从错误里读字段名 */
import { DshRealClient } from '../engine/src/real/dshClient';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';

const CANDIDATES: unknown[] = [
  {},
  { request: {} },
  { request: { sessionId: 'x' } },
  { request: { sessionId: 'x', content: 'hi' } },
  { request: { sessionId: 'x', prompt: 'hi' } },
  { request: { address: { kind: 'session', sessionId: 'x' }, content: [{ type: 'text', text: 'hi' }] } },
];

function brief(err: unknown): string {
  const m = (err as Error).message ?? String(err);
  // 只保留 message 字段，别把整棵树打出来
  const j = m.match(/"message":"([^"]{0,300})"/);
  if (j) return j[1]!.replace(/\\"/g, '"');
  return m.slice(0, 300);
}

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();
  for (const args of CANDIDATES) {
    try {
      const v = await client.rpc('session/prompt', args);
      console.log('✓', JSON.stringify(args), '->', JSON.stringify(v).slice(0, 200));
    } catch (e) {
      console.log('·', JSON.stringify(args), '->', brief(e));
    }
  }
}

void main().catch((e) => {
  console.error('FAILED', brief(e));
  process.exit(1);
});
