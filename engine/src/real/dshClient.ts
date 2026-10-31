/**
 * 真 dsh 引擎的客户端（只读路径）。
 *
 * 依据：docs/10-dsh-api.md（实测 0.2.1-rc.5）
 *   - GET /?token= 换 dsh-auth-* cookie
 *   - POST /api/<ns>/<method>，信封 {type:'client-request', rpcId, method, payload:{args}}
 *   - ws /api/remote.mux，{type:'open', streamId, endpoint} → {type:'item', streamId, value}
 */

export interface RealSessionListItem {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank?: boolean;
  cwd?: string;
  projections?: {
    asOfSeq?: number;
    values?: {
      title?: string | null;
      agentPreset?: string;
      permissions?: { currentValue?: string };
      workingDirectory?: string;
      sessionStats?: { turns?: number; steps?: number };
    };
  };
}

export interface RealSnapshot {
  header?: { id?: string; createdAt?: number; cwd?: string; agentPreset?: string };
  cursor?: unknown;
  records?: Array<{ type?: string; event?: { type?: string; seq?: number; time?: number; data?: unknown } }>;
  hasMore?: boolean;
  projections?: unknown;
  assistantStream?: { revision?: number };
}

interface RpcEnvelope {
  type: 'server-response';
  rpcId: string;
  result: { ok: true; value: unknown } | { ok: false; error?: unknown };
}

export class DshRealClient {
  private cookie = '';
  readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  /** 用 URL 里的 token 换 cookie；/api 只认 cookie，不认 query token */
  async login(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/?token=${encodeURIComponent(this.token)}`, {
      redirect: 'manual',
    });
    const list = res.headers.getSetCookie?.() ?? [];
    if (list.length === 0) {
      const single = res.headers.get('set-cookie');
      if (single) list.push(single);
    }
    if (list.length === 0) throw new Error('登录失败：服务器没有下发 cookie');
    this.cookie = list.map((c) => c.split(';')[0]).join('; ');
  }

  async rpc<T = unknown>(method: string, args: unknown = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: crypto.randomUUID(),
        method,
        payload: { args },
      }),
    });
    if (!res.ok) throw new Error(`${method} -> HTTP ${res.status}`);
    const body = (await res.json()) as RpcEnvelope;
    if (!body.result.ok) throw new Error(`${method} -> ${JSON.stringify(body.result).slice(0, 200)}`);
    return body.result.value as T;
  }

  listSessions(): Promise<{ items: RealSessionListItem[] }> {
    return this.rpc('session/list', { _request: {} });
  }

  listAgentPresets(): Promise<{ presets: Array<{ id: string; order?: number; isDefault?: boolean }> }> {
    return this.rpc('agentPresets/list');
  }

  /** 开 session/follow 流，拿第一帧 snapshot 后关掉 */
  snapshot(sessionId: string, timeoutMs = 4000): Promise<RealSnapshot | null> {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/api/remote.mux';
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: RealSnapshot | null): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve(v);
      };

      const ws = new WebSocket(wsUrl, { headers: { cookie: this.cookie } } as never);
      const streamId = crypto.randomUUID();
      const timer = setTimeout(() => finish(null), timeoutMs);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'open',
            streamId,
            endpoint: 'session/follow',
            payload: {
              args: {
                request: {
                  address: { kind: 'session', sessionId },
                  assistantStream: true,
                  maxMessages: 200,
                },
              },
            },
          }),
        );
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String((ev as MessageEvent).data)) as {
            streamId?: string;
            type?: string;
            value?: RealSnapshot;
          };
          if (msg.streamId !== streamId || msg.type !== 'item' || !msg.value) return;
          if (msg.value.header) finish(msg.value);
        } catch {
          /* ignore */
        }
      };
      ws.onerror = () => finish(null);
    });
  }
}
