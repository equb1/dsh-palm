/**
 * 验证模型切换：
 *   1) models.list 能列出模型
 *   2) sessions.setModel 切到另一个模型
 *   3) 发一条消息，会话日志里下一次请求用的确实是新模型
 *
 *   node --import tsx scripts/test-real-model.ts <wsPort> <baseUrl> <token>
 */
import { readdirSync } from 'node:fs';

import WebSocket from 'ws';

import { EngineClient, type WebSocketCtor } from '../app/src/lib/client';
import { readSessionLog } from '../engine/src/real/logReader';

const port = process.argv[2] ?? '8788';
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:8897';
const token = process.argv[4] ?? '';

function findLog(sessionId: string): string | null {
  const root = 'C:/tmp/dshtest/home/sessions';
  for (const d of readdirSync(root)) {
    const sub = `${root}/${d}`;
    try {
      for (const s of readdirSync(sub)) if (s.includes(sessionId)) return `${sub}/${s}/session.v4.jsonl.zstd`;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function main(): Promise<void> {
  const client = new EngineClient({
    url: `ws://127.0.0.1:${port}/ws`,
    webSocketImpl: WebSocket as unknown as WebSocketCtor,
    autoReconnect: false,
  });
  await client.connect();

  const { models, default: fallback } = await client.request('models.list', {});
  console.log('可用模型:');
  for (const m of models) console.log('  ' + m.provider + '/' + m.id + '  ' + m.name + (m.efforts ? `  efforts=${m.efforts.length}` : ''));
  console.log('默认:', JSON.stringify(fallback));

  const target = models.find((m) => m.id !== fallback?.model) ?? models[0];
  if (!target) {
    console.error('没有模型');
    process.exit(1);
  }

  const { session } = await client.request('sessions.create', { presetId: 'standard', title: '模型切换验证' });
  console.log('\n会话:', session.id);

  const updated = await client.request('sessions.setModel', {
    sessionId: session.id,
    provider: target.provider,
    model: target.id,
    reasoningEffort: target.defaultEffort,
  });
  console.log('切换后 detail.model:', JSON.stringify(updated.session.model));

  await client.request('sessions.send', { sessionId: session.id, text: '只回答两个字：收到' });
  await new Promise((r) => setTimeout(r, 12_000));

  const log = findLog(session.id);
  if (!log) {
    console.error('找不到会话日志');
    process.exit(1);
  }
  const records = readSessionLog(log) as Array<{ event?: { type?: string; data?: Record<string, any> } }>;
  const headers = records.filter((r) => r.event?.type === 'request/header');
  const last = headers[headers.length - 1];
  const config = last?.event?.data?.header?.config as { provider?: string; model?: string } | undefined;
  console.log('日志里最后一次请求用的模型:', JSON.stringify(config));

  const ok = config?.model === target.id;
  console.log(ok ? '\n✓ 模型切换真的生效了' : '\n✗ 模型没变');

  client.close();
  process.exit(ok ? 0 : 1);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
