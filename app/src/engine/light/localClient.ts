/**
 * 轻引擎的客户端：把「进程内调用」包装成和 EngineClient 一样的接口。
 *
 * 为什么不用 loopback WebSocket：Hermes 里没有 Node 的 ws server，
 * 起一个真的本地端口反而要引原生模块。既然引擎和 UI 在同一个 JS 进程，
 * 直接函数调用就是最稳的"传输"——协议层不变，换引擎不换界面。
 */
import { EngineProtocolError, type ConnectionState, type EngineTransport } from '../../lib/client';
import type {
  Capabilities,
  EngineEvent,
  EventName,
  EventPayloads,
  Method,
  RequestParams,
  RequestResults,
} from '../../protocol';
import type { LightHost } from './host';

type Listener<K extends EventName> = (data: EventPayloads[K], event: EngineEvent<K>) => void;

export class LocalEngineClient implements EngineTransport {
  private readonly host: LightHost;
  private state: ConnectionState = 'idle';
  private capabilities: Capabilities | null = null;
  private listeners = new Map<string, Set<(data: unknown, event: EngineEvent) => void>>();
  private anyListeners = new Set<(event: EngineEvent) => void>();
  private stateListeners = new Set<(state: ConnectionState, detail?: string) => void>();
  private detach: (() => void) | null = null;

  constructor(host: LightHost) {
    this.host = host;
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  get caps(): Capabilities | null {
    return this.capabilities;
  }

  async connect(): Promise<Capabilities> {
    if (this.capabilities) return this.capabilities;
    this.setState('connecting');
    try {
      const caps = await this.host.request('capabilities.get', {});
      this.capabilities = caps;
      this.detach = this.host.onEvent((event) => this.dispatch(event));
      this.setState('connected');
      return caps;
    } catch (error) {
      this.setState('closed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  request<M extends Method>(method: M, params: RequestParams[M]): Promise<RequestResults[M]> {
    if (!this.capabilities) {
      return Promise.reject(
        new EngineProtocolError({ code: 'internal', message: '轻引擎还没连上', hint: '先调用 connect()' }),
      );
    }
    return this.host.request(method, params);
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
    this.detach?.();
    this.detach = null;
    this.capabilities = null;
    this.listeners.clear();
    this.anyListeners.clear();
    this.setState('closed');
  }

  private dispatch(event: EngineEvent): void {
    const listeners = this.listeners.get(event.event);
    if (listeners) {
      for (const listener of [...listeners]) listener(event.data, event);
    }
    for (const listener of [...this.anyListeners]) listener(event);
  }

  private setState(state: ConnectionState, detail?: string): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of [...this.stateListeners]) listener(state, detail);
  }
}
