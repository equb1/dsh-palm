/** 探 session/create 需要什么：先拿 workspaceId，再建会话 */
import { DshRealClient } from '../engine/src/real/dshClient';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();

  for (const method of ['workspace/initializeDefault', 'workspace/list', 'workspaces/list']) {
    try {
      const v = await client.rpc(method, {});
      console.log(`✓ ${method} -> ${JSON.stringify(v).slice(0, 400)}`);
    } catch (e) {
      console.log(`· ${method} -> ${(e as Error).message.slice(0, 160)}`);
    }
  }
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
