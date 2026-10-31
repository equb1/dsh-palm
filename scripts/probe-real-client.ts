/**
 * 真 dsh 引擎的最小客户端验证：
 *   1. 用 URL 里的 token 换 cookie
 *   2. POST /api/<ns>/<method> 调 RPC
 *   3. WS /api/remote.mux 开流，拿 session/follow 的快照
 *
 * 目的是摸清真实数据形状，供 docs/10-dsh-api.md 和后续适配器使用。
 */
import WebSocket from 'ws';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8899';

interface RpcEnvelope {
  type: 'server-response';
  rpcId: string;
  result: { ok: true; value: unknown } | { ok: false; error?: unknown };
}

let cookie = '';

function uuid(): string {
  return crypto.randomUUID();
}

async function login(tokenUrl: string): Promise<void> {
  const res = await fetch(tokenUrl, { redirect: 'manual' });
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length === 0) {
    const single = res.headers.get('set-cookie');
    if (single) raw.push(single);
  }
  cookie = raw.map((c) => c.split(';')[0]).join('; ');
  console.log('login:', res.status, 'cookie parts =', raw.length);
}

async function rpc<T = unknown>(method: string, args: unknown = {}): Promise<T> {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: uuid(), method, payload: { args } }),
  });
  if (!res.ok) throw new Error(`${method} -> HTTP ${res.status}`);
  const body = (await res.json()) as RpcEnvelope;
  if (!body.result.ok) throw new Error(`${method} -> ${JSON.stringify(body.result)}`);
  return body.result.value as T;
}

interface SessionListItem {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  cwd: string;
  projections?: { values?: { title?: string | null; agentPreset?: string } };
}

function openStream(
  endpoint: string,
  args: unknown,
  onItem: (value: unknown) => void,
  ms = 6000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const wsUrl = BASE.replace('http', 'ws') + '/api/remote.mux';
    const ws = new WebSocket(wsUrl, { headers: { cookie } });
    const streamId = uuid();
    const timer = setTimeout(() => {
      ws.close();
      resolve();
    }, ms);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { type?: string; streamId?: string; value?: unknown };
      if (msg.streamId !== streamId) return;
      if (msg.type === 'item') onItem(msg.value);
    });
    ws.on('error', reject);
    ws.on('close', () => clearTimeout(timer));
  });
}

async function main(): Promise<void> {
  const tokenUrl = `${BASE}/?token=${process.argv[3] ?? ''}`;
  await login(tokenUrl);

  const presets = await rpc<{ presets: Array<{ id: string; isDefault: boolean }> }>('agentPresets/list');
  console.log('预设:', presets.presets.map((p) => p.id).join(', '));

  const list = await rpc<{ items: SessionListItem[] }>('session/list', { _request: {} });
  console.log('会话数:', list.items.length);
  for (const s of list.items.slice(0, 3)) {
    console.log('  -', s.sessionId.slice(0, 18), '|', s.projections?.values?.title ?? '(无标题)', '|', s.running ? '运行中' : '空闲');
  }

  const first = list.items[0];
  if (first) {
    console.log('\n--- session/follow 快照结构 ---');
    await openStream(
      'session/follow',
      {
        request: {
          address: { kind: 'session', sessionId: first.sessionId },
          assistantStream: true,
          maxMessages: 50,
        },
      },
      (value) => {
        const v = value as Record<string, unknown>;
        console.log('item type:', v.type, 'keys:', Object.keys(v).join(','));
        if (v.type === 'snapshot') {
          const snap = v as { header?: unknown; messages?: unknown[] };
          console.log('header:', JSON.stringify(snap.header)?.slice(0, 300));
          console.log('messages:', Array.isArray(snap.messages) ? snap.messages.length : 'n/a');
          const recs = (snap as { records?: unknown[] }).records;
          console.log('records:', Array.isArray(recs) ? recs.length : 'n/a');
          if (Array.isArray(recs) && recs[0]) console.log('record[0]:', JSON.stringify(recs[0]).slice(0, 900));
          console.log('projections:', JSON.stringify((snap as { projections?: unknown }).projections)?.slice(0, 300));
          console.log('assistantStream:', JSON.stringify((snap as { assistantStream?: unknown }).assistantStream)?.slice(0, 200));
          console.log('snapshot keys:', Object.keys(snap).join(','));
        }
      },
      4000,
    );
  }
}

void main().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
});
