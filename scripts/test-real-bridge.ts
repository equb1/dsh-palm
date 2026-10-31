/**
 * 真引擎桥的端到端验证 + 配对鉴权验证。
 *
 *   node --import tsx scripts/test-real-bridge.ts <baseUrl> <token>
 */
import WebSocket from 'ws';

import { EngineClient, type WebSocketCtor } from '../app/src/lib/client';
import { startRealBridge } from '../engine/src/real/server';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8899';
const token = process.argv[3] ?? '';
const PAIR = '246810';

function newClient(url: string): EngineClient {
  return new EngineClient({
    url,
    webSocketImpl: WebSocket as unknown as WebSocketCtor,
    autoReconnect: false,
  });
}

async function main(): Promise<void> {
  if (!token) {
    console.error('用法: node --import tsx scripts/test-real-bridge.ts <baseUrl> <token>');
    process.exit(1);
  }

  const bridge = await startRealBridge({ baseUrl, token, port: 0, pairCode: PAIR });
  const wsBase = `ws://127.0.0.1:${bridge.port}/ws`;
  console.log('bridge port:', bridge.port, '| 配对码:', PAIR);

  // 1) 不带配对码 → 必须被拒
  const denied = newClient(wsBase);
  let deniedMessage = '';
  try {
    await denied.connect();
    console.error('✗ 没带配对码居然连上了');
    process.exitCode = 1;
  } catch (err) {
    deniedMessage = (err as Error).message;
    console.log('不带配对码被拒:', deniedMessage);
  }
  denied.close();

  // 2) 带错误配对码 → 必须被拒
  const wrong = newClient(wsBase + '?pair=000000');
  try {
    await wrong.connect();
    console.error('✗ 错误配对码居然连上了');
    process.exitCode = 1;
  } catch (err) {
    console.log('错误配对码被拒:', (err as Error).message);
  }
  wrong.close();

  // 3) 带正确配对码 → 通过，并能读到真会话
  const ok = newClient(wsBase + '?pair=' + PAIR);
  const caps = await ok.connect();
  console.log('配对成功 | 宿主:', caps.host.name, '| 预设:', caps.presets.map((p) => p.id).join(','));

  const { sessions } = await ok.request('sessions.list', {});
  console.log('真实会话数:', sessions.length);

  if (sessions[0]) {
    const { session } = await ok.request('sessions.get', { sessionId: sessions[0].id });
    console.log(
      '详情:', session.title,
      '| 回合:', session.turns.length,
      '| 工具卡:', session.turns.flatMap((t) => t.blocks).filter((b) => b.kind === 'tool').length,
    );
  }

  ok.close();
  await bridge.close();
  console.log('done');
}

void main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
