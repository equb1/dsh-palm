/**
 * 真引擎上的凭据读写验证（不碰真实 home，用一次性 DSH_HOME）。
 *
 *   node --import tsx scripts/test-real-credentials.ts <baseUrl> <token>
 */
import WebSocket from 'ws';

import { EngineClient, type WebSocketCtor } from '../app/src/lib/client';
import { startRealBridge } from '../engine/src/real/server';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8899';
const token = process.argv[3] ?? '';
const PAIR = '135790';
const REF = 'DEEPSEEK_API_KEY';

async function main(): Promise<void> {
  if (!token) {
    console.error('用法: node --import tsx scripts/test-real-credentials.ts <baseUrl> <token>');
    process.exit(1);
  }

  const bridge = await startRealBridge({ baseUrl, token, port: 0, pairCode: PAIR });
  const client = new EngineClient({
    url: `ws://127.0.0.1:${bridge.port}/ws?pair=${PAIR}`,
    webSocketImpl: WebSocket as unknown as WebSocketCtor,
    autoReconnect: false,
  });

  await client.connect();
  console.log('已连上桥');

  const before = await client.request('credentials.describe', { refs: [REF] });
  console.log('写入前:', JSON.stringify(before.credentials));

  const setRes = await client.request('credentials.set', { ref: REF, value: 'sk-test-verify-0000' });
  console.log('写入结果:', JSON.stringify(setRes));

  const after = await client.request('credentials.describe', { refs: [REF] });
  console.log('写入后:', JSON.stringify(after.credentials));

  const cleared = await client.request('credentials.set', { ref: REF, value: '' });
  console.log('清除结果:', JSON.stringify(cleared), '（mock/真引擎都接受空值表示删除）');

  const final = await client.request('credentials.describe', { refs: [REF] });
  console.log('清除后:', JSON.stringify(final.credentials));

  if (after.credentials[REF]?.configured !== true) {
    console.error('✗ 写入后没有变成 configured');
    process.exitCode = 1;
  } else {
    console.log('\n✓ 真引擎的凭据读写链路通了');
  }

  client.close();
  await bridge.close();
}

void main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
