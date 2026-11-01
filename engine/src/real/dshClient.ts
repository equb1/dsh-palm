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
    /** 会话当前选的模型（next 是下一轮要用的，lastUsed 是上轮用过的） */
    modelSelection?: {
      lastUsed?: { provider?: string; model?: string; reasoningEffort?: string } | null;
      next?: { provider?: string; model?: string; reasoningEffort?: string } | null;
    };
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
    if (!body.result.ok) throw new Error(`${method} -> ${describeRpcError(body.result)}`);
    return body.result.value as T;
  }

  listSessions(): Promise<{ items: RealSessionListItem[] }> {
    return this.rpc('session/list', { _request: {} });
  }

  listAgentPresets(): Promise<{ presets: Array<{ id: string; order?: number; isDefault?: boolean }> }> {
    return this.rpc('agentPresets/list');
  }

  /** 持续跟一个会话的流，回调每个 item；返回取消函数 */
  follow(sessionId: string, onValue: (value: Record<string, unknown>) => void): () => void {
    const ws = new WebSocket(this.baseUrl.replace(/^http/, 'ws') + '/api/remote.mux', {
      headers: { cookie: this.cookie },
    } as never);
    const streamId = crypto.randomUUID();
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'open',
          streamId,
          endpoint: 'session/follow',
          payload: {
            args: { request: { address: { kind: 'session', sessionId }, assistantStream: true, maxMessages: 500 } },
          },
        }),
      );
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String((ev as MessageEvent).data)) as {
          streamId?: string;
          type?: string;
          value?: Record<string, unknown>;
        };
        // 多路流里既有 type='item'（assistant-stream），也有别种信封（事件），
        // 一律按 streamId 过滤，别按 type 过滤——否则 tool/call 这类事件会被丢掉。
        if (msg.streamId !== streamId || !msg.value) return;

        onValue(msg.value);
      } catch {
        /* ignore */
      }
    };
    return () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  /**
   * 挂住一个待回答的提问（userQuestions/attachWait 是个流端点）。
   * 不挂的话，answer 会返回 false —— 问题不在 "continued" 集合里。
   * 返回关闭函数，回答完就关。
   */
  attachWait(sessionId: string, callId: string): () => void {
    const ws = new WebSocket(this.baseUrl.replace(/^http/, 'ws') + '/api/remote.mux', {
      headers: { cookie: this.cookie },
    } as never);
    const streamId = crypto.randomUUID();
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'open',
          streamId,
          endpoint: 'userQuestions/attachWait',
          payload: { args: { agentId: sessionId, callId } },
        }),
      );
    };
    // 流里的内容我们暂时不消费，挂着就行
    ws.onmessage = () => undefined;
    return () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }
  /**
   * 打开 $events 远程事件流。
   * 第一帧是 {type:'ready', clientId}，之后会有：
   *   {type:'waterfall', event, eventId, agentId, request}  需要客户端作答
   *   {type:'emit', event, args}                            只是通知
   */
  openEvents(onFrame: (frame: Record<string, unknown>) => void): () => void {
    const ws = new WebSocket(this.baseUrl.replace(/^http/, 'ws') + '/api/remote.mux', {
      headers: { cookie: this.cookie },
    } as never);
    const streamId = crypto.randomUUID();
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'open', streamId, endpoint: '$events', payload: { args: {} } }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String((ev as MessageEvent).data)) as { streamId?: string; value?: Record<string, unknown> };
        if (msg.streamId !== streamId || !msg.value) return;
        onFrame(msg.value);
      } catch {
        /* ignore */
      }
    };
    return () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  /** 开任意 mux 流，回调每个 value；返回关闭函数 */
  openStream(endpoint: string, args: Record<string, unknown>, onValue: (value: Record<string, unknown>) => void): () => void {
    const ws = new WebSocket(this.baseUrl.replace(/^http/, 'ws') + '/api/remote.mux', {
      headers: { cookie: this.cookie },
    } as never);
    const streamId = crypto.randomUUID();
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String((ev as MessageEvent).data)) as {
          streamId?: string;
          type?: string;
          value?: Record<string, unknown>;
          error?: unknown;
        };
        if (msg.streamId !== streamId) return;
        if (msg.type === 'error') return;
        if (msg.value) onValue(msg.value);
      } catch {
        /* ignore */
      }
    };
    return () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  /** 回答一个 waterfall 事件（这是唯一能"窗口内作答"的通道） */
  async submitEventResult(input: {
    clientId: string;
    eventId: string;
    outcome: { kind: 'result'; value?: unknown } | { kind: 'next' };
  }): Promise<void> {
    const res = await fetch(this.baseUrl + '/api/$events/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: crypto.randomUUID(),
        method: '$events/result',
        payload: { args: input },
      }),
    });
    if (!res.ok) throw new Error('$events/result -> HTTP ' + String(res.status));
  }
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
          // 多路流里既有 type='item'（assistant-stream），也有别种信封（事件），
        // 一律按 streamId 过滤，别按 type 过滤——否则 tool/call 这类事件会被丢掉。
        if (msg.streamId !== streamId || !msg.value) return;
          if (msg.value.header) finish(msg.value);
        } catch {
          /* ignore */
        }
      };
      ws.onerror = () => finish(null);
    });
  }
}

/** 把网关错误压成一行可读文本（保留 code / message / issues 的字段名） */
function describeRpcError(result: unknown): string {
  const r = result as {
    error?: { code?: string; message?: string; details?: { issues?: Array<{ path?: unknown[]; message?: string; code?: string }> } };
  };
  const err = r.error;
  if (!err) return JSON.stringify(result).slice(0, 400);
  const parts = [err.code ?? 'error', err.message ?? ''].filter(Boolean);
  const issues = err.details?.issues ?? [];
  for (const issue of issues.slice(0, 6)) {
    const path = Array.isArray(issue.path) ? issue.path.join('.') : '';
    parts.push(((path || '(root)') + ': ' + (issue.code ?? '') + ' ' + (issue.message ?? '')).trim());
  }
  return parts.join(' | ').slice(0, 600);
}

