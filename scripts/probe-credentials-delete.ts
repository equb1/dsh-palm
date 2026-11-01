/** 探是否存在"删除凭据"的方法 */
import { DshRealClient } from '../engine/src/real/dshClient';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8898';
const token = process.argv[3] ?? '';

const CANDIDATES: Array<{ m: string; a: unknown }> = [
  { m: 'credentials/clear', a: { ref: 'DEEPSEEK_API_KEY' } },
  { m: 'credentials/unset', a: { ref: 'DEEPSEEK_API_KEY' } },
  { m: 'credentials/remove', a: { ref: 'DEEPSEEK_API_KEY' } },
  { m: 'credentials/delete', a: { ref: 'DEEPSEEK_API_KEY' } },
  { m: 'credentials/set', a: { ref: 'DEEPSEEK_API_KEY', value: null } },
  { m: 'credentials/set', a: { ref: 'DEEPSEEK_API_KEY', value: ' ' } },
];

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();
  for (const c of CANDIDATES) {
    try {
      const v = await client.rpc(c.m, c.a);
      console.log(`✓ ${c.m} ${JSON.stringify(c.a)} -> ${JSON.stringify(v).slice(0, 160)}`);
    } catch (e) {
      console.log(`· ${c.m} ${JSON.stringify(c.a)} -> ${(e as Error).message.slice(0, 150)}`);
    }
  }
  const d = await client.rpc('credentials/describe', { refs: ['DEEPSEEK_API_KEY'] });
  console.log('当前状态:', JSON.stringify(d));
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
