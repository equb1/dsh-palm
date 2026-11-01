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

const DEFAULT_URL = 'ws://192.168.1.3:8788/ws';

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
      this.patch({ conn: 'closed' });
      this.fail(err);
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
      // 重新打开会话时把还没回答的提问捞回来（真引擎那边由桥维护）
      const { approvals } = await this.client.request('approvals.list', { sessionId: id });
      const map: Record<string, Approval> = {};
      for (const a of approvals) map[a.id] = a;
      this.patch({ approvals: map });
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
      // 提交成功后立刻置为 running：停止按钮要马上出现，
      // 下一条消息也要走 steer（插话）而不是再排一个回合。
      const { detail: latest } = this.state;
      if (latest) this.patch({ busy: false, detail: { ...latest, status: 'running' } });
      else this.patch({ busy: false });
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

  /**
   * 回答 ask_user_question。
   * selected 是选中的选项文案；custom 是"自己说"的自由文本（两者可以同时有）。
   */
  async answerQuestion(callId: string, questionId: string, selected: string[], custom?: string): Promise<void> {
    const { currentId } = this.state;
    if (!this.client || !currentId) return;
    try {
      await this.client.request('questions.answer', {
        sessionId: currentId,
        callId,
        answers: [{ id: questionId, selected, ...(custom ? { custom } : {}) }],
      });
      const next = { ...this.state.approvals };
      delete next[callId];
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
        const nextApprovals = { ...this.state.approvals, [approval.id]: approval };
        const d = this.state.detail;

        // 卡片是挂在回合的 block 上渲染的，所以必须往时间线里插一个 block，
        // 否则 approvals 里有数据、界面上却什么都不画（这就是"一直没有卡片"）。
        if (!d) {
          this.patch({ approvals: nextApprovals });
          return;
        }
        const block: Block = { kind: 'approval', id: 'ap-' + approval.id, approvalId: approval.id };
        const turns = d.turns.slice();
        let placed = false;
        for (let i = turns.length - 1; i >= 0; i--) {
          const t = turns[i]!;
          if (t.role !== 'assistant') continue;
          if (t.blocks.some((b) => b.kind === 'approval' && b.approvalId === approval.id)) {
            placed = true;
            break;
          }
          turns[i] = { ...t, blocks: [...t.blocks, block] };
          placed = true;
          break;
        }
        if (!placed) {
          turns.push({
            id: 'turn-ap-' + approval.id,
            role: 'assistant',
            createdAt: Date.now(),
            status: 'streaming',
            blocks: [block],
          });
        }
        this.patch({ approvals: nextApprovals, detail: { ...d, turns } });
        return;
      }

      case 'approval.resolved': {
        const next = { ...this.state.approvals };
        delete next[data.approvalId as string];
        this.patch({ approvals: next });
        return;
      }

      case 'run.started': {
        // 回合开始：界面要变成"生成中"，发送键变成停止键
        const d = this.state.detail;
        if (d && data.sessionId === currentId) this.patch({ detail: { ...d, status: 'running' }, busy: true });
        return;
      }

      case 'run.finished': {
        const d = this.state.detail;
        this.patch({
          busy: false,
          ...(d && data.sessionId === currentId ? { detail: { ...d, status: 'idle' as const } } : {}),
        });
        return;
      }

      default:
        return;
    }
  }
}

export const store = new Store();
