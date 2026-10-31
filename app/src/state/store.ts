import { EngineClient, type ConnectionState } from '../lib/client';
import type {
  Approval,
  ApprovalDecision,
  Block,
  Capabilities,
  SessionDetail,
  SessionSummary,
  Turn,
} from '../protocol';

export interface AppState {
  /** 每次变化自增；getSnapshot 靠它换引用来触发重渲染 */
  version: number;
  conn: ConnectionState;
  connDetail?: string;
  url: string;
  /** 宿主打印的六位配对码；空表示宿主没开鉴权 */
  pairCode: string;
  caps: Capabilities | null;
  sessions: SessionSummary[];
  currentId: string | null;
  detail: SessionDetail | null;
  approvals: Record<string, Approval>;
  error: string | null;
  busy: boolean;
  /** 首页输入框当前选中的锦囊 */
  draftPresetId: string | null;
  /** 当前页面：主界面 / 设置 */
  view: 'main' | 'settings';
  /** 模型凭据状态（ref -> 是否已配置） */
  credentials: Record<string, { configured: boolean; writable: boolean }>;
}

const DEFAULT_URL = 'ws://192.168.1.100:8787/ws';

type Listener = () => void;

export class Store {
  private state: AppState = {
    version: 0,
    conn: 'idle',
    url: DEFAULT_URL,
    pairCode: '',
    caps: null,
    sessions: [],
    currentId: null,
    detail: null,
    approvals: {},
    error: null,
    busy: false,
    draftPresetId: null,
    view: 'main',
    credentials: {},
  };

  private listeners = new Set<Listener>();
  private client: EngineClient | null = null;

  /* ------------------------------------------------------------ */

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): AppState => this.state;

  private patch(next: Partial<AppState>): void {
    this.state = { ...this.state, ...next, version: this.state.version + 1 };
    for (const fn of this.listeners) fn();
  }

  private fail(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.patch({ error: message, busy: false });
  }

  /* ------------------------------------------------------------ */

  setUrl(url: string): void {
    this.patch({ url });
  }

  setPairCode(pairCode: string): void {
    this.patch({ pairCode });
  }

  async connect(url?: string): Promise<void> {
    const target = (url ?? this.state.url).trim();
    const code = this.state.pairCode.trim();
    const separator = target.includes('?') ? '&' : '?';
    const endpoint = code ? target + separator + 'pair=' + encodeURIComponent(code) : target;
    this.patch({ url: target, error: null, conn: 'connecting' });

    this.client?.close();
    const client = new EngineClient({ url: endpoint, autoReconnect: true });
    this.client = client;

    client.onStateChange((conn, connDetail) => {
      this.patch({ conn, connDetail });
    });

    client.onAny((event) => this.applyEvent(event.event, event.data));

    try {
      const caps = await client.connect();
      this.patch({
        caps,
        conn: 'connected',
        error: null,
        draftPresetId: this.state.draftPresetId ?? caps.presets[0]?.id ?? null,
      });
      await this.refreshSessions();
    } catch (err) {
      // 第一次就连不上：别假装在重连，直接报错并停掉重试循环
      client.close();
      const raw = err instanceof Error ? err.message : String(err);
      const friendly =
        raw.includes('需要配对码')
          ? '配对码不对。看电脑上桥的终端里打印的那六位。'
          : '连不上 ' +
            target +
            '。检查三件事：手机和电脑在同一个 Wi-Fi、地址里的 IP 是电脑的（不是 localhost）、Windows 防火墙放行 8787/8788 端口。';
      this.patch({ conn: 'closed', error: friendly });
    }
  }

  disconnect(): void {
    this.client?.close();
    this.client = null;
    this.patch({ conn: 'closed', caps: null, detail: null, currentId: null });
  }

  /* ------------------------------------------------------------ */

  async refreshSessions(): Promise<void> {
    if (!this.client) return;
    try {
      const { sessions } = await this.client.request('sessions.list', {});
      this.patch({ sessions });
    } catch (err) {
      this.fail(err);
    }
  }

  async openSession(id: string): Promise<void> {
    if (!this.client) return;
    this.patch({ busy: true, error: null });
    try {
      const { session } = await this.client.request('sessions.get', { sessionId: id });
      this.patch({ detail: session, currentId: id, busy: false });
    } catch (err) {
      this.fail(err);
    }
  }

  closeSession(): void {
    this.patch({ detail: null, currentId: null });
  }

  async createSession(presetId: string): Promise<void> {
    if (!this.client) return;
    this.patch({ busy: true, error: null });
    try {
      const { session } = await this.client.request('sessions.create', { presetId });
      await this.openSession(session.id);
    } catch (err) {
      this.fail(err);
    }
  }

  async openSettings(): Promise<void> {
    this.patch({ view: 'settings', error: null });
    await this.refreshCredentials();
  }

  closeSettings(): void {
    this.patch({ view: 'main' });
  }

  async refreshCredentials(ref = 'DEEPSEEK_API_KEY'): Promise<void> {
    if (!this.client) return;
    try {
      const { credentials } = await this.client.request('credentials.describe', { refs: [ref] });
      this.patch({ credentials });
    } catch (err) {
      this.fail(err);
    }
  }

  async saveCredential(ref: string, value: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.request('credentials.set', { ref, value });
      await this.refreshCredentials(ref);
      return true;
    } catch (err) {
      this.fail(err);
      return false;
    }
  }

  setDraftPreset(presetId: string): void {
    this.patch({ draftPresetId: presetId });
  }

  /**
   * 首页输入框直接开聊：用当前选中的锦囊建会话，再把这句话发出去。
   * 标题先取这句话的前 18 个字，之后可以再让模型改。
   */
  async startWith(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!this.client || !trimmed) return;
    const presetId = this.state.draftPresetId ?? this.state.caps?.presets[0]?.id;
    if (!presetId) return;
    this.patch({ busy: true, error: null });
    try {
      const { session } = await this.client.request('sessions.create', {
        presetId,
        title: trimmed.length > 18 ? `${trimmed.slice(0, 18)}…` : trimmed,
      });
      await this.openSession(session.id);
      await this.send(trimmed);
    } catch (err) {
      this.fail(err);
    }
  }

  async send(text: string): Promise<void> {
    const { currentId, detail } = this.state;
    if (!this.client || !currentId || !detail || !text.trim()) return;
    const running = detail.status === 'running' || detail.status === 'waiting_approval';
    this.patch({ busy: true, error: null });
    try {
      if (running) await this.client.request('sessions.steer', { sessionId: currentId, text });
      else await this.client.request('sessions.send', { sessionId: currentId, text });
      this.patch({ busy: false });
    } catch (err) {
      this.fail(err);
    }
  }

  async stop(): Promise<void> {
    const { currentId } = this.state;
    if (!this.client || !currentId) return;
    try {
      await this.client.request('sessions.stop', { sessionId: currentId });
    } catch (err) {
      this.fail(err);
    }
  }

  async setPreset(presetId: string): Promise<void> {
    const { currentId } = this.state;
    if (!this.client || !currentId) return;
    try {
      const { session } = await this.client.request('sessions.setPreset', { sessionId: currentId, presetId });
      this.patch({ detail: session });
    } catch (err) {
      this.fail(err);
    }
  }

  async resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.request('approvals.resolve', { approvalId, decision });
      const next = { ...this.state.approvals };
      delete next[approvalId];
      this.patch({ approvals: next });
    } catch (err) {
      this.fail(err);
    }
  }

  clearError(): void {
    this.patch({ error: null });
  }

  /* ------------------------------------------------------------ */

  /** 事件统一在这里落到状态上；UI 不做任何拼装 */
  private applyEvent(name: string, data: any): void {
    const { detail, currentId } = this.state;

    switch (name) {
      case 'session.created':
      case 'session.updated': {
        const session = data.session as SessionSummary;
        const sessions = this.state.sessions.slice();
        const i = sessions.findIndex((s) => s.id === session.id);
        if (i >= 0) sessions[i] = session;
        else sessions.unshift(session);
        sessions.sort((a, b) => b.updatedAt - a.updatedAt);
        const patch: Partial<AppState> = { sessions };
        if (detail && detail.id === session.id) patch.detail = { ...detail, ...session };
        this.patch(patch);
        return;
      }

      case 'block.appended': {
        if (!detail || data.sessionId !== currentId) return;
        const turn = data.turn as Turn;
        const turns = detail.turns.slice();
        const i = turns.findIndex((t) => t.id === turn.id);
        if (i >= 0) turns[i] = turn;
        else turns.push(turn);
        this.patch({ detail: { ...detail, turns } });
        return;
      }

      case 'block.delta': {
        if (!detail || data.sessionId !== currentId) return;
        // 流式热路径：就地追加，靠 version 触发重渲染，避免每个 token 复制整棵树
        const turn = detail.turns.find((t) => t.id === data.turnId);
        const block = turn?.blocks.find((b) => b.id === data.blockId) as
          | Extract<Block, { kind: 'text' | 'thinking' }>
          | undefined;
        if (!block) return;
        if (data.op === 'replace') block.text = data.text;
        else block.text += data.text;
        this.patch({});
        return;
      }

      case 'block.updated': {
        if (!detail || data.sessionId !== currentId) return;
        const turn = detail.turns.find((t) => t.id === data.turnId);
        if (!turn) return;
        const i = turn.blocks.findIndex((b) => b.id === (data.block as Block).id);
        if (i >= 0) turn.blocks[i] = data.block as Block;
        this.patch({});
        return;
      }

      case 'approval.requested': {
        const approval = data.approval as Approval;
        this.patch({ approvals: { ...this.state.approvals, [approval.id]: approval } });
        return;
      }

      case 'approval.resolved': {
        const next = { ...this.state.approvals };
        delete next[data.approvalId as string];
        this.patch({ approvals: next });
        return;
      }

      case 'run.finished': {
        this.patch({ busy: false });
        return;
      }

      default:
        return;
    }
  }
}

export const store = new Store();
