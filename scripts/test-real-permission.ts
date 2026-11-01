/**
 * 真引擎验证：权限预设的列出与切换。
 *   node --import tsx scripts/test-real-permission.ts <wsPort>
 */
import WebSocket from 'ws';

import { EngineClient, type WebSocketCtor } from '../app/src/lib/client';

const port = process.argv[2] ?? '8788';

async function main(): Promise<void> {
  const client = new EngineClient({
    url: `ws://127.0.0.1:${port}/ws`,
    webSocketImpl: WebSocket as unknown as WebSocketCtor,
    autoReconnect: false,
  });
  await client.connect();

  const { options, default: fallback } = await client.request('permissions.list', {});
  console.log('可选权限:', options.map((o) => o.value).join(' / '), '| 默认:', fallback);
  if (options.length === 0) {
    console.error('没有权限选项');
    process.exit(1);
  }

  const { session } = await client.request('sessions.create', { presetId: 'standard', title: '权限验证' });
  console.log('新会话 permission:', session.permission ?? '(未设置)');

  const target = 'danger-full-access';
  const changed = await client.request('sessions.setPermission', { sessionId: session.id, preset: target });
  console.log('切换后返回值:', changed.session.permission);

  const again = await client.request('sessions.get', { sessionId: session.id });
  console.log('重新读会话:', again.session.permission);

  const ok = again.session.permission === target;
  console.log(ok ? '\n✓ 权限切换真的持久化了' : '\n✗ 权限没变');
  client.close();
  process.exit(ok ? 0 : 1);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
