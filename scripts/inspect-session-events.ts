/** 打印某个会话最近的事件（类型 + seq + 时间 + 文本长度） */
import WebSocket from 'ws';

import { DshRealClient } from '../engine/src/real/dshClient';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();
  const { items } = await client.listSessions();
  const sid = items[0]?.sessionId;
  if (!sid) {
    console.log('没有会话');
    return;
  }

  const cookie = (client as unknown as { cookie: string }).cookie;
  const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/api/remote.mux', { headers: { cookie } } as never);
  const streamId = crypto.randomUUID();

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve();
    }, 3000);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'open',
          streamId,
          endpoint: 'session/follow',
          payload: { args: { request: { address: { kind: 'session', sessionId: sid }, assistantStream: true, maxMessages: 200 } } },
        }),
      );
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { streamId?: string; value?: { type?: string; records?: any[] } };
      if (msg.streamId !== streamId || msg.value?.type !== 'snapshot') return;
      clearTimeout(timer);
      const records = msg.value.records ?? [];
      console.log('会话:', sid, '| 记录数:', records.length);
      const byType = new Map<string, number>();
      for (const r of records) {
        const t = String(r?.event?.type ?? '?');
        byType.set(t, (byType.get(t) ?? 0) + 1);
      }
      console.log('事件类型:', [...byType.entries()].map(([k, v]) => k + 'x' + v).join(' '));
      for (const rec of records.slice(-10)) {
        const ev = rec.event ?? {};
        const d = ev.data ?? {};
        const text = d.content?.[0]?.text ?? d.message?.content?.[0]?.text ?? '';
        const src = JSON.stringify(d.source ?? d.message?.source ?? {});
        console.log(
          `  #${ev.seq} ${ev.type} @${new Date(ev.time ?? 0).toISOString().slice(11, 19)}` +
            (text ? ` text(${String(text).length}): ${String(text).slice(0, 30)}` : '') +
            ` src=${src.slice(0, 90)}`,
        );
      }
      ws.close();
      resolve();
    });
  });
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
