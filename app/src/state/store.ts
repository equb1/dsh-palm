import { EngineClient, type ConnectionState } from '../lib/client';
import { clearDeviceKey, loadDeviceKey, saveDeviceKey } from '../lib/deviceKey';
import { hostAvailable, hostLogs, hostStatus, startHost, stopHost, type HostStatus } from '../lib/host';
import { loadHostCommands, saveHostCommands } from '../lib/hostCmd';
import type {
  Approval,
  ApprovalDecision,
  Block,
  Capabilities,
  ModelChoice,
  ModelOption,
  PermissionOption,
  SessionDetail,
  SessionSummary,
  Turn,
  Workspace,
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
  /** 宿主可用的模型 */
  models: ModelOption[];
  /** 宿主的默认模型（会话没选过时用它） */
  defaultModel?: ModelChoice;
  /** 模型选择面板是否打开 */
  modelSheetOpen: boolean;
  /** 宿主支持的权限预设 */
  permissions: PermissionOption[];
  /** 宿主默认权限预设 */
  defaultPermission?: string;
  /** 这台设备的配对密钥（配对成功后自动存下来） */
  deviceKey: string | null;
  /** 宿主注册过的工作区 */
  workspaces: Workspace[];
  /** 已上传、等着跟下一条消息一起发的附件 */
  pendingAttachments: Array<{ receiptId: string; name: string }>;
  /** 本机引擎（原生宿主服务）的状态；null 表示这台设备不支持 */
  host: HostStatus | null;
  /** 本机引擎最近日志 */
  hostLogs: string[];
  /** 覆盖用的启动命令（空 = 用 Kotlin 里的默认值） */
  hostEngineCmd: string;
  hostBridgeCmd: string;
}

/**
 * 默认连哪儿。
 *
 * 这台设备自己能起引擎（原生构建）时，桥就在本机 8788——开机即用的那条路；
 * Expo Go / web 没有本机宿主，退回电脑上跑桥的局域网地址。
 */
const DEFAULT_URL = hostAvailable ? 'ws://127.0.0.1:8788/ws' : 'ws://192.168.1.3:8788/ws';

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
    models: [],
    defaultModel: undefined,
    permissions: [],
    defaultPermission: undefined,
    deviceKey: null,
    workspaces: [],
    pendingAttachments: [],
    host: null,
    hostLogs: [],
    hostEngineCmd: '',
    hostBridgeCmd: '',
    modelSheetOpen: false,
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

  /** 忘掉这台设备的配对（宿主那边需要手动删，或者下次从列表里撤） */
  async forgetDevice(): Promise<void> {
    await clearDeviceKey();
    this.patch({ deviceKey: null, conn: 'idle', error: null });
    this.client?.close();
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
      // 连上就把模型/权限/工作区拉到本地：头部徽标和新会话要立刻可用
      void this.refreshModels();
      void this.refreshPermissions();
      void this.refreshWorkspaces();
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

  async createSession(presetId: string, workspaceId?: string): Promise<void> {
    if (!this.client) return;
    this.patch({ busy: true, error: null });
    try {
      const { session } = await this.client.request('sessions.create', {
        presetId,
        ...(workspaceId ? { workspaceId } : {}),
      });
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

  /* ---------------------------- 模型 ---------------------------- */

  /** 上传一个附件，成功后挂进待发送列表 */
  async uploadAttachment(base64: string, name: string): Promise<void> {
    const { currentId } = this.state;
    if (!this.client || !currentId) return;
    this.patch({ busy: true, error: null });
    try {
      const res = await this.client.request('attachments.upload', { sessionId: currentId, data: base64, name });
      this.patch({
        busy: false,
        pendingAttachments: [...this.state.pendingAttachments, { receiptId: res.receiptId, name: res.name ?? name }],
      });
    } catch (err) {
      this.fail(err);
      this.patch({ busy: false });
    }
  }

  removeAttachment(receiptId: string): void {
    this.patch({ pendingAttachments: this.state.pendingAttachments.filter((a) => a.receiptId !== receiptId) });
  }

  /** 拉一次宿主可用模型；打开面板前调用，失败不打扰用户 */
  async refreshModels(): Promise<void> {
    if (!this.client) return;
    try {
      const { models, default: fallback } = await this.client.request('models.list', {});
      this.patch({ models, defaultModel: fallback });
    } catch {
      /* 宿主没实现就当没有模型可选 */
    }
  }

  openModelSheet(): void {
    this.patch({ modelSheetOpen: true });
    void this.refreshModels();
  }

  closeModelSheet(): void {
    this.patch({ modelSheetOpen: false });
  }

  /** 拉一次权限预设目录 */
  async refreshPermissions(): Promise<void> {
    if (!this.client) return;
    try {
      const { options, default: fallback } = await this.client.request('permissions.list', {});
      this.patch({ permissions: options, defaultPermission: fallback });
    } catch {
      /* 宿主没实现就不显示 */
    }
  }

  async refreshWorkspaces(): Promise<void> {
    if (!this.client) return;
    try {
      const { workspaces } = await this.client.request('workspaces.list', {});
      this.patch({ workspaces });
    } catch {
      /* ignore */
    }
  }

  /** 切当前会话的权限（沙箱 + 审批策略一起换） */
  async setPermission(preset: string): Promise<void> {
    const { currentId } = this.state;
    if (!this.client || !currentId) return;
    try {
      const { session } = await this.client.request('sessions.setPermission', { sessionId: currentId, preset });
      this.patch({ detail: session });
    } catch (err) {
      this.fail(err);
    }
  }

  /** 切当前会话的模型（写进会话事件，换设备/重开都一样） */
  async setModel(provider: string, model: string, reasoningEffort?: string): Promise<void> {
    const { currentId } = this.state;
    if (!this.client || !currentId) return;
    try {
      const { session } = await this.client.request('sessions.setModel', {
        sessionId: currentId,
        provider,
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      });
      this.patch({ detail: session, modelSheetOpen: false });
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

  /* ------------------------ 本机引擎 ------------------------ */

  /** 拉一次宿主服务状态（设置页每 2 秒调一次） */
  async refreshHost(): Promise<void> {
    if (!hostAvailable) return;
    const status = await hostStatus();
    if (status) this.patch({ host: status });
  }

  /** 自动连接只赌一次：冷启动时本机引擎就绪后连一次，失败就交回给用户 */
  private autoConnectTried = false;

  /**
   * 本机模式的一键连接。
   *
   * 引擎和桥都是 App 自己拉起来的：地址是本机 127.0.0.1，配对码就打在桥的启动日志里。
   * 让用户再手抄一遍六位数字没有道理——桥 ready 后自动填码并连一次。
   */
  async maybeAutoConnect(): Promise<void> {
    if (!hostAvailable || this.autoConnectTried) return;
    const host = this.state.host;
    if (!host || host.engine !== 'ready' || host.bridge !== 'ready') return;
    if (this.state.caps || this.state.conn === 'connecting') return;
    this.autoConnectTried = true;

    if (!this.state.deviceKey && !this.state.pairCode.trim()) {
      try {
        const logs = await hostLogs();
        const found = logs.join('\n').match(/配对码\s+(\d{6})/);
        if (found) this.patch({ pairCode: found[1] });
      } catch {
        // 日志读不到就退回手输
      }
    }
    await this.connect();
  }

  /** 读一次自定义启动命令（进设置页时调） */
  async loadHostCommands(): Promise<void> {
    const cmds = await loadHostCommands();
    this.patch({ hostEngineCmd: cmds.engineCmd, hostBridgeCmd: cmds.bridgeCmd });
  }

  setHostCommands(engineCmd: string, bridgeCmd: string): void {
    this.patch({ hostEngineCmd: engineCmd, hostBridgeCmd: bridgeCmd });
    void saveHostCommands({ engineCmd, bridgeCmd });
  }

  async startLocalHost(): Promise<void> {
    if (!hostAvailable) {
      this.setError('这台设备不支持本机引擎（需要原生构建，Expo Go 不行）');
      return;
    }
    await startHost({
      engineCmd: this.state.hostEngineCmd.trim() || undefined,
      bridgeCmd: this.state.hostBridgeCmd.trim() || undefined,
    });
    await this.refreshHost();
  }

  async stopLocalHost(): Promise<void> {
    if (!hostAvailable) return;
    await stopHost();
    await this.refreshHost();
  }

  async refreshHostLogs(): Promise<void> {
    if (!hostAvailable) return;
    this.patch({ hostLogs: await hostLogs() });
  }

  /** 让界面层也能报一个可读错误（例如图片太大） */
  setError(message: string): void {
    this.patch({ error: message, busy: false });
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

      case 'device.paired': {
        const key = String((data as { key?: string }).key ?? '');
        if (key) {
          this.patch({ deviceKey: key });
          void saveDeviceKey(key);
        }
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
