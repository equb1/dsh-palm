/** 直接对引擎调 fileUploads/upload + session/prompt（带 file 块），看引擎怎么回 */
import { randomUUID } from 'node:crypto';

const base = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';

async function main(): Promise<void> {
  const r = await fetch(base + '/?token=' + token, { redirect: 'manual' });
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

  const rpc = async (method: string, args: unknown): Promise<unknown> => {
    const res = await fetch(base + '/api/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: '1', method, payload: { args } }),
    });
    return await res.json();
  };

  const ws = (await rpc('workspace/initializeDefault', {})) as { result: { value: { workspace: { workspaceId: string } } } };
  const workspaceId = ws.result.value.workspace.workspaceId;
  const sessionId = 'session-' + randomUUID();
  await rpc('session/create', { request: { workspaceId, sessionId, agentPreset: 'standard' } });
  console.log('会话:', sessionId);

  const up = (await rpc('fileUploads/upload', {
    agentId: sessionId,
    request: { data: Buffer.from('暗号：蓝鲸在星期二下雨。', 'utf8').toString('base64'), name: 'note.txt' },
  })) as { result: { ok: boolean; value?: { receiptId: string; file?: unknown }; error?: unknown } };
  console.log('上传:', JSON.stringify(up.result).slice(0, 300));
  const receiptId = up.result.value?.receiptId;
  if (!receiptId) process.exit(1);

  const prompt = (await rpc('session/prompt', {
    request: {
      requestId: randomUUID(),
      sessionId,
      mode: 'queue',
      content: [
        { type: 'text', text: '读一下这个文件，告诉我暗号。只回答暗号本身。' },
        { type: 'file', receiptId },
      ],
    },
  })) as { result: { ok: boolean; error?: unknown } };
  console.log('prompt:', JSON.stringify(prompt.result).slice(0, 400));

  await new Promise((r) => setTimeout(r, 12_000));
  process.exit(0);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
