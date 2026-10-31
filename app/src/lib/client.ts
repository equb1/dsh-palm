/**
 * 引擎客户端 —— 框架无关。
 *
 * 不依赖 React / React Native / Node 专有 API：
 *  - WebSocket 由外部注入（RN 用全局，Node 测试用 ws）
 *  - 只用 globalThis.setTimeout / clearTimeout
 *
 * 这一层可以单测，也是 UI 与引擎之间唯一的缝。
 */

import {
  type Capabilities,
  type EngineEvent,
  type EventName,
  type EventPayloads,
  type Method,
  type ProtocolError,
  type RequestParams,
  type RequestResults,
  type ServerMessage,
  isEvent,
} from '../protocol';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

type WebSocketLike = {
  close(): void;
  send(data: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
};

export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface ClientOptions {
  url: string;
  webSocketImpl?: WebSocketCtor;
  requestTimeoutMs?: number;
  autoReconnect?: boolean;
  /** 重连退避：第 n 次重试等待 min(base * 2^n, max) 毫秒 */
  backoff?: { baseMs?: number; maxMs?: number };
  now?: () => number;
}

type Listener<K extends EventName> = (data: EventPayloads[K], event: EngineEvent<K>) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class EngineProtocolError extends Error {
  readonly code: ProtocolError['code'];
  readonly hint?: string;

  constructor(err: ProtocolError) {
    super(err.message);
    this.name = 'EngineProtocolError';
    this.code = err.code;
    this.hint = err.hint;
  }
}

export class EngineClient {
  private readonly opts: Required<Omit<ClientOptions, 'webSocketImpl' | 'now'>> & {
    webSocketImpl?: WebSocketCtor;
    now: () => number;
  };
  private ws: WebSocketLike | null = null;
  private state: ConnectionState = 'idle';
  private seq = 0;
  private reqId = 0;
  private pending = new Map<string, Pending>();
  private listeners = new Map<string, Set<(data: unknown, event: EngineEvent) => void>>();
  private stateListeners = new Set<(s: ConnectionState, detail?: string) => void>();
  private anyListeners = new Set<(event: EngineEvent) => void>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private capabilities: Capabilities | null = null;

  constructor(options: ClientOptions) {
    this.opts = {
      url: options.url,
      requestTimeoutMs: options.requestTimeoutMs ?? 15_000,
      autoReconnect: options.autoReconnect ?? true,
      backoff: options.backoff ?? {},
      webSocketImpl: options.webSocketImpl,
      now: options.now ?? (() => Date.now()),
    };
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  get caps(): Capabilities | null {
    return this.capabilities;
  }

  /* ---------------------------------------------------------------- */

  async connect(): Promise<Capabilities> {
    this.disposed = false;
    const caps = await this.openAndHandshake();
    return caps;
  }

  private openAndHandshake(): Promise<Capabilities> {
    this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    return new Promise<Capabilities>((resolve, reject) => {
      let settled = false;
      let ws: WebSocketLike;

      try {
        const Ctor = this.opts.webSocketImpl ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
        if (!Ctor) throw new Error('当前环境没有 WebSocket，请注入 webSocketImpl');
        ws = new Ctor(this.opts.url);
      } catch (err) {
        this.setState('closed');
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      this.ws = ws;

      ws.onopen = () => {
        this.setState('connected');
        this.reconnectAttempt = 0;
        this.request('capabilities.get', {})
          .then((caps) => {
            this.capabilities = caps;
            settled = true;
            resolve(caps);
          })
          .catch((err) => {
            settled = true;
            reject(err);
          });
      };

      ws.onmessage = (ev) => {
        this.handleMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
      };

      ws.onerror = () => {
        // onclose 一定会跟着来，这里不重复处理
      };

      ws.onclose = (ev: unknown) => {
        const code = (ev as { code?: number })?.code ?? 0;
        const reason = (ev as { reason?: string })?.reason ?? '';
        this.ws = null;
        // 4001 = 宿主拒绝：缺配对码。重连也没用，直接停。
        if (code === 4001) {
          this.disposed = true;
          this.setState('closed', reason || '需要配对码');
          this.rejectAllPending(new Error(reason || '需要配对码'));
          if (!settled) {
            settled = true;
            reject(new Error(reason || '需要配对码'));
          }
          return;
        }
        this.rejectAllPending(new Error('连接已断开'));
        if (!settled) {
          settled = true;
          reject(new Error('连接失败'));
        }
        if (this.disposed) {
          this.setState('closed');
          return;
        }
        if (this.opts.autoReconnect) {
          this.scheduleReconnect();
        } else {
          this.setState('closed');
        }
      };
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const base = this.opts.backoff.baseMs ?? 800;
    const max = this.opts.backoff.maxMs ?? 8_000;
    const delay = Math.min(base * 2 ** this.reconnectAttempt, max);
    this.reconnectAttempt += 1;
    this.setState('reconnecting', `${Math.round(delay / 100) / 10}s 后重试`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed) return;
      this.openAndHandshake().catch(() => {
        // onclose 已经排好了下一次重试
      });
    }, delay);
  }

  /* ---------------------------------------------------------------- */

  request<M extends Method>(
    method: M,
    params: RequestParams[M],
  ): Promise<RequestResults[M]> {
    const ws = this.ws;
    if (!ws) return Promise.reject(new Error('未连接'));
    const id = `r${++this.reqId}`;
    const message = JSON.stringify({ type: 'req', v: 1, id, method, params });
    return new Promise<RequestResults[M]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new EngineProtocolError({ code: 'internal', message: `请求超时：${method}` }));
      }, this.opts.requestTimeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        ws.send(message);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  on<K extends EventName>(event: K, listener: Listener<K>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as (data: unknown, event: EngineEvent) => void);
    this.listeners.set(event, set);
    return () => {
      set.delete(listener as (data: unknown, event: EngineEvent) => void);
    };
  }

  onAny(listener: (event: EngineEvent) => void): () => void {
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  onStateChange(listener: (state: ConnectionState, detail?: string) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  close(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectAllPending(new Error('客户端已关闭'));
    this.ws?.close();
    this.ws = null;
    this.setState('closed');
  }

  /* ---------------------------------------------------------------- */

  private handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }

    if (isEvent(msg)) {
      this.seq = msg.seq;
      const listeners = this.listeners.get(msg.event);
      if (listeners) for (const fn of listeners) fn(msg.data, msg);
      for (const fn of this.anyListeners) fn(msg);
      return;
    }

    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.ok) pending.resolve(msg.result);
    else pending.reject(new EngineProtocolError(msg.error));
  }

  private rejectAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private setState(state: ConnectionState, detail?: string): void {
    if (this.state === state) return;
    this.state = state;
    for (const fn of this.stateListeners) fn(state, detail);
  }
}
