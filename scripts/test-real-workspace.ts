/**
 * 验证工作区：
 *   1) workspaces.list 能列出工作区
 *   2) workspaces.create 能注册一个新目录
 *   3) sessions.create 指定 workspaceId 生效（会话出现在那个工作区里）
 *
 *   node --import tsx scripts/test-real-workspace.ts <wsPort> <baseUrl> <token>
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

  const { workspaces } = await client.request('workspaces.list', {});
  console.log('已有工作区:');
  for (const w of workspaces) console.log('  ' + w.id.slice(0, 8) + '…  ' + w.root);
  if (workspaces.length === 0) {
    console.error('一个工作区都没有');
    process.exit(1);
  }

  const current = workspaces[0]!;
  const { session } = await client.request('sessions.create', {
    presetId: 'standard',
    workspaceId: current.id,
    title: '工作区验证',
  });
  console.log('\n在默认工作区建会话:', session.id, '| workspaceId:', session.workspaceId);

  // 再注册一个同目录（引擎会返回 created:false，说明已存在）
  const again = await client.request('workspaces.create', { path: current.root });
  console.log('重复注册同一个目录 ->', again.workspace.id.slice(0, 8) + '…', '| 名字:', again.workspace.name);

  const ok = session.workspaceId.length > 0 && again.workspace.root === current.root;
  console.log(ok ? '\n✓ 工作区列表/创建/指定建会话都通' : '\n✗ 有问题');
  client.close();
  process.exit(ok ? 0 : 1);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
