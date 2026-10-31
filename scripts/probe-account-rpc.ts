/**
 * 探真 dsh 的账号相关 RPC：哪些方法存在、登录流程长什么样。
 * 只读探测，不会发起登录。
 */
import { DshRealClient } from '../engine/src/real/dshClient';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8899';
const token = process.argv[3] ?? '';

const candidates: Array<{ method: string; args?: unknown }> = [
  { method: 'account/describe' },
  { method: 'account/status' },
  { method: 'account/login' },
  { method: 'account/startLogin' },
  { method: 'account/beginLogin' },
  { method: 'account/deviceCode' },
  { method: 'account/logout' },
  { method: 'account/balance' },
  { method: 'credentials/list' },
  { method: 'credentials/set' },
  { method: 'credentials/write', args: { ref: 'DEEPSEEK_API_KEY', value: 'x' } },
  { method: 'settings/get', args: { request: {} } },
  { method: 'modelCatalog/list' },
  { method: 'providers/list' },
  { method: 'session/send', args: { request: {} } },
  { method: 'session/control', args: { request: {} } },
];

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();

  for (const c of candidates) {
    try {
      const v = await client.rpc(c.method, c.args ?? {});
      console.log(`✓ ${c.method}  ->  ${JSON.stringify(v).slice(0, 220)}`);
    } catch (err) {
      const msg = (err as Error).message;
      console.log(`· ${c.method}  ->  ${msg.slice(0, 160)}`);
    }
  }
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
