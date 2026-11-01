/**
 * 验证附件上传：
 *   1) attachments.upload 拿到回执
 *   2) sessions.send 带 attachments，Agent 能读到文件内容
 *
 *   node --import tsx scripts/test-real-upload.ts <wsPort>
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

  const { session } = await client.request('sessions.create', { presetId: 'standard', title: '附件验证' });
  console.log('会话:', session.id);

  await client.request('sessions.get', { sessionId: session.id });

  const content = '这个文件里有一句暗号：蓝鲸在星期二下雨。\n';
  const data = Buffer.from(content, 'utf8').toString('base64');
  const uploaded = await client.request('attachments.upload', {
    sessionId: session.id,
    data,
    name: 'note.txt',
  });
  console.log('上传回执:', uploaded.receiptId, '| 名字:', uploaded.name ?? '(无)');

  let text = '';
  let finished = false;
  client.onAny((e) => {
    if (e.event === 'block.delta') text += (e.data as { text: string }).text;
    if (e.event === 'run.finished') finished = true;
  });

  await client.request('sessions.send', {
    sessionId: session.id,
    text: '我上传了一个文件，请告诉我里面的暗号是什么。只回答暗号本身。',
    attachments: [uploaded.receiptId],
  });
  console.log('已发送（带附件），等回复…');

  for (let i = 0; i < 60 && !finished; i++) await new Promise((r) => setTimeout(r, 500));

  console.log('回复片段:', text.slice(0, 160).replace(/\n/g, ' '));
  const ok = text.includes('蓝鲸') || text.includes('星期二');
  console.log(ok ? '\n✓ 附件内容确实传到了 Agent' : '\n✗ Agent 似乎没读到文件');

  client.close();
  process.exit(ok ? 0 : 1);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
