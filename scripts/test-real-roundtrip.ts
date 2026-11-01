/**
 * 完整回合：建会话 → 发一句 → 盯着 session/follow 流看增量 → 投影出结果。
 *
 *   node --import tsx scripts/test-real-roundtrip.ts <baseUrl> <token>
 */
import WebSocket from 'ws';

import { DshRealClient } from '../engine/src/real/dshClient';
import { projectRecords, type RealRecord } from '../engine/src/real/project';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';
const PROMPT = process.argv[4] ?? '你好，用一句话介绍你自己';

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();

  // 1. 建会话
  const ws = await client.rpc<{ workspace: { workspaceId: string } }>('workspace/initializeDefault', {});
  const sessionId = 'session-' + crypto.randomUUID();
  await client.rpc('session/create', {
    request: { workspaceId: ws.workspace.workspaceId, sessionId, agentPreset: 'standard' },
  });
  console.log('会话:', sessionId);

  // 2. 开 follow 流
  const cookie = (client as unknown as { cookie: string }).cookie;
  const sock = new WebSocket(baseUrl.replace('http', 'ws') + '/api/remote.mux', { headers: { cookie } } as never);
  const streamId = crypto.randomUUID();
  const kinds = new Map<string, number>();
  const chunkSamples: string[] = [];
  let snapshot: { records?: RealRecord[] } | null = null;

  sock.on('open', () => {
    sock.send(
      JSON.stringify({
        type: 'open',
        streamId,
        endpoint: 'session/follow',
        payload: {
          args: { request: { address: { kind: 'session', sessionId }, assistantStream: true, maxMessages: 500 } },
        },
      }),
    );
  });

  sock.on('message', (raw) => {
    const msg = JSON.parse(String(raw)) as { streamId?: string; value?: Record<string, any> };
    if (msg.streamId !== streamId || !msg.value) return;
    const v = msg.value;

    if (v.type === 'snapshot') {
      snapshot = v as { records?: RealRecord[] };
      console.log('snapshot: records =', v.records?.length ?? 0);
      return;
    }

    // 后续增量：记录类型 + assistantStream 的形状
    const key = String(v.type ?? 'item') + (v.event?.type ? ':' + v.event.type : '');
    kinds.set(key, (kinds.get(key) ?? 0) + 1);

    const chunkType = String((v as any).frame?.chunk?.type ?? '');
    if (v.type === 'assistant-stream' && chunkType.includes('delta') && chunkSamples.length < 6) {
      chunkSamples.push('delta: ' + JSON.stringify(v).slice(0, 300));
    }

    const as = v.assistantStream ?? v.value?.assistantStream;
    if (as && chunkSamples.length < 6) {
      chunkSamples.push(JSON.stringify(as).slice(0, 300));
    }
    if (v.event?.type === 'assistant/message' && chunkSamples.length < 6) {
      chunkSamples.push(`event assistant/message: ` + JSON.stringify(v.event.data ?? {}).slice(0, 300));
    }
  });

  await new Promise((r) => setTimeout(r, 800));

  // 3. 发消息
  const t0 = Date.now();
  await client.rpc('session/prompt', {
    request: { requestId: crypto.randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: PROMPT }] },
  });
  console.log('已发送，等回复…');

  // 4. 等 45 秒或直到投影出 assistant 文本
  const deadline = Date.now() + 45_000;
  let done = false;
  while (Date.now() < deadline && !done) {
    await new Promise((r) => setTimeout(r, 1500));
    const snap = await client.snapshot(sessionId, 3000);
    if (!snap) continue;
    const proj = projectRecords((snap.records ?? []) as RealRecord[]);
    const assistant = proj.turns.filter((t) => t.role === 'assistant' && t.blocks.length > 0);
    if (assistant.length > 0) {
      done = true;
      console.log(`\n收到回复（${Date.now() - t0} ms）：`);
      const last = assistant[assistant.length - 1]!;
      for (const b of last.blocks.slice(-6)) {
        if (b.kind === 'text') console.log('  [text]', b.text.slice(0, 200).replace(/\n/g, ' '));
        else if (b.kind === 'thinking') console.log('  [thinking]', b.text.slice(0, 120).replace(/\n/g, ' '));
        else if (b.kind === 'tool') console.log('  [tool]', b.name, b.state);
      }
    }
  }

  console.log('\n流里的增量类型:');
  for (const [k, n] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);

  if (chunkSamples.length > 0) {
    console.log('\n增量样本:');
    for (const s of chunkSamples) console.log('  ' + s);
  }

  if (!done) console.log('\n（没等到 assistant 文本，看看上面的事件类型）');

  sock.close();
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
