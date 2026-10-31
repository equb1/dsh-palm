/** 挖 credentials/set 的参数结构（从错误信息里读 descriptor） */
import { DshRealClient } from '../engine/src/real/dshClient';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8899';
const token = process.argv[3] ?? '';

async function tryRpc(client: DshRealClient, label: string, method: string, args: unknown): Promise<void> {
  try {
    const v = await client.rpc(method, args);
    console.log(`✓ ${label} -> ${JSON.stringify(v).slice(0, 300)}`);
  } catch (err) {
    console.log(`· ${label} -> ${(err as Error).message.slice(0, 700)}`);
  }
}

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();

  await tryRpc(client, 'credentials/set {}', 'credentials/set', {});
  await tryRpc(client, 'credentials/set {ref}', 'credentials/set', { ref: 'DEEPSEEK_API_KEY' });
  await tryRpc(client, 'credentials/set {name}', 'credentials/set', { name: 'DEEPSEEK_API_KEY' });
  await tryRpc(client, 'credentials/set {ref,value}', 'credentials/set', {
    ref: 'DEEPSEEK_API_KEY',
    value: 'sk-test-not-real',
  });
  await tryRpc(client, 'credentials/set {request:{ref,value}}', 'credentials/set', {
    request: { ref: 'DEEPSEEK_API_KEY', value: 'sk-test-not-real' },
  });
  await tryRpc(client, 'credentials/describe', 'credentials/describe', { refs: ['DEEPSEEK_API_KEY'] });
  await tryRpc(client, 'credentials/delete?', 'credentials/delete', { ref: 'DEEPSEEK_API_KEY' });
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
