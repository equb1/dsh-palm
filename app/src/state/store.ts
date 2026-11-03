import { EngineClient, type ConnectionState, type EngineTransport } from '../lib/client';
import { clearDeviceKey, loadDeviceKey, saveDeviceKey } from '../lib/deviceKey';
import {
  getInitialNotificationSession,
  hostAvailable,
  hostLogs,
  hostStatus,
  readHostUiCache,
  startHost,
  stopHost,
  writeHostUiCache,
  type HostStatus,
} from '../lib/host';
import { loadHostCommands, saveHostCommands } from '../lib/hostCmd';
import { humanizeError } from '../lib/errors';
import { createLightHost, saveLightConfig, type LightEngineSetup } from '../lib/light';
import { LocalEngineClient } from '../engine/light/localClient';
import type { LightHost } from '../engine/light/host';
import { ensureNotificationPermission, notifyEvent } from '../lib/notify';
import { isAppActive, openUrl } from '../lib/platform';
import { getInitialShare, readFileBase64 } from '../lib/share';
import type { AttachmentKind } from '../lib/pickImage';
import type {
  AccountState,
  Approval,
  CatalogProvider,
  ProviderModel,
  ProviderProtocol,
  ProviderRow,
  RequestParams,
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

export interface PendingAttachment {
  /** 已上传拿到的回执 id；列表页暂存阶段为 staged-* 临时 id */
  receiptId: string;
  name: string;
  kind?: AttachmentKind;
  /** 列表页尚未创建会话时暂存的 base64，建会话后自动上传 */
  base64?: string;
  uploading?: boolean;
}

const LOCAL_DEFAULT_CAPS: Capabilities = {
  protocol: 1,
  host: { id: 'host-real-dsh', name: '本机引擎', kind: 'phone', platform: 'android-arm64', engineVersion: '0.2.1' },
  presets: [
    {
      id: 'standard',
      name: '标准',
      glyph: '标',
      tagline: '宿主预设 · standard（默认）',
      version: 'host',
      builtin: true,
      contract: { tools: [], net: 'allow' },
      modelPolicy: {},
    },
    {
      id: 'minimal',
      name: '精简',
      glyph: '简',
      tagline: '宿主预设 · minimal',
      version: 'host',
      builtin: true,
      contract: { tools: [], net: 'allow' },
      modelPolicy: {},
    },
    {
      id: 'ptc',
      name: 'PTC',
      glyph: 'P',
      tagline: '宿主预设 · ptc',
      version: 'host',
      builtin: true,
      contract: { tools: [], net: 'allow' },
      modelPolicy: {},
    },
    {
      id: 'cordis',
      name: 'Cordis',
      glyph: 'C',
      tagline: '宿主预设 · cordis',
      version: 'host',
      builtin: true,
      contract: { tools: [], net: 'allow' },
      modelPolicy: {},
    },
  ],
  workspaces: [],
  limits: { maxAttachmentMB: 20, maxFetchFileMB: 20 },
  events: ['engine.status', 'session.created', 'session.updated', 'run.started', 'block.appended', 'block.delta', 'block.updated', 'run.finished', 'approval.requested', 'approval.resolved', 'account.updated'],
  actions: ['create_session', 'steer', 'stop', 'approve', 'reject'],
};

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
  /** 已上传或暂存、等着跟下一条消息一起发的附件 */
  pendingAttachments: PendingAttachment[];
  /** 是否打开连接/诊断面板（本机模式下默认不挡首屏，直接进主页） */
  connectModalOpen: boolean;
  /** DeepSeek 账号（未登录 / 已存凭据，含正在进行的登录尝试） */
  account: AccountState | null;
  /** 宿主上配置的模型提供商（自定义渠道） */
  providers: ProviderRow[];
  /** 内置提供商目录（第三方） */
  providerCatalog: CatalogProvider[];
  /** 从系统分享菜单进来的内容（冷启动读一次） */
  pendingShare: { text?: string; imagePath?: string; imageName?: string } | null;
  /** 本机引擎（原生宿主服务）的状态；null 表示这台设备不支持 */
  host: HostStatus | null;
  /** 本机引擎最近日志 */
  hostLogs: string[];
  /** 覆盖用的启动命令（空 = 用 Kotlin 里的默认值） */
  hostEngineCmd: string;
  hostBridgeCmd: string;
  /** 当前连的是哪种引擎：远程宿主 / 本机轻引擎 */
  engineKind: 'remote' | 'light' | null;
}

/**
 * 默认连哪儿。
 *
 * 这台设备自己能起引擎（原生构建）时，桥就在本机 8788——开机即用的那条路；
 * Expo Go / web 没有本机宿主，退回电脑上跑桥的局域网地址。
 */
const DEFAULT_URL = hostAvailable ? 'ws://127.0.0.1:8788/ws' : 'ws://192.168.1.3:8788/ws';

type Listener = () => void;

function sameBlock(a: Block, b: Block): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'text' && b.kind === 'text') return a.id === b.id || a.text === b.text;
  if (a.kind === 'thinking' && b.kind === 'thinking') return a.id === b.id || a.text === b.text;
  if (a.kind === 'tool' && b.kind === 'tool') {
    return a.id === b.id || (a.name === b.name && a.summary === b.summary);
  }
  if (a.kind === 'approval' && b.kind === 'approval') return a.approvalId === b.approvalId;
  return a.id === b.id;
}

function mergeTurn(prev: Turn, next: Turn): Turn {
  const blocks = prev.blocks.slice();
  for (const block of next.blocks) {
    if (!blocks.some((b) => sameBlock(b, block))) blocks.push(block);
  }
  return {
    ...prev,
    runId: prev.runId ?? next.runId,
    blocks,
    status: prev.status === 'streaming' || next.status === 'streaming' ? 'streaming' : next.status,
    meta: prev.meta ?? next.meta,
    usage: prev.usage ?? next.usage,
    createdAt: Math.min(prev.createdAt, next.createdAt),
  };
}

function sharesBlock(a: Turn, b: Turn): boolean {
  return a.blocks.some((x) => b.blocks.some((y) => sameBlock(x, y)));
}

/** 只合并同一个 run 的快照/实时回合；跨 run 的 assistant 绝不合并 */
function mergeNearbyTurns(turns: Turn[], incoming: Turn): Turn[] {
  if (incoming.role === 'user') {
    if (turns.some((t) => t.id === incoming.id)) return turns;
    return [...turns, incoming];
  }
  const last = turns[turns.length - 1];
  const sameRun =
    last?.role === 'assistant' &&
    ((last.runId && incoming.runId && last.runId === incoming.runId) ||
      last.id === incoming.id ||
      // 宿主快照没有 runId 时，用“双方都在 streaming”或相同 block 认同一轮
      (last.status === 'streaming' && incoming.status === 'streaming') ||
      sharesBlock(last, incoming));
  if (sameRun) {
    const next = turns.slice();
    next[next.length - 1] = mergeTurn(last!, incoming);
    return next;
  }
  return [...turns, incoming];
}

/** 列表/会话事件说这一轮已经结束，但 detail 里还挂着 streaming 时，把它收口 */
function finalizeDetailTurn(detail: SessionDetail, at?: number): SessionDetail {
  let turns = detail.turns;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!;
    if (t.role !== 'assistant') continue;
    if (t.status !== 'streaming') break;
    const duration =
      t.meta?.durationMs ??
      (at && t.createdAt && at > t.createdAt && at - t.createdAt < 6 * 60 * 60 * 1000
        ? at - t.createdAt
        : undefined);
    turns = turns.slice();
    turns[i] = {
      ...t,
      status: 'done',
      meta: {
        ...t.meta,
        ...(duration ? { durationMs: duration, steps: t.meta?.steps ?? t.blocks.length } : {}),
      },
    };
    break;
  }
  return turns === detail.turns ? detail : { ...detail, turns };
}

export class Store {
  /** 流式增量先攒 50ms 再合并，避免每个 token 复制整棵字符串树 */
  private pendingDelta = new Map<string, string>();
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  /** 客户端兜底计时：宿主没带 durationMs 时，run.started 到 run.finished 的耗时 */
  private runStartedAt: number | null = null;
  /** 退出会话时留住 detail，重进时把 live 回合并回去，避免 history + live 两份 */
  private detailCache = new Map<string, SessionDetail>();

  private state: AppState = {
    version: 0,
    conn: 'idle',
    url: DEFAULT_URL,
    pairCode: '',
    caps: hostAvailable ? LOCAL_DEFAULT_CAPS : null,
    sessions: [],
    currentId: null,
    detail: null,
    approvals: {},
    error: null,
    busy: false,
    draftPresetId: hostAvailable ? 'standard' : null,
    view: 'main',
    credentials: {},
    models: [],
    defaultModel: undefined,
    permissions: [],
    defaultPermission: undefined,
    deviceKey: null,
    workspaces: [],
    pendingAttachments: [],
    connectModalOpen: false,
    account: null,
    providers: [],
    providerCatalog: [],
    pendingShare: null,
    host: null,
    hostLogs: [],
    hostEngineCmd: '',
    hostBridgeCmd: '',
    modelSheetOpen: false,
    engineKind: null,
  };

  private listeners = new Set<Listener>();
  private client: EngineTransport | null = null;
  /** 轻引擎实例：断开时要一起关掉（否则后台还在跑） */
  private lightHost: LightHost | null = null;
  /** 已经交给浏览器的登录尝试 id：同一次尝试只开一个标签页 */
  private openedAttemptId: string | null = null;
  /**
   * 这次登录是不是**用户在本机点的**。
   *
   * 桥会把所有客户端的账号事件广播过来；不开这个开关的话，别的设备（或调试探针）
   * 发起的尝试也会被这台手机打开 —— 用户点到已经取消/过期的链接就会看到"授权失败"。
   */
  private pendingSignIn = false;
  /** 已经弹过通知的审批，避免重连/重放时重复打扰 */
  private notifiedApprovals = new Set<string>();

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

  private scheduleDeltaFlush(): void {
    if (this.deltaTimer) return;
    this.deltaTimer = setTimeout(() => {
      this.deltaTimer = null;
      this.flushDeltas();
    }, 50);
  }

  /** 把攒下的流式增量一次性拼进 block；thinking 只留最后 24000 字，防止无限增长 */
  private flushDeltas(): void {
    if (this.pendingDelta.size === 0) return;
    const detail = this.state.detail;
    if (!detail) {
      this.pendingDelta.clear();
      return;
    }
    for (const [blockId, delta] of this.pendingDelta) {
      for (const turn of detail.turns) {
        const block = turn.blocks.find((b) => b.id === blockId) as
          | Extract<Block, { kind: 'text' | 'thinking' }>
          | undefined;
        if (!block) continue;
        block.text += delta;
        if (block.kind === 'thinking' && block.text.length > 24000) {
          block.text = '…' + block.text.slice(-24000);
        }
        break;
      }
    }
    this.pendingDelta.clear();
    const currentId = this.state.currentId;
    let sessions = this.state.sessions;
    if (currentId) {
      let preview = '';
      outer: for (let i = detail.turns.length - 1; i >= 0; i--) {
        const blocks = detail.turns[i]!.blocks;
        for (let j = blocks.length - 1; j >= 0; j--) {
          const b = blocks[j]!;
          if (b.kind === 'text' && b.text.trim()) {
            preview = b.text.replace(/\s+/g, ' ').trim().slice(0, 80);
            break outer;
          }
        }
      }
      sessions = sessions.map((s) =>
        s.id === currentId
          ? { ...s, status: 'running' as const, updatedAt: Date.now(), ...(preview ? { preview } : {}) }
          : s
      );
    }
    this.patch({ sessions });
  }

  private fail(err: unknown): void {
    this.patch({ error: humanizeError(err), busy: false });
  }

  /* ------------------------------------------------------------ */

  setUrl(url: string): void {
    this.patch({ url });
  }

  setPairCode(pairCode: string): void {
    this.patch({ pairCode });
  }

  openConnectModal(): void {
    this.patch({ connectModalOpen: true });
  }

  closeConnectModal(): void {
    this.patch({ connectModalOpen: false });
  }

  private persistUiCache(): void {
    try {
      const payload = JSON.stringify({
        sessions: this.state.sessions.slice(0, 60),
        draftPresetId: this.state.draftPresetId,
        defaultModel: this.state.defaultModel,
      });
      void writeHostUiCache(payload);
    } catch {
      /* ignore */
    }
  }

  /** 启动时瞬间恢复本地缓存的会话列表与设备密钥，保证首屏 0 秒直达 */
  async hydrateLocalCache(): Promise<void> {
    try {
      const [key, rawCache] = await Promise.all([loadDeviceKey(), readHostUiCache()]);
      const nextPatch: Partial<AppState> = {};
      if (key) nextPatch.deviceKey = key;
      if (rawCache) {
        const parsed = JSON.parse(rawCache) as {
          sessions?: SessionSummary[];
          draftPresetId?: string | null;
          defaultModel?: ModelChoice;
        };
        if (Array.isArray(parsed.sessions) && this.state.sessions.length === 0) {
          nextPatch.sessions = parsed.sessions;
        }
        if (parsed.draftPresetId && !this.state.draftPresetId) {
          nextPatch.draftPresetId = parsed.draftPresetId;
        }
        if (parsed.defaultModel && !this.state.defaultModel) {
          nextPatch.defaultModel = parsed.defaultModel;
        }
      }
      if (Object.keys(nextPatch).length > 0) this.patch(nextPatch);
    } catch {
      /* ignore */
    }
  }

  /** 检查是否从点击通知进入，自动跳转到对应会话 */
  async checkNotificationNavigation(): Promise<void> {
    const targetSessionId = await getInitialNotificationSession();
    if (!targetSessionId) return;
    if (this.state.conn === 'connected' && this.client) {
      this.patch({ view: 'main', connectModalOpen: false });
      await this.openSession(targetSessionId);
    } else {
      this.pendingNotificationSessionId = targetSessionId;
    }
  }

  private pendingNotificationSessionId: string | null = null;

  /** 忘掉这台设备的配对（宿主那边需要手动删，或者下次从列表里撤） */
  async forgetDevice(): Promise<void> {
    await clearDeviceKey();
    this.patch({ deviceKey: null, conn: 'idle', error: null });
    this.client?.close();
  }

  async connect(url?: string): Promise<void> {
    const target = (url ?? this.state.url).trim();
    const code = (this.state.pairCode.trim() || this.state.host?.pairCode || '').trim();
    const key = (this.state.deviceKey ?? '').trim();
    const params: string[] = [];
    if (key) params.push('key=' + encodeURIComponent(key));
    if (code) params.push('pair=' + encodeURIComponent(code));
    const separator = target.includes('?') ? '&' : '?';
    const endpoint = params.length > 0 ? target + separator + params.join('&') : target;
    this.patch({ url: target, error: null, conn: 'connecting' });

    this.closeEngines();
    const client = new EngineClient({ url: endpoint, autoReconnect: true });
    await this.attach(client, 'remote');
  }

  /**
   * 连本机的轻引擎：引擎和 UI 在同一个 JS 进程里，传输层换成进程内调用，
   * 但 store 以上（含所有界面）看到的仍是一模一样的协议。
   */
  async connectLight(setup: LightEngineSetup): Promise<void> {
    this.patch({ conn: 'connecting', error: null });
    this.closeEngines();
    try {
      const host = await createLightHost(setup);
      this.lightHost = host;
      const client = new LocalEngineClient(host);
      await this.attach(client, 'light');
      await saveLightConfig(setup);
    } catch (err) {
      this.lightHost?.close();
      this.lightHost = null;
      this.patch({ conn: 'closed', engineKind: null });
      this.fail(err);
    }
  }

  private closeEngines(): void {
    this.client?.close();
    this.client = null;
    this.lightHost?.close();
    this.lightHost = null;
  }

  /** 连线之后的共同部分：远程宿主和轻引擎都走这里 */
  private async attach(client: EngineTransport, kind: 'remote' | 'light'): Promise<void> {
    this.client = client;
    this.patch({ engineKind: kind });

    client.onStateChange((conn, connDetail) => {
      this.patch({ conn, connDetail });
    });

    client.onAny((event) => this.applyEvent(event.event, event.data));

    try {
      const caps = await client.connect();
      this.patch({
        caps,
        conn: 'connected',
        connectModalOpen: false,
        error: null,
        draftPresetId: this.state.draftPresetId ?? caps.presets[0]?.id ?? null,
      });
      await this.refreshSessions();
      void ensureNotificationPermission();
      // 连上就把模型/权限/工作区拉到本地：头部徽标和新会话要立刻可用
      void this.refreshModels();
      void this.refreshPermissions();
      void this.refreshWorkspaces();
      void this.refreshAccount();
      void this.refreshProviders();
      if (this.pendingNotificationSessionId) {
        const navId = this.pendingNotificationSessionId;
        this.pendingNotificationSessionId = null;
        this.patch({ view: 'main', connectModalOpen: false });
        void this.openSession(navId);
      } else if (this.state.currentId) {
        // 如果用户在引擎连接前已经点开了某个缓存会话，连上后自动刷新它的详情
        void this.openSession(this.state.currentId);
      }
    } catch (err) {
      this.patch({ conn: 'closed' });
      this.fail(err);
    }
  }

  disconnect(): void {
    this.closeEngines();
    this.client?.close();
    this.client = null;
    this.patch({
      conn: 'closed',
      caps: hostAvailable ? LOCAL_DEFAULT_CAPS : null,
      detail: null,
      currentId: null,
      account: null,
      engineKind: null,
      connectModalOpen: true,
    });
  }

  /* ------------------------------------------------------------ */

  async refreshSessions(): Promise<void> {
    if (!this.client) return;
    try {
      const { sessions } = await this.client.request('sessions.list', {});
      let detail = this.state.detail;
      const current = sessions.find((s) => s.id === this.state.currentId);
      if (detail && current) {
        detail = { ...detail, ...current };
        const last = detail.turns[detail.turns.length - 1];
        if (
          current.status !== 'running' &&
          current.status !== 'waiting_approval' &&
          last?.role === 'assistant' &&
          last.status === 'streaming' &&
          current.updatedAt >= last.createdAt
        ) {
          detail = { ...finalizeDetailTurn(detail, current.updatedAt), status: 'idle' };
        }
      }
      this.patch({ sessions, ...(detail ? { detail } : {}) });
      this.persistUiCache();
    } catch (err) {
      this.fail(err);
    }
  }

  async openSession(id: string): Promise<void> {
    if (!this.client) return;
    this.patch({ busy: true, error: null });
    try {
      const { session } = await this.client.request('sessions.get', { sessionId: id });
      const cached = this.detailCache.get(id);
      this.detailCache.delete(id);
      let turns = session.turns;
      const active = session.status === 'running' || session.status === 'waiting_approval';
      const live = active
        ? cached?.turns.find((t) => t.role === 'assistant' && t.status === 'streaming')
        : undefined;
      if (live) {
        // 宿主快照里可能只有落盘的部分回合；同一 id 用缓存里的 live 回合，别画两份
        let same = -1;
        for (let i = turns.length - 1; i >= 0; i--) {
          const t = turns[i]!;
          if (t.role !== 'assistant') continue;
          if (
            t.id === live.id ||
            (live.runId && t.runId === live.runId) ||
            t.status === 'streaming' ||
            sharesBlock(t, live)
          ) {
            same = i;
            break;
          }
        }
        if (same >= 0) {
          turns = turns.slice();
          turns[same] = mergeTurn(turns[same]!, live);
        } else {
          // 快照里如果只有一个不等 id 的部分回合，宁可多一条也不要跨 run 合并
          turns = [...turns, live];
        }
      }
      turns = turns.reduce<Turn[]>((acc, t) => mergeNearbyTurns(acc, t), []);
      this.patch({ detail: { ...session, turns }, currentId: id, busy: false });      // 重新打开会话时把还没回答的提问捞回来（真引擎那边由桥维护）
      const { approvals } = await this.client.request('approvals.list', { sessionId: id });
      const map: Record<string, Approval> = {};
      for (const a of approvals) {
        if (a.sessionId === id) map[a.id] = a;
      }
      this.patch({ approvals: map });
    } catch (err) {
      this.fail(err);
    }
  }

  closeSession(): void {
    const { detail, currentId } = this.state;
    if (detail && currentId) this.detailCache.set(currentId, detail);
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

  /* ------------------------ 分享进来的内容 ------------------------ */

  /** 冷启动时读一次「分享到锦囊」；没有就什么都不做 */
  async consumeInitialShare(): Promise<void> {
    const share = await getInitialShare();
    if (!share) return;
    if (!share.text && !share.path) return;
    this.patch({
      pendingShare: {
        ...(share.text ? { text: share.text } : {}),
        ...(share.path ? { imagePath: share.path } : {}),
        ...(share.name ? { imageName: share.name } : {}),
      },
    });
  }

  /** 首页取走分享来的文字（取完清掉，只填一次输入框） */
  takeShareText(): string | null {
    const text = this.state.pendingShare?.text;
    if (!text) return null;
    const { text: _drop, ...rest } = this.state.pendingShare ?? {};
    this.patch({ pendingShare: Object.keys(rest).length > 0 ? rest : null });
    return text;
  }

  /** 当前会话里把分享来的图片传上去 */
  async attachSharedImage(): Promise<void> {
    const share = this.state.pendingShare;
    if (!share?.imagePath || !this.state.currentId || !this.client) return;
    const base64 = await readFileBase64(share.imagePath);
    if (!base64) return;
    await this.uploadAttachment(base64, share.imageName ?? 'share');
    this.patch({ pendingShare: share.text ? { text: share.text } : null });
  }

  /* ------------------------ 模型提供商 ------------------------ */

  async refreshProviders(): Promise<void> {
    if (!this.client) return;
    try {
      const { providers } = await this.client.request('providers.list', {});
      if (JSON.stringify(providers) !== JSON.stringify(this.state.providers)) this.patch({ providers });
    } catch {
      if (this.state.providers.length > 0) this.patch({ providers: [] });
    }
  }

  /** 用 Base URL + Key 去服务商拉模型；失败抛错给对话框显示 */
  async discoverProviderModels(input: {
    baseURL: string;
    api: ProviderProtocol;
    apiKey?: string;
  }): Promise<ProviderModel[]> {
    if (!this.client) throw new Error('还没连上宿主');
    const { models } = await this.client.request('providers.discover', input);
    return models;
  }

  async saveProvider(input: RequestParams['providers.save']): Promise<void> {
    if (!this.client) return;
    const { providers } = await this.client.request('providers.save', input);
    this.patch({ providers });
    // 新渠道的模型要能马上出现在会话的模型选择里
    void this.refreshModels();
  }

  async refreshProviderCatalog(): Promise<void> {
    if (!this.client) return;
    try {
      const { providers } = await this.client.request('providers.catalog', {});
      if (JSON.stringify(providers) !== JSON.stringify(this.state.providerCatalog)) {
        this.patch({ providerCatalog: providers });
      }
    } catch {
      /* 老宿主没有这个接口就当没有目录 */
    }
  }

  async removeProvider(id: string): Promise<void> {
    if (!this.client) return;
    try {
      const { providers } = await this.client.request('providers.remove', { id });
      this.patch({ providers });
      void this.refreshModels();
    } catch (err) {
      this.fail(err);
    }
  }

  /* ------------------------ 账号登录 ------------------------ */

  /** 读一次账号状态；老宿主没有这个方法时不打扰用户 */
  async refreshAccount(): Promise<void> {
    if (!this.client) return;
    try {
      const { account } = await this.client.request('account.state', {});
      // 轮询期间状态没变就别触发重渲染
      if (JSON.stringify(account) === JSON.stringify(this.state.account)) return;
      this.applyAccount(account);
    } catch {
      if (this.state.account !== null) this.patch({ account: null });
    }
  }

  /**
   * 开始浏览器登录。
   *
   * 回调地址由宿主决定（本机模式下就是引擎自己的 loopback），
   * 这里只负责把宿主给的 authorizeUrl 交给系统浏览器。
   */
  async startAccountSignIn(): Promise<void> {
    if (!this.client) return;
    this.pendingSignIn = true;
    this.openedAttemptId = null;
    this.patch({ busy: true, error: null });
    try {
      const { account } = await this.client.request('account.signIn', {});
      this.applyAccount(account);
    } catch (err) {
      this.fail(err);
    } finally {
      this.patch({ busy: false });
    }
  }

  /** 手动重开当前这次的授权页（浏览器被关掉时用） */
  openAccountAuthPage(): void {
    const attempt = this.state.account?.attempt;
    if (attempt?.authorizeUrl) void openUrl(attempt.authorizeUrl);
  }

  async cancelAccountSignIn(): Promise<void> {
    const attempt = this.state.account?.attempt;
    this.pendingSignIn = false;
    if (!this.client || !attempt) return;
    try {
      const { account } = await this.client.request('account.cancelSignIn', { attemptId: attempt.id });
      this.applyAccount(account);
    } catch (err) {
      this.fail(err);
    }
  }

  async signOutAccount(): Promise<void> {
    if (!this.client) return;
    try {
      const { account } = await this.client.request('account.signOut', {});
      this.applyAccount(account);
    } catch (err) {
      this.fail(err);
    }
  }

  /** 账号状态落地 + waiting-browser 时把授权页交给浏览器（每次尝试只开一次） */
  private applyAccount(account: AccountState): void {
    const wasSignedIn = this.state.account?.status === 'credential-stored';
    if (account.status === 'credential-stored') this.pendingSignIn = false;
    this.patch({ account });
    // 登录状态一变，宿主上的模型目录也会变（多/少 deepseek-account 渠道），立刻刷新
    const isSignedIn = account.status === 'credential-stored';
    if (wasSignedIn !== isSignedIn) {
      void this.refreshModels();
      void this.refreshCredentials();
    }
    const attempt = account.attempt;
    if (attempt?.phase !== 'waiting-browser' || !attempt.authorizeUrl) return;
    // 不是本机发起的、已经过期的尝试，一律不自动开浏览器 —— 那只会给用户一个"授权失败"
    if (!this.pendingSignIn) return;
    if (typeof attempt.expiresAt === 'number' && attempt.expiresAt <= Date.now()) return;
    if (this.openedAttemptId === attempt.id) return;
    this.openedAttemptId = attempt.id;
    this.pendingSignIn = false;
    void openUrl(attempt.authorizeUrl);
  }

  setDraftPreset(presetId: string): void {
    this.patch({ draftPresetId: presetId });
  }

  /**
   * 首页输入框直接开聊：用当前选中的锦囊建会话，再把这句话（及暂存附件）发出去。
   * 标题先取这句话的前 18 个字（如果没打字只发了附件，取首个附件文件名），之后可以再让模型改。
   */
  async startWith(text: string): Promise<void> {
    const trimmed = text.trim();
    const hasAttachments = this.state.pendingAttachments.length > 0 || Boolean(this.state.pendingShare?.imagePath);
    if (!trimmed && !hasAttachments) return;
    if (!this.client || this.state.conn !== 'connected') {
      this.setError('引擎正在唤醒中，请稍候片刻再发送');
      return;
    }
    const presetId = this.state.draftPresetId ?? this.state.caps?.presets[0]?.id ?? 'standard';
    const draftModel = this.state.defaultModel;
    const draftPermission = this.state.defaultPermission;
    const rawTitle = trimmed || this.state.pendingAttachments[0]?.name || '新会话';
    this.patch({ busy: true, error: null });
    try {
      const { session } = await this.client.request('sessions.create', {
        presetId,
        title: rawTitle.length > 18 ? `${rawTitle.slice(0, 18)}…` : rawTitle,
      });
      await this.openSession(session.id);
      // 首页选的模型/权限带进新会话
      if (draftPermission) await this.setPermission(draftPermission);
      if (draftModel) await this.setModel(draftModel.provider, draftModel.model, draftModel.reasoningEffort);
      if (this.state.pendingShare?.imagePath) await this.attachSharedImage();
      await this.send(trimmed);
    } catch (err) {
      this.fail(err);
    }
  }

  async send(text: string): Promise<void> {
    const { currentId, detail } = this.state;
    const trimmed = text.trim();
    const stagedList = this.state.pendingAttachments.slice();
    if (!this.client || !currentId || !detail || (!trimmed && stagedList.length === 0)) return;
    if (stagedList.some((a) => a.uploading)) {
      this.setError('附件还在上传中，请稍候…');
      return;
    }
    const running = detail.status === 'running' || detail.status === 'waiting_approval';
    this.patch({ busy: true, error: null, pendingAttachments: [] });
    try {
      const receiptIds: string[] = [];
      for (const item of stagedList) {
        if (item.base64) {
          const uploaded = await this.client.request('attachments.upload', {
            sessionId: currentId,
            data: item.base64,
            name: item.name,
          });
          receiptIds.push(uploaded.receiptId);
        } else if (item.receiptId && !item.receiptId.startsWith('staged-')) {
          receiptIds.push(item.receiptId);
        }
      }

      const payload = {
        sessionId: currentId,
        text: trimmed,
        ...(receiptIds.length > 0 ? { attachments: receiptIds } : {}),
      };
      if (running) await this.client.request('sessions.steer', payload);
      else await this.client.request('sessions.send', payload);
      // 提交成功后立刻置为 running：停止按钮要马上出现，
      // 下一条消息也要走 steer（插话）而不是再排一个回合。
      const { detail: latest } = this.state;
      if (latest) this.patch({ busy: false, detail: { ...latest, status: 'running' } });
      else this.patch({ busy: false });
    } catch (err) {
      // 发送失败时把附件放回待发列表，避免用户重选
      this.patch({ pendingAttachments: stagedList });
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

  /* ------------------------ 会话管理 ------------------------ */

  async renameSession(id: string, title: string): Promise<void> {
    if (!this.client) return;
    try {
      const { session } = await this.client.request('sessions.rename', { sessionId: id, title });
      const sessions = this.state.sessions.map((s) => (s.id === id ? { ...s, title: session.title } : s));
      const patch: Partial<AppState> = { sessions };
      if (this.state.detail?.id === id) patch.detail = session;
      this.patch(patch);
    } catch (err) {
      this.fail(err);
    }
  }

  async setSessionPinned(id: string, pinned: boolean): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.request('sessions.pin', { sessionId: id, pinned });
      await this.refreshSessions();
    } catch (err) {
      this.fail(err);
    }
  }

  async archiveSession(id: string, archived: boolean): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.request('sessions.archive', { sessionId: id, archived });
      if (archived && this.state.currentId === id) this.closeSession();
      await this.refreshSessions();
    } catch (err) {
      this.fail(err);
    }
  }

  async setPreset(presetId: string): Promise<void> {
    const { currentId, caps } = this.state;
    if (!this.client || !currentId) return;
    // 宿主没声明 switch_preset 就别发——真 dsh 没有会话内换预设的接口
    if (caps && !caps.actions.includes('switch_preset')) {
      this.setError('这个宿主不支持会话内换预设；想换工作方式，新建一个会话时选。');
      return;
    }
    try {
      const { session } = await this.client.request('sessions.setPreset', { sessionId: currentId, presetId });
      this.patch({ detail: session });
    } catch (err) {
      this.fail(err);
    }
  }

  /* ---------------------------- 模型 ---------------------------- */

  /**
   * 上传或暂存一个附件，成功后挂进待发送列表。
   * - 在会话详情页（有 currentId 且已连上）：立即调 attachments.upload 拿回执；
   * - 在首页列表页（还没建会话）：先暂存在内存 pendingAttachments 里，点发送建会话后自动上传。
   */
  async uploadAttachment(base64: string, name: string, kind: AttachmentKind = 'file'): Promise<void> {
    const { currentId } = this.state;
    if (!currentId || !this.client || this.state.conn !== 'connected') {
      const stagedId = `staged-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      this.patch({
        error: null,
        pendingAttachments: [...this.state.pendingAttachments, { receiptId: stagedId, name, kind, base64 }],
      });
      return;
    }

    const tempId = `uploading-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.patch({
      error: null,
      pendingAttachments: [...this.state.pendingAttachments, { receiptId: tempId, name, kind, uploading: true }],
    });
    try {
      const res = await this.client.request('attachments.upload', { sessionId: currentId, data: base64, name });
      this.patch({
        pendingAttachments: this.state.pendingAttachments.map((a) =>
          a.receiptId === tempId ? { receiptId: res.receiptId, name: res.name ?? name, kind, uploading: false } : a,
        ),
      });
    } catch (err) {
      this.patch({
        pendingAttachments: this.state.pendingAttachments.filter((a) => a.receiptId !== tempId),
      });
      this.fail(err);
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
      // 缓存里可能是旧宿主的模型 id（例如 flash）；不在列表里就回退到宿主默认
      const current = this.state.defaultModel;
      const valid =
        current && models.some((m) => m.provider === current.provider && m.id === current.model);
      this.patch({ models, ...(valid ? {} : { defaultModel: fallback }) });
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

  /** 切当前会话的权限（沙箱 + 审批策略一起换）；还没开会话时记成默认 */
  async setPermission(preset: string): Promise<void> {
    const { currentId } = this.state;
    if (!this.client) return;
    if (!currentId) {
      this.patch({ defaultPermission: preset });
      return;
    }
    try {
      const { session } = await this.client.request('sessions.setPermission', { sessionId: currentId, preset });
      this.patch({ detail: session });
    } catch (err) {
      this.fail(err);
    }
  }

  /** 切当前会话的模型；还没开会话时记成默认，发第一条消息时带进新会话 */
  async setModel(provider: string, model: string, reasoningEffort?: string): Promise<void> {
    const { currentId } = this.state;
    if (!this.client) return;
    if (!currentId) {
      this.patch({
        defaultModel: { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) },
        modelSheetOpen: false,
      });
      return;
    }
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
    const sessionStatus = this.state.detail?.status;
    if (sessionStatus && sessionStatus !== 'running' && sessionStatus !== 'waiting_approval') {
      const next = { ...this.state.approvals };
      delete next[approvalId];
      this.patch({ approvals: next });
      this.setError('这一轮已经结束，审批卡已失效；重新发一条消息继续。');
      return;
    }
    try {
      await this.client.request('approvals.resolve', { approvalId, decision });
      const next = { ...this.state.approvals };
      delete next[approvalId];
      this.patch({ approvals: next });
    } catch (err) {
      // 卡片先撤掉，别让用户对着一个已经失效的审批反复点
      const next = { ...this.state.approvals };
      delete next[approvalId];
      this.patch({ approvals: next });
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
    const sessionStatus = this.state.detail?.status;
    if (sessionStatus && sessionStatus !== 'running' && sessionStatus !== 'waiting_approval') {
      const next = { ...this.state.approvals };
      delete next[callId];
      this.patch({ approvals: next });
      this.setError('这一轮已经结束，选择卡已失效；重新发一条消息继续。');
      return;
    }
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
      const next = { ...this.state.approvals };
      delete next[callId];
      this.patch({ approvals: next });
      this.fail(err);
    }
  }

  /* ------------------------ 本机引擎 ------------------------ */

  /** 拉一次宿主服务状态（设置页每 2 秒调一次） */
  async refreshHost(): Promise<void> {
    if (!hostAvailable) return;
    const status = await hostStatus();
    if (!status) return;
    const nextPatch: Partial<AppState> = {};
    if (JSON.stringify(status) !== JSON.stringify(this.state.host)) nextPatch.host = status;
    if (status.pairCode && status.pairCode !== this.state.pairCode) nextPatch.pairCode = status.pairCode;
    if (Object.keys(nextPatch).length > 0) this.patch(nextPatch);
  }

  private lastAutoConnectAt = 0;

  /**
   * 本机模式的一键连接。
   *
   * 引擎和桥都是 App 自己拉起来的：地址是本机 127.0.0.1，配对码由 HostRuntime 常驻保存（或存了 deviceKey）。
   * 桥 ready 后自动连接，若中途断线也会按节流自动重连。
   */
  async maybeAutoConnect(): Promise<void> {
    if (!hostAvailable) return;
    const host = this.state.host;
    if (!host || host.engine !== 'ready' || host.bridge !== 'ready') return;
    if (this.state.conn === 'connected' || this.state.conn === 'connecting') return;
    const now = Date.now();
    if (now - this.lastAutoConnectAt < 2000) return;
    this.lastAutoConnectAt = now;

    if (host.pairCode && !this.state.pairCode.trim()) {
      this.patch({ pairCode: host.pairCode });
    } else if (!this.state.deviceKey && !this.state.pairCode.trim()) {
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
    await this.hydrateLocalCache();
    void ensureNotificationPermission();
    await startHost({
      engineCmd: this.state.hostEngineCmd.trim() || undefined,
      bridgeCmd: this.state.hostBridgeCmd.trim() || undefined,
    });
    await this.refreshHost();
    await this.maybeAutoConnect();
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

  /** App 不在前台时才发系统通知：在看着界面就别打扰 */
  private notifyApproval(approval: Approval): void {
    if (isAppActive()) return;
    if (this.notifiedApprovals.has(approval.id)) return;
    this.notifiedApprovals.add(approval.id);
    const title = approval.kind === 'question' ? '有个问题等你回答' : '需要你确认操作';
    const body = approval.summary ? `${approval.title}：${approval.summary}` : approval.title;
    void notifyEvent(title, body, `approval:${approval.sessionId}:${approval.id}`);
  }

  private notifyRunFinished(data: { sessionId: string; reason: string; preview?: string; error?: string }): void {
    if (isAppActive()) return;
    if (data.reason === 'stopped') return;
    const session =
      this.state.sessions.find((s) => s.id === data.sessionId) ??
      (this.state.detail?.id === data.sessionId ? this.state.detail : undefined);
    const sessionTitle = session?.title ?? '会话';
    if (data.reason === 'error') {
      void notifyEvent(
        `会话出错 · ${sessionTitle}`,
        data.error || '执行过程中遇到错误，点击查看详情',
        `run:${data.sessionId}`,
      );
      return;
    }
    void notifyEvent(
      `回复完成 · ${sessionTitle}`,
      data.preview || '已完成本轮回复，点击查看',
      `run:${data.sessionId}`,
    );
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
        if (detail && detail.id === session.id) {
          let nextDetail = { ...detail, ...session };
          if (session.status !== 'running' && session.status !== 'waiting_approval') {
            nextDetail = finalizeDetailTurn(nextDetail, session.updatedAt);
          }
          patch.detail = nextDetail;
        }
        this.patch(patch);
        this.persistUiCache();
        return;
      }

      case 'block.appended': {
        if (!detail || data.sessionId !== currentId) return;
        const raw = data.turn as Turn;
        const blocks: Turn['blocks'] = [];
        for (const b of raw.blocks) {
          if (!blocks.some((x) => sameBlock(x, b))) blocks.push(b);
        }
        const turn: Turn = { ...raw, blocks };
        const turns = mergeNearbyTurns(detail.turns, turn);
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
        if (data.op === 'replace') {
          block.text = data.text;
          this.pendingDelta.delete(data.blockId);
          this.patch({});
          return;
        }
        this.pendingDelta.set(
          data.blockId,
          (this.pendingDelta.get(data.blockId) ?? '') + data.text
        );
        this.scheduleDeltaFlush();
        return;
      }

      case 'block.updated': {
        if (!detail || data.sessionId !== currentId) return;
        const turn = detail.turns.find((t) => t.id === data.turnId);
        if (!turn) return;
        const i = turn.blocks.findIndex((b) => b.id === (data.block as Block).id);
        if (i >= 0) {
          const incoming = data.block as Block;
          turn.blocks[i] =
            incoming.kind === 'text' || incoming.kind === 'thinking'
              ? { ...incoming, done: true }
              : incoming;
        }
        this.patch({});
        return;
      }

      case 'approval.requested': {
        const approval = data.approval as Approval;
        this.notifyApproval(approval);
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
        this.patch({
          approvals: nextApprovals,
          detail: { ...d, turns, status: 'waiting_approval' as const },
        });
        return;
      }

      case 'approval.resolved': {
        const next = { ...this.state.approvals };
        delete next[data.approvalId as string];
        const d = this.state.detail;
        this.patch({
          approvals: next,
          ...(d && Object.keys(next).length === 0 ? { detail: { ...d, status: 'running' as const } } : {}),
        });
        return;
      }

      case 'account.updated': {
        const account = (data as { account?: AccountState }).account;
        if (account) this.applyAccount(account);
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
        // 回合开始：界面要变成"生成中"，发送键变成停止键，列表也立刻变运行中
        this.runStartedAt = Date.now();
        const d = this.state.detail;
        const sessions = this.state.sessions.map((s) =>
          s.id === data.sessionId ? { ...s, status: 'running' as const, updatedAt: Date.now() } : s
        );
        this.patch({ sessions, ...(d && data.sessionId === currentId ? { detail: { ...d, status: 'running' }, busy: true } : {}) });
        return;
      }

      case 'run.finished': {
        this.flushDeltas();
        const d = this.state.detail;
        this.notifyRunFinished(data as { sessionId: string; reason: string });
        const runId = (data as { runId?: string }).runId;
        const approvals = { ...this.state.approvals };
        for (const [id, a] of Object.entries(approvals)) {
          if (!runId || a.runId === runId) delete approvals[id];
        }
        const durationMs = this.runStartedAt ? Math.max(1, Date.now() - this.runStartedAt) : null;
        this.runStartedAt = null;
        const reason = (data as { reason?: string }).reason;
        const finalStatus: Turn['status'] =
          reason === 'stopped' ? 'stopped' : reason === 'error' ? 'error' : 'done';
        let nextDetail = d;
        if (d && data.sessionId === currentId) {
          let turns = d.turns;
          for (let i = turns.length - 1; i >= 0; i--) {
            const t = turns[i]!;
            if (t.role !== 'assistant') continue;
            const needsStatus = t.status !== finalStatus;
            const needsDuration = durationMs !== null && !t.meta?.durationMs;
            if (needsStatus || needsDuration) {
              turns = turns.slice();
              turns[i] = {
                ...t,
                status: finalStatus,
                meta: {
                  ...t.meta,
                  ...(needsDuration && durationMs !== null
                    ? { durationMs, steps: t.meta?.steps ?? t.blocks.length }
                    : {}),
                },
              };
            }
            break;
          }
          nextDetail = { ...d, turns, status: 'idle' };
        }
        const sessions = this.state.sessions.map((s) =>
          s.id === data.sessionId ? { ...s, status: 'idle' as const, updatedAt: Date.now() } : s
        );
        this.patch({
          approvals,
          sessions,
          busy: false,
          ...(nextDetail ? { detail: nextDetail } : {}),
        });
        return;
      }

      default:
        return;
    }
  }
}

export const store = new Store();
