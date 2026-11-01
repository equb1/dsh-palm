/**
 * 只看不改：连上手机上的真 dsh，跟一个会话的流 + 开 $events，
 * 把当前卡住的那一轮到底停在哪儿打出来。
 */
import { DshRealClient } from '../engine/src/real/dshClient';

const base = process.argv[2] ?? 'http://127.0.0.1:18787';
const token = process.argv[3];
const sessionId = process.argv[4];

if (!token || !sessionId) {
  console.error('用法: node --import tsx scratch/probe-stuck.ts <baseUrl> <token> <sessionId>');
  process.exit(1);
}

async function main(): Promise<void> {
  const client = new DshRealClient(base, token);
  await client.login();
  console.log('logged in');

  const stopFollow = client.openStream(
    'session/follow',
    { request: { address: { kind: 'session', sessionId }, assistantStream: true, maxMessages: 200 } },
    (value) => {
      const v = value as Record<string, unknown>;
      if (Array.isArray(v.records)) {
        for (const r of v.records) console.log('REC', JSON.stringify(r).slice(0, 700));
      } else {
        console.log('ITEM', JSON.stringify(v).slice(0, 700));
      }
    },
  );

  const stopEvents = client.openEvents((frame) => {
    console.log('EVENT', JSON.stringify(frame).slice(0, 700));
  });

  setTimeout(() => {
    stopFollow();
    stopEvents();
    process.exit(0);
  }, 20000);
}

void main().catch((error) => {
  console.error('FAILED', error);
  process.exit(1);
});
