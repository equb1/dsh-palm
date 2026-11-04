import { EngineClient, type ConnectionState, type EngineTransport } from '../lib/client';
import { clearDeviceKey, loadDeviceKey, saveDeviceKey } from '../lib/deviceKey';
import {
  deviceConditions as hostDeviceConditions,
  getInitialNotificationSession,
  hostAvailable,
  hostLogs,
  hostStatus,
  readHostUiCache,
  setHostRunActive as setNativeHostRunActive,
  startHost,
  stopHost,
  writeHostUiCache,
  type DeviceConditions,
  type HostStatus,
} from '../lib/host';
import { loadHostCommands, saveHostCommands } from '../lib/hostCmd';
import { humanizeError } from '../lib/errors';
import { createLightHost, loadLightConfig, saveLightConfig, type LightEngineSetup } from '../lib/light';
import {
  canSwitch,
  IDLE_RECLAIM_MS,
  IDLE_SWEEP_MS,
  initialEngineState,
  PROOT_BOOT_TIMEOUT_MS,
  reduceEngine,
  type EngineEffect,
  type EngineEvent,
  type EngineLink,
  type EngineSnapshot,
  type EngineTarget,
  type PrewarmTier,
} from './engineManager';
import { LocalEngineClient } from '../engine/light/localClient';
import type { LightHost } from '../engine/light/host';
import { ensureNotificationPermission, notifyEvent } from '../lib/notify';
import { isAppActive, openUrl } from '../lib/platform';
import {
  intakeFiles,
  intakeImagePicker,
  intakeShare,
  pickAttachments,
} from '../lib/attachments/intake';
import { classify, hashPrefix } from '../lib/attachments/classify';
import type { AttachmentEngine, AttachmentKind, IntakeSource } from '../lib/attachments/types';
import type {
  AccountState,
  Approval,
  CatalogProvider,
  FileRef,
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
import {
  findRunTurnIndex,
  overlayLiveTurn,
  mergeNearbyTurns,
  normalizeTurns,
  sameBlock,
} from '../protocol/turns';

/**
 * 待发附件：原生收件落盘后的路径引用 + 分类结果。
 * 1.3 起没有整文件编码 / 回执 id，发消息时直接把 `files: FileRef[]` 交给引擎。
 */
export interface PendingAttachment extends FileRef {
  /** `<hash16>:<name>`，去重键也是 React key */
  id: string;
  kind: AttachmentKind;
  engine: AttachmentEngine;
  /** 只保存路径、不解析内容（PDF / 旧 Office / 音视频 / 未知格式） */
  saveOnly: boolean;
  /** chip 下面那行提示（PDF 暂不解析 / 超过 20MB 只按路径） */
  hint?: string;
  /** 收件中不可发送；1.3 的收件在 append 前就完成，正常都是 ready */
  status: 'ready' | 'reading';
}

/** `+` 面板各类附件的系统选择器 MIME */
const ATTACH_MIME: Record<AttachmentKind, string> = {
  image: 'image/*',
  document: 'application/*',
  file: '*/*',
  video: 'video/*',
  audio: 'audio/*',
};

/** PendingAttachment → 协议里的 FileRef（只发引擎需要的字段） */
function toFileRef(item: PendingAttachment): FileRef {
  return {
    path: item.path,
    relPath: item.relPath,
    name: item.name,
    ...(item.displayName ? { displayName: item.displayName } : {}),
    ...(item.mime ? { mime: item.mime } : {}),
    ...(typeof item.bytes === 'number' ? { bytes: item.bytes } : {}),
    ...(item.hash ? { hash: item.hash } : {}),
  };
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
  /** 从系统分享菜单进来的文字（冷启动/回前台读一次；文件已落 uploads 直接进 pendingAttachments） */
  pendingShare: { text?: string } | null;
  /** 原生收件进行中（读取大文件时禁用发送） */
  attaching: boolean;
  /** 本机引擎（原生宿主服务）的状态；null 表示这台设备不支持 */
  host: HostStatus | null;
  /** 本机引擎最近日志 */
  hostLogs: string[];
  /** 覆盖用的启动命令（空 = 用 Kotlin 里的默认值） */
  hostEngineCmd: string;
  hostBridgeCmd: string;
  /** 当前连的是哪种引擎：远程宿主 / 本机轻引擎 */
  engineKind: 'remote' | 'light' | null;
  /** EngineManager 快照：默认轻引擎，完整引擎按需切换 */
  engine: EngineSnapshot;
  /** 预热档位：触发式（默认）/ 智能 / 常备，持久化在 ui-cache */
  prewarmTier: PrewarmTier;
  /** 轻引擎配置页是否打开（HomeScreen 的「配置轻引擎」入口） */
  lightSetupOpen: boolean;
}

/**
 * 默认连哪儿。
 *
 * 这台设备自己能起引擎（原生构建）时，桥就在本机 8788——开机即用的那条路；
 * Expo Go / web 没有本机宿主，退回电脑上跑桥的局域网地址。
 */
const DEFAULT_URL = hostAvailable ? 'ws://127.0.0.1:8788/ws' : 'ws://192.168.1.3:8788/ws';

/** 完整引擎（proot）固定连本机桥，不能用最近一次远程地址 */
const LOCAL_WS_URL = 'ws://127.0.0.1:8788/ws';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 给 WebSocket 连接加超时：127.0.0.1 上没进程时 RN/Node 的 onclose 不一定会来 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const PROOT_CONNECT_TIMEOUT_MS = 20_000;

type Listener = () => void;

/**
 * EngineManager 的副作用依赖。
 * 默认全部用真实现；单测/特殊宿主可以注入假实现（可选）。
 */
export interface EngineDeps {
  hostAvailable: boolean;
  hostStatus: () => Promise<HostStatus | null>;
  startHost: (options?: { engineCmd?: string; bridgeCmd?: string; port?: number }) => Promise<boolean>;
  stopHost: () => Promise<boolean>;
  deviceConditions: () => Promise<DeviceConditions | null>;
  setRunActive: (active: boolean) => void | Promise<unknown>;
  loadLightConfig: () => Promise<LightEngineSetup | null>;
  now: () => number;
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
  /** 流式增量在当前 JS 事件栈结束后立即提交；同一 tick 内的多个 token 才合并 */
  private pendingDelta = new Map<string, string[]>();
  private deltaScheduled = false;
  /** 客户端兜底计时：宿主没带 durationMs 时，run.started 到 run.finished 的耗时 */
  private runStartedAt: number | null = null;
  /** 退出会话时留住 detail，重进时把 live 回合并回去，避免 history + live 两份 */
  private detailCache = new Map<string, SessionDetail>();
  /** 列表 preview 限流，避免每 token 都重建 sessions */
  private lastSessionPreviewAt = 0;

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
    attaching: false,
    host: null,
    hostLogs: [],
    hostEngineCmd: '',
    hostBridgeCmd: '',
    modelSheetOpen: false,
    engineKind: null,
    engine: initialEngineState,
    prewarmTier: initialEngineState.tier,
    lightSetupOpen: false,
  };

  private readonly engineDeps: EngineDeps;

  constructor(engineDeps: Partial<EngineDeps> = {}) {
    this.engineDeps = {
      hostAvailable,
      hostStatus,
      startHost,
      stopHost,
      deviceConditions: hostDeviceConditions,
      setRunActive: setNativeHostRunActive,
      loadLightConfig,
      now: () => Date.now(),
      ...engineDeps,
    };
  }

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

  /* ------------------------ EngineManager 内部状态 ------------------------ */
  private engineStarted = false;
  /** 同一时刻只跑一次 warm；切换/智能预热都走它 */
  private warming: Promise<boolean> | null = null;
  /** 同一时刻只跑一次完整引擎握手（状态轮询和 warm 循环可能同时触发） */
  private connectingLocal: Promise<boolean> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private statusPolling = false;
  private hostDeadTicks = 0;
  /** attach 时不要自动打开旧会话（切换引擎后旧会话只读） */
  private suppressAutoOpen = false;
  /** 最近一次轻引擎配置；没配置时是 null，界面给「配置轻引擎」入口 */
  private lightSetup: LightEngineSetup | null = null;

  /* ------------------------------------------------------------ */

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): AppState => this.state;

  private now(): number {
    return this.engineDeps.now();
  }

  /**
   * 所有状态修改都从这里走：顺便把 busy / 待审批数量同步进 engine 快照，
   * 这样切换守卫永远看到一致的数据。
   */
  private patch(next: Partial<AppState>): void {
    const merged: AppState = { ...this.state, ...next };
    const sync = reduceEngine(merged.engine, {
      type: 'SET_BUSY',
      busy: merged.busy,
      pendingApprovals: Object.keys(merged.approvals).length,
      now: this.now(),
    });
    if (sync.state !== merged.engine) merged.engine = sync.state;
    this.state = { ...merged, version: this.state.version + 1 };
    for (const fn of this.listeners) fn();
  }

  /** 交给 reducer 决定，再把 effects 交给调用方按顺序执行 */
  private emitEngine(event: EngineEvent): EngineEffect[] {
    const step = reduceEngine(this.state.engine, event);
    const next: Partial<AppState> = {};
    if (step.state !== this.state.engine) {
      next.engine = step.state;
      next.prewarmTier = step.state.tier;
    }
    // 宿主状态同时镜像到 AppState.host / pairCode（LaunchOverlay / Settings / 配对都要用）
    if (event.type === 'HOST_STATUS') {
      next.host = event.host;
      if (event.host.pairCode && event.host.pairCode !== this.state.pairCode) {
        next.pairCode = event.host.pairCode;
      }
    }
    if (Object.keys(next).length > 0) this.patch(next);
    this.ensureStatusWatcher();
    return step.effects;
  }

  private async runEngineEffects(effects: EngineEffect[]): Promise<void> {
    for (const effect of effects) {
      switch (effect) {
        case 'connect-light':
          await this.connectLightEffect();
          break;
        case 'warm-host':
          await this.warmLocalHost();
          break;
        case 'connect-proot':
          await this.connectLocal();
          break;
        case 'stop-host':
          await this.stopHostEffect();
          break;
        case 'report':
          break;
      }
    }
  }

  private scheduleDeltaFlush(): void {
    if (this.deltaScheduled) return;
    this.deltaScheduled = true;
    const run = (): void => {
      this.deltaScheduled = false;
      this.flushDeltas();
    };
    // 官方 DSH 的实时 delta/推理是按帧合并的；一帧内到达的 token 一次提交
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  /**
   * 把攒下的流式增量一次性拼进 block。
   * 只替换活跃 turn/block 的引用，历史块保持原引用供 React.memo 跳过。
   */
  private flushDeltas(): void {
    if (this.pendingDelta.size === 0) return;
    const pending = this.pendingDelta;
    this.pendingDelta = new Map();
    const detail = this.state.detail;
    if (!detail) return;

    let turns = detail.turns;
    let activeIndex = -1;
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i]!;
      if (t.role === 'assistant' && t.status === 'streaming') {
        activeIndex = i;
        break;
      }
    }
    if (activeIndex < 0) {
      for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i]!.role === 'assistant') {
          activeIndex = i;
          break;
        }
      }
    }

    // 先只处理活跃回合：流式热路径不再扫全部历史 block
    if (activeIndex >= 0) {
      const turn = turns[activeIndex]!;
      let blocks = turn.blocks;
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        const block = blocks[blockIndex]!;
        const chunks = pending.get(block.id);
        if (!chunks || chunks.length === 0) continue;
        if (block.kind !== 'text' && block.kind !== 'thinking') continue;
        let text = block.text + chunks.join('');
        if (block.kind === 'thinking' && text.length > 24000) {
          text = '…' + text.slice(-24000);
        }
        if (blocks === turn.blocks) blocks = turn.blocks.slice();
        blocks[blockIndex] = { ...block, text };
        pending.delete(block.id);
      }
      if (blocks !== turn.blocks) {
        turns = turns.slice();
        turns[activeIndex] = { ...turn, blocks };
      }
    }

    // 迟到/跨回合的 delta 才回退到全表扫描
    if (pending.size > 0) {
      for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
        if (turnIndex === activeIndex) continue;
        const turn = turns[turnIndex]!;
        let blocks = turn.blocks;
        for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
          const block = blocks[blockIndex]!;
          const chunks = pending.get(block.id);
          if (!chunks || chunks.length === 0) continue;
          if (block.kind !== 'text' && block.kind !== 'thinking') continue;
          let text = block.text + chunks.join('');
          if (block.kind === 'thinking' && text.length > 24000) {
            text = '…' + text.slice(-24000);
          }
          if (blocks === turn.blocks) blocks = turn.blocks.slice();
          blocks[blockIndex] = { ...block, text };
        }
        if (blocks !== turn.blocks) {
          if (turns === detail.turns) turns = detail.turns.slice();
          turns[turnIndex] = { ...turn, blocks };
        }
      }
      pending.clear();
    }

    if (turns === detail.turns) return;

    const nextDetail = { ...detail, turns };
    const currentId = this.state.currentId;
    const now = Date.now();
    // 列表预览不需要每 token 更新，300ms 一次即可；详情仍每帧更新
    if (currentId && now - this.lastSessionPreviewAt > 300) {
      this.lastSessionPreviewAt = now;
      let preview = '';
      outer: for (let i = turns.length - 1; i >= 0; i--) {
        const blocks = turns[i]!.blocks;
        for (let j = blocks.length - 1; j >= 0; j--) {
          const b = blocks[j]!;
          if (b.kind === 'text' && b.text.trim()) {
            preview = b.text.replace(/\s+/g, ' ').trim().slice(0, 80);
            break outer;
          }
        }
      }
      const sessions = this.state.sessions.map((s) =>
        s.id === currentId
          ? { ...s, status: 'running' as const, updatedAt: now, ...(preview ? { preview } : {}) }
          : s
      );
      this.patch({ detail: nextDetail, sessions });
      return;
    }
    this.patch({ detail: nextDetail });
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
        prewarmTier: this.state.prewarmTier,
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
          prewarmTier?: PrewarmTier;
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
        if (parsed.prewarmTier === 'trigger' || parsed.prewarmTier === 'smart' || parsed.prewarmTier === 'always') {
          nextPatch.prewarmTier = parsed.prewarmTier;
          this.emitEngine({ type: 'SET_TIER', tier: parsed.prewarmTier });
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

  /** 把配对码 / 设备密钥拼进地址，远程和本机完整引擎共用 */
  private authEndpoint(target: string): string {
    const code = (this.state.pairCode.trim() || this.state.host?.pairCode || '').trim();
    const key = (this.state.deviceKey ?? '').trim();
    const params: string[] = [];
    if (key) params.push('key=' + encodeURIComponent(key));
    if (code) params.push('pair=' + encodeURIComponent(code));
    const separator = target.includes('?') ? '&' : '?';
    return params.length > 0 ? target + separator + params.join('&') : target;
  }

  async connect(url?: string): Promise<void> {
    const target = (url ?? this.state.url).trim();
    this.patch({ url: target, error: null, conn: 'connecting' });

    this.closeEngines();
    const client = new EngineClient({ url: this.authEndpoint(target), autoReconnect: true });
    const ok = await this.attach(client, 'remote', 'remote');
    if (!ok) {
      // 远程没连上：把轻引擎接回来，别让界面停在"无引擎"状态
      await this.runEngineEffects(this.emitEngine({ type: 'LINK_LOST', error: this.state.error ?? '远程宿主没连上', now: this.now() }));
    }
  }

  /**
   * 连本机完整引擎（proot）。
   *
   * 两阶段：先把目标 WebSocket + 握手跑通，再关掉当前轻引擎链路。
   * 这样目标没起来时轻引擎原封不动，用户当前的回合/草稿/会话都还在。
   */
  connectLocal(): Promise<boolean> {
    if (this.connectingLocal) return this.connectingLocal;
    const run = this.connectLocalInner().finally(() => {
      this.connectingLocal = null;
    });
    this.connectingLocal = run;
    return run;
  }

  private async connectLocalInner(): Promise<boolean> {
    if (!this.engineDeps.hostAvailable) {
      this.setError('这台设备不支持完整引擎（需要原生构建，Expo Go 不行）');
      return false;
    }
    await this.ensurePairCode();
    const attemptId = this.state.engine.attemptId;
    let swapped = false;
    this.patch({ conn: 'connecting', error: null });
    const client = new EngineClient({ url: this.authEndpoint(LOCAL_WS_URL), autoReconnect: true });
    try {
      const caps = await withTimeout(
        client.connect(),
        PROOT_CONNECT_TIMEOUT_MS,
        '完整引擎连接超时（20 秒）',
      ); // 第一阶段：目标就绪
      if (this.state.engine.attemptId !== attemptId) {
        // 用户又点了一次切换/回退，这一枪作废
        client.close();
        return false;
      }
      // 第二阶段：换链路。旧会话 detail 留在屏幕上，只读。
      this.suppressAutoOpen = true;
      // 轻引擎链路马上要关：如果新链路握手后面失败，lightReady 必须是 false，
      // 回退时才会重新连轻引擎（见 PROOT_FAILED → connectLightFallback）。
      this.emitEngine({ type: 'LIGHT_CONNECTING' });
      swapped = true;
      this.closeEngines();
      this.patch({ url: LOCAL_WS_URL });
      const attached = await this.attach(client, 'remote', 'proot', caps);
      this.suppressAutoOpen = false;
      if (!attached) throw new Error(this.state.error ?? '完整引擎握手失败');
      // 切成功之后旧会话才变只读：失败回退时 currentId 还在，用户能继续用
      this.patch({ currentId: null });
      return true;
    } catch (err) {
      client.close();
      this.suppressAutoOpen = false;
      const message = humanizeError(err);
      if (!swapped && this.state.engine.lightReady && this.state.engineKind === 'light') {
        // 第一阶段的失败：轻引擎根本没动，把 conn 恢复回去，别让界面卡在"连接中"
        this.patch({ conn: 'connected', connDetail: undefined });
      }
      this.setError(message);
      await this.runEngineEffects(
        this.emitEngine({
          type: 'PROOT_FAILED',
          error: message,
          attemptId: this.state.engine.attemptId,
          now: this.now(),
        }),
      );
      return false;
    }
  }

  /** 本机完整引擎第一次配对：桥打印过 6 位配对码，状态/日志里捞一下 */
  private async ensurePairCode(): Promise<void> {
    if (this.state.pairCode.trim() || this.state.deviceKey) return;
    const fromHost = this.state.host?.pairCode;
    if (fromHost) {
      this.patch({ pairCode: fromHost });
      return;
    }
    try {
      const logs = await hostLogs();
      const found = logs.join('\n').match(/配对码\s+(\d{6})/);
      if (found?.[1]) this.patch({ pairCode: found[1] });
    } catch {
      /* 读不到就退回手输配对码 */
    }
  }

  /**
   * 连本机的轻引擎：引擎和 UI 在同一个 JS 进程里，传输层换成进程内调用，
   * 但 store 以上（含所有界面）看到的仍是一模一样的协议。
   */
  async connectLight(setup: LightEngineSetup): Promise<void> {
    this.patch({ conn: 'connecting', error: null });
    this.lightSetup = setup;
    this.emitEngine({ type: 'LIGHT_CONNECTING' });
    let host: LightHost | null = null;
    let client: LocalEngineClient | null = null;
    try {
      // 两阶段：轻引擎先在后台建好并握手成功，再关旧链路。
      // createLightHost 是纯进程内操作，几十毫秒；切开时不会闪断。
      host = await createLightHost(setup);
      client = new LocalEngineClient(host);
      const caps = await client.connect();
      this.client?.close();
      this.lightHost?.close();
      this.lightHost = host;
      this.client = client;
      const ok = await this.attach(client, 'light', 'light', caps);
      if (ok) await saveLightConfig(setup);
    } catch (err) {
      client?.close();
      host?.close();
      this.fail(err);
      this.emitEngine({ type: 'LIGHT_FAILED', error: humanizeError(err) });
    }
  }

  private closeEngines(): void {
    this.client?.close();
    this.client = null;
    this.lightHost?.close();
    this.lightHost = null;
  }

  /**
   * 连线之后的共同部分：远程宿主、本机完整引擎和轻引擎都走这里。
   * `preconnectedCaps` 用于两阶段切换：WebSocket 握手已经在外面做完了。
   */
  private async attach(
    client: EngineTransport,
    kind: 'remote' | 'light',
    link: EngineLink = kind === 'light' ? 'light' : 'remote',
    preconnectedCaps?: Capabilities,
  ): Promise<boolean> {
    this.client = client;
    this.patch({ engineKind: kind });

    client.onStateChange((conn, connDetail) => {
      this.patch({ conn, connDetail });
    });

    client.onAny((event) => this.applyEvent(event.event, event.data));

    try {
      const caps = preconnectedCaps ?? (await client.connect());
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
      } else if (this.state.currentId && !this.suppressAutoOpen) {
        // 如果用户在引擎连接前已经点开了某个缓存会话，连上后自动刷新它的详情；
        // 切换引擎时 suppressAutoOpen=true，旧会话保持只读，不会把用户拽回去。
        void this.openSession(this.state.currentId);
      }
      if (link === 'light') this.emitEngine({ type: 'LIGHT_READY', now: this.now() });
      else if (link === 'proot') this.emitEngine({ type: 'PROOT_CONNECTED' });
      else this.emitEngine({ type: 'REMOTE_ATTACHED' });
      return true;
    } catch (err) {
      this.patch({ conn: 'closed' });
      this.fail(err);
      if (link === 'light') this.emitEngine({ type: 'LIGHT_FAILED', error: humanizeError(err) });
      return false;
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
    // 用户主动断开：只更新状态机，不自动重连（effects 不执行）
    this.emitEngine({ type: 'LINK_LOST', error: '已断开当前连接', now: this.now() });
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
    this.noteUserActivity();
    const cached = this.detailCache.get(id);
    this.detailCache.delete(id);
    // 重进会话先把 currentId/detail 切过去，避免 sessions.get 期间到达的流式帧被丢
    this.patch(
      cached
        ? { busy: true, error: null, currentId: id, detail: cached }
        : { busy: true, error: null }
    );
    try {
      const { session } = await this.client.request('sessions.get', { sessionId: id });
      let turns = session.turns;
      const active = session.status === 'running' || session.status === 'waiting_approval';
      const live = active
        ? cached?.turns.find((t) => t.role === 'assistant' && t.status === 'streaming')
        : undefined;
      if (live) turns = overlayLiveTurn(turns, live);
      turns = normalizeTurns(turns);
      this.patch({ detail: { ...session, turns }, currentId: id, busy: false });
      // 重新打开会话时把还没回答的提问捞回来（真引擎那边由桥维护）
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

  /**
   * 冷启动 / 回前台时读一次「分享到锦囊」。
   * 文字进输入框；文件已由原生收件复制进 workspace/uploads，直接挂进待发列表。
   */
  async consumeShare(): Promise<void> {
    const share = await intakeShare();
    if (!share) return;
    if (share.files.length > 0) this.appendIntake(share.files);
    if (share.errors?.length) this.setError(share.errors[0] ?? '有附件没能读取');
    if (share.text) this.patch({ pendingShare: { text: share.text } });
  }

  /** 首页取走分享来的文字（取完清掉，只填一次输入框） */
  takeShareText(): string | null {
    const text = this.state.pendingShare?.text;
    if (!text) return null;
    this.patch({ pendingShare: null });
    return text;
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
  async startWith(text: string): Promise<boolean> {
    const trimmed = text.trim();
    const hasAttachments = this.state.pendingAttachments.length > 0;
    if (!trimmed && !hasAttachments) return false;
    this.noteUserActivity();
    if (!this.client || this.state.conn !== 'connected') {
      if (this.state.engine.mode === 'starting-proot') {
        this.setError('完整引擎正在启动，请稍候片刻再发送');
      } else if (!this.state.engine.lightReady) {
        this.setError('轻引擎还没配置或没连上，点首页「配置轻引擎」先填模型渠道');
      } else {
        this.setError('引擎正在唤醒中，请稍候片刻再发送');
      }
      return false;
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
      return await this.send(trimmed);
    } catch (err) {
      this.fail(err);
      return false;
    }
  }

  async send(text: string): Promise<boolean> {
    const { currentId, detail } = this.state;
    const trimmed = text.trim();
    const stagedList = this.state.pendingAttachments.slice();
    if (!this.client || !currentId || !detail || (!trimmed && stagedList.length === 0)) return false;
    if (this.state.attaching) {
      this.setError('附件还在读取中，请稍候…');
      return false;
    }
    this.noteUserActivity();
    const running = detail.status === 'running' || detail.status === 'waiting_approval';
    // 附件只传路径引用；文件早已由原生收件落进 workspace/uploads
    const files = stagedList.filter((item) => item.status === 'ready').map(toFileRef);
    this.patch({ busy: true, error: null });
    try {
      const payload = {
        sessionId: currentId,
        text: trimmed,
        ...(files.length > 0 ? { files } : {}),
      };
      if (running) await this.client.request('sessions.steer', payload);
      else await this.client.request('sessions.send', payload);
      // 提交成功后立刻置为 running：停止按钮要马上出现，
      // 下一条消息也要走 steer（插话）而不是再排一个回合。
      const { detail: latest } = this.state;
      // 附件只在发送成功后清空：失败时用户不用重选
      this.patch({ busy: false, pendingAttachments: [], ...(latest ? { detail: { ...latest, status: 'running' } } : {}) });
      return true;
    } catch (err) {
      this.patch({ busy: false });
      this.fail(err);
      return false;
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

  /* ---------------------------- 附件 ---------------------------- */

  /**
   * 相册 / 系统文件选择器 → 原生收件进 workspace/uploads → 挂进待发列表。
   * 图片相册只拿 URI（不把图片读进 JS 内存），其它类型走 SAF（原生内部已收件）。
   */
  async attachFromPicker(kind: AttachmentKind): Promise<void> {
    if (this.state.attaching) return;
    try {
      if (kind === 'image') {
        // null = 用户在相册里取消；[] = 相册不可用，回退到系统文件选择器
        const picked = await intakeImagePicker();
        if (picked === null) return;
        if (picked.length > 0) {
          await this.attachFiles(picked);
          return;
        }
      }
      const refs = await pickAttachments(ATTACH_MIME[kind]);
      this.attachRefs(refs);
    } catch (err) {
      this.setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** 一批来源交给原生收件；全失败时原生会 reject（中文原因），这里原样展示 */
  async attachFiles(sources: IntakeSource[]): Promise<void> {
    const list = sources.filter((source) => Boolean(source.uri || source.path));
    if (list.length === 0 || this.state.attaching) return;
    this.patch({ attaching: true, error: null });
    try {
      const refs = await intakeFiles(list);
      if (refs.length === 0) {
        this.setError('没能读取附件；如果是从相册/文件选择器选的，请重新选一次');
        return;
      }
      this.attachRefs(refs);
    } catch (err) {
      this.setError(err instanceof Error ? err.message : String(err));
    } finally {
      this.patch({ attaching: false });
    }
  }

  /** 已落盘的 FileRef[] → 待发列表（分类 + 去重 + 提示） */
  private attachRefs(refs: FileRef[]): void {
    if (refs.length === 0) return;
    const added = this.appendIntake(refs);
    if (added === 0) this.setError('这些附件已经在待发列表里了');
  }

  /** 按 `<hash16>:<name>` 去重后追加；返回新增数量 */
  private appendIntake(refs: FileRef[]): number {
    const existing = this.state.pendingAttachments;
    const added: PendingAttachment[] = [];
    for (const ref of refs) {
      const id = `${hashPrefix(ref.hash ?? ref.relPath, 16)}:${ref.name}`;
      if (existing.some((item) => item.id === id) || added.some((item) => item.id === id)) continue;
      const classified = classify(ref.mime, ref.name, ref.bytes);
      added.push({
        ...ref,
        id,
        kind: classified.kind,
        engine: classified.engine,
        saveOnly: classified.saveOnly,
        ...(classified.hint ? { hint: classified.hint } : {}),
        status: 'ready',
      });
    }
    if (added.length > 0) this.patch({ pendingAttachments: [...existing, ...added] });
    return added.length;
  }

  removeAttachment(id: string): void {
    this.patch({ pendingAttachments: this.state.pendingAttachments.filter((a) => a.id !== id) });
  }

  /* ---------------------------- 模型 ---------------------------- */

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

  /* ------------------------ EngineManager ------------------------ */

  /**
   * 冷启动入口：恢复本地缓存 → 通知权限 → 连轻引擎。
   *
   * 完整引擎**不会**在这里被连接；只有 tier==='always'（或智能预热条件满足）时
   * 才 `warmLocalHost()` 把 proot 拉起来（只预热、不连接）。
   * BOOT 事件本身只发 connect-light —— 回归锁在 engineManager 里。
   */
  async engineStart(): Promise<void> {
    if (this.engineStarted) return;
    this.engineStarted = true;
    await this.hydrateLocalCache();
    void ensureNotificationPermission();
    const effects = this.emitEngine({ type: 'BOOT', tier: this.state.prewarmTier, now: this.now() });
    this.startIdleSweeper();
    await this.runEngineEffects(effects);
    if (this.state.engine.mode !== 'light') return;
    if (this.state.engine.tier === 'always') void this.warmLocalHost();
    else void this.maybeSmartPrewarm();
  }

  /** 用户有动作：空闲回收计时重新开始（发送/开会话/回前台时调用） */
  noteUserActivity(): void {
    this.emitEngine({ type: 'USER_ACTIVITY', now: this.now() });
  }

  /** 切预热档位：触发式（默认）/ 智能 / 常备，写进 ui-cache */
  setPrewarmTier(tier: PrewarmTier): void {
    this.emitEngine({ type: 'SET_TIER', tier });
    this.persistUiCache();
    if (!this.engineDeps.hostAvailable) return;
    if (tier === 'always' && !this.state.engine.prootWarm) void this.warmLocalHost();
    if (tier === 'smart') void this.maybeSmartPrewarm();
  }

  /** HomeScreen 的「配置轻引擎」入口：打开 M1 实验室的轻引擎页 */
  openLightSetup(): void {
    this.patch({ view: 'settings', lightSetupOpen: true, error: null });
  }

  closeLightSetup(): void {
    this.patch({ lightSetupOpen: false });
  }

  /**
   * 只预热完整引擎：startHost，但**永不 connect**。
   * 返回 true 表示桥已就绪（或本来就在跑）。
   */
  async warmLocalHost(timeoutMs = PROOT_BOOT_TIMEOUT_MS): Promise<boolean> {
    if (!this.engineDeps.hostAvailable) {
      this.setError('这台设备不支持完整引擎（需要原生构建，Expo Go 不行）');
      if (this.state.engine.mode === 'starting-proot') {
        await this.runEngineEffects(
          this.emitEngine({ type: 'PROOT_FAILED', error: '这台设备不支持完整引擎', now: this.now() }),
        );
      }
      return false;
    }
    if (this.warming) return this.warming;
    const run = this.warmLocalHostInner(timeoutMs);
    this.warming = run;
    void run.finally(() => {
      // 只清理自己这一枪，别把取消后新一轮 prewarm 的 promise 清掉
      if (this.warming === run) this.warming = null;
    });
    return run;
  }

  private async warmLocalHostInner(timeoutMs: number): Promise<boolean> {
    const attemptId = this.state.engine.attemptId;
    const switching = this.state.engine.mode === 'starting-proot';
    const before = await this.engineDeps.hostStatus().catch(() => null);
    if (before) this.emitEngine({ type: 'HOST_STATUS', host: before });
    const alreadyReady = before?.engine === 'ready' && before?.bridge === 'ready';
    // 已热着：纯预热直接成功；切换时由 switchEngine 接着 connectLocal()
    if (alreadyReady) return true;
    const started = await this.engineDeps
      .startHost({
        engineCmd: this.state.hostEngineCmd.trim() || undefined,
        bridgeCmd: this.state.hostBridgeCmd.trim() || undefined,
      })
      .catch(() => false);
    if (!started) {
      this.patch({ error: '本机完整引擎没启动起来' });
      await this.runEngineEffects(
        this.emitEngine({
          type: 'PROOT_FAILED',
          error: '本机完整引擎没启动起来',
          attemptId,
          now: this.now(),
        }),
      );
      return false;
    }
    this.ensureStatusWatcher();
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      await sleep(300);
      if (this.state.engine.attemptId !== attemptId) return false; // 新一轮切换接管了
      if (switching && this.state.engine.mode !== 'starting-proot') return false; // 被取消/回退
      const status = await this.engineDeps.hostStatus().catch(() => null);
      if (!status) continue;
      // HostRuntime 自己会重试，failed 只是暂时状态：这里继续等，不立刻判死
      this.emitEngine({ type: 'HOST_STATUS', host: status });
      if (status.engine === 'ready' && status.bridge === 'ready') return true;
    }
    const timeoutError = `完整引擎 ${Math.round(timeoutMs / 1000)} 秒内没就绪，已回到轻引擎`;
    this.patch({ error: timeoutError });
    await this.runEngineEffects(
      this.emitEngine({
        type: 'PROOT_TIMEOUT',
        error: timeoutError,
        attemptId,
        now: this.now(),
      }),
    );
    return false;
  }

  /**
   * 手动切换：轻 ↔ 完整。
   * - 切完整：先预热，桥就绪后 connectLocal（两阶段，目标连上才断轻引擎）。
   * - 切轻：先确保轻引擎连上，再停 proot。
   * 失败/超时自动回退轻引擎，不丢当前回合/草稿/会话 detail。
   */
  async switchEngine(target: EngineTarget): Promise<boolean> {
    const check = canSwitch(this.state.engine, target);
    if (!check.ok) {
      this.setError(check.reason ?? '现在不能切换引擎');
      return false;
    }
    if (target === 'full' && !this.engineDeps.hostAvailable) {
      this.setError('这台设备不支持完整引擎（需要原生构建，Expo Go 不行）');
      return false;
    }
    this.noteUserActivity();
    const effects = this.emitEngine({ type: 'SWITCH', target, now: this.now() });
    if (effects.length === 0) {
      this.setError('现在不能切换引擎');
      return false;
    }
    for (const effect of effects) {
      switch (effect) {
        case 'warm-host': {
          const ok = await this.warmLocalHost();
          if (!ok) {
            // 预热可能是更早一轮（纯预热）发起的：attemptId 对不上时 PROOT_TIMEOUT
            // 会被忽略，这里按当前这一轮补一次失败收口，别把 UI 卡在"启动中"。
            if (this.state.engine.mode === 'starting-proot') {
              await this.runEngineEffects(
                this.emitEngine({
                  type: 'PROOT_FAILED',
                  error: '完整引擎没启动起来',
                  attemptId: this.state.engine.attemptId,
                  now: this.now(),
                }),
              );
            }
            if (!this.state.engine.lightReady) await this.connectLightFallback();
            return false;
          }
          // 预热完成（桥 ready）后再连本机完整引擎；两阶段切换在这里收口
          const connected = await this.connectLocal();
          if (!connected) {
            if (!this.state.engine.lightReady) await this.connectLightFallback();
            return false;
          }
          break;
        }
        case 'connect-light': {
          const ok = await this.connectLightEffect();
          if (!ok && target === 'light') {
            // 轻引擎没接上就别停 proot；状态机也退回"完整引擎"，链路还在
            this.emitEngine({ type: 'PROOT_CONNECTED' });
            this.setError('切回轻引擎失败，仍停留在完整引擎');
            return false;
          }
          break;
        }
        case 'connect-proot':
          await this.connectLocal();
          break;
        case 'stop-host':
          await this.stopHostEffect();
          break;
        case 'report':
          break;
      }
    }
    return target === 'full' ? this.state.engine.mode === 'full' : this.state.engine.mode === 'light';
  }

  /** 确保轻引擎在线（已经连着就什么都不做）；返回是否就绪 */
  private async connectLightEffect(): Promise<boolean> {
    if (this.state.engine.lightReady && this.state.engineKind === 'light' && this.state.conn === 'connected') {
      return true;
    }
    const setup = this.lightSetup ?? (await this.engineDeps.loadLightConfig());
    if (!setup) {
      this.emitEngine({
        type: 'LIGHT_FAILED',
        error: '轻引擎还没配置：点首页「配置轻引擎」填 Base URL / 模型 / Key',
      });
      return false;
    }
    this.lightSetup = setup;
    await this.connectLight(setup);
    return this.state.engine.lightReady;
  }

  private async connectLightFallback(): Promise<void> {
    await this.connectLightEffect();
  }

  /** 智能预热：只在充电 + WiFi 时把 proot 拉起来（仍然不连接） */
  private async maybeSmartPrewarm(): Promise<void> {
    if (!this.engineDeps.hostAvailable) return;
    if (this.state.engine.tier !== 'smart' || this.state.engine.prootWarm) return;
    if (this.state.engine.mode !== 'light') return;
    const conditions = await this.engineDeps.deviceConditions().catch(() => null);
    if (conditions?.charging && conditions.wifi) void this.warmLocalHost();
  }

  /**
   * 回收完整引擎。
   * - 'idle'：只在空闲 10 分钟后由 sweeper 调（reducer 自己也会校验）。
   * - 其它（手动/低内存）：完整引擎在线就先切回轻引擎，再停宿主。
   */
  async reclaimProot(reason: string = 'manual'): Promise<void> {
    // 正在起完整引擎时取消：PROOT_FAILED 会走 stop-host + 回轻引擎
    if (this.state.engine.mode === 'starting-proot') {
      this.warming = null;
      await this.runEngineEffects(
        this.emitEngine({
          type: 'PROOT_FAILED',
          error: '已取消完整引擎启动',
          attemptId: this.state.engine.attemptId,
          now: this.now(),
        }),
      );
      return;
    }
    if (!this.state.engine.prootWarm) return;
    if (reason !== 'idle' && this.state.engine.link === 'proot') {
      await this.switchEngine('light');
      return;
    }
    await this.runEngineEffects(this.emitEngine({ type: 'RECLAIM', reason, now: this.now() }));
  }

  private async stopHostEffect(): Promise<void> {
    if (!this.engineDeps.hostAvailable) return;
    await this.engineDeps.stopHost().catch(() => false);
    const status = await this.engineDeps.hostStatus().catch(() => null);
    if (status) this.emitEngine({ type: 'HOST_STATUS', host: status });
    this.emitEngine({ type: 'RECLAIMED' });
    this.ensureStatusWatcher();
  }

  /** 拉一次宿主服务状态（设置页每 2 秒调一次），顺便喂给 EngineManager */
  async refreshHost(): Promise<void> {
    if (!this.engineDeps.hostAvailable) return;
    const status = await this.engineDeps.hostStatus().catch(() => null);
    if (!status) return;
    const nextPatch: Partial<AppState> = {};
    if (JSON.stringify(status) !== JSON.stringify(this.state.host)) nextPatch.host = status;
    if (status.pairCode && status.pairCode !== this.state.pairCode) nextPatch.pairCode = status.pairCode;
    if (Object.keys(nextPatch).length > 0) this.patch(nextPatch);
    this.emitEngine({ type: 'HOST_STATUS', host: status });
  }

  /** proot 热着的时候每 2 秒盯一次；死了就切回轻引擎 */
  private ensureStatusWatcher(): void {
    const active = this.engineDeps.hostAvailable && this.state.engine.prootWarm;
    if (active && !this.statusTimer) {
      this.statusTimer = setInterval(() => {
        void this.pollHostStatus();
      }, 2000);
    } else if (!active && this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
      this.hostDeadTicks = 0;
    }
  }

  private async pollHostStatus(): Promise<void> {
    if (this.statusPolling) return;
    this.statusPolling = true;
    try {
      const status = await this.engineDeps.hostStatus().catch(() => null);
      if (!status) return;
      const before = this.state.engine;
      this.emitEngine({ type: 'HOST_STATUS', host: status });
      const stopped = status.engine === 'stopped';
      const failing = status.engine === 'failed' && status.bridge !== 'ready';
      this.hostDeadTicks = failing ? this.hostDeadTicks + 1 : 0;
      // 完整引擎链路断了：立刻回轻引擎（failed 连续 3 帧才算死，给 HostRuntime 重试时间）
      if (before.mode === 'full' && before.link === 'proot' && (stopped || this.hostDeadTicks >= 3)) {
        this.hostDeadTicks = 0;
        // 旧会话属于已经死掉的完整引擎：清 currentId，detail 留在屏幕上只读
        this.suppressAutoOpen = true;
        this.patch({ currentId: null });
        try {
          await this.runEngineEffects(
            this.emitEngine({ type: 'LINK_LOST', error: '完整引擎已停止，已回到轻引擎', now: this.now() }),
          );
        } finally {
          this.suppressAutoOpen = false;
        }
      }
    } finally {
      this.statusPolling = false;
    }
  }

  /** 空闲 10 分钟回收 proot；没有活跃回合才停（RECLAIM 里还有一层校验） */
  private startIdleSweeper(): void {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      const engine = this.state.engine;
      if (!engine.prootWarm || engine.mode !== 'light' || !engine.idleSince) return;
      if (this.now() - engine.idleSince < IDLE_RECLAIM_MS) return;
      void this.reclaimProot('idle');
    }, IDLE_SWEEP_MS);
  }

  /** 回到前台：重连轻引擎、按档位补预热 */
  async onAppForeground(): Promise<void> {
    this.noteUserActivity();
    if (!this.engineStarted) return;
    const engine = this.state.engine;
    if (engine.mode === 'light' && !engine.lightReady) {
      await this.connectLightFallback();
      return;
    }
    if (engine.mode === 'light' && !engine.prootWarm && engine.tier === 'always') {
      void this.warmLocalHost();
      return;
    }
    void this.maybeSmartPrewarm();
  }

  private reportRunActive(active: boolean): void {
    try {
      void this.engineDeps.setRunActive(active);
    } catch {
      /* 老 APK 没有这个接口 */
    }
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

  /** 直接停原生宿主（安全模式重启/设置页手动停止用）；正常回退走 reclaimProot */
  async stopLocalHost(): Promise<void> {
    await this.stopHostEffect();
  }

  async refreshHostLogs(): Promise<void> {
    if (!this.engineDeps.hostAvailable) return;
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
          this.pendingDelta.delete(data.blockId);
          const turnIndex = detail.turns.findIndex((t) => t.id === data.turnId);
          const turn = detail.turns[turnIndex];
          const blockIndex = turn?.blocks.findIndex((b) => b.id === data.blockId) ?? -1;
          if (!turn || blockIndex < 0) return;
          const blocks = turn.blocks.slice();
          blocks[blockIndex] = { ...block, text: data.text };
          const turns = detail.turns.slice();
          turns[turnIndex] = { ...turn, blocks };
          this.patch({ detail: { ...detail, turns } });
          return;
        }
        const chunks = this.pendingDelta.get(data.blockId);
        if (chunks) chunks.push(data.text);
        else this.pendingDelta.set(data.blockId, [data.text]);
        this.scheduleDeltaFlush();
        return;
      }

      case 'block.updated': {
        if (!detail || data.sessionId !== currentId) return;
        const turnIndex = detail.turns.findIndex((t) => t.id === data.turnId);
        const turn = detail.turns[turnIndex];
        if (!turn) return;
        const incoming = data.block as Block;
        const blockIndex = turn.blocks.findIndex((b) => b.id === incoming.id);
        if (blockIndex < 0) return;
        const nextBlock =
          incoming.kind === 'text' || incoming.kind === 'thinking'
            ? { ...incoming, done: true }
            : incoming;
        const blocks = turn.blocks.slice();
        blocks[blockIndex] = nextBlock;
        const turns = detail.turns.slice();
        turns[turnIndex] = { ...turn, blocks };
        this.patch({ detail: { ...detail, turns } });
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
        // 原生 onTrimMemory 回收 proot 前会先问这里：有活跃回合就先不动
        this.reportRunActive(true);
        const d = this.state.detail;
        const sessions = this.state.sessions.map((s) =>
          s.id === data.sessionId ? { ...s, status: 'running' as const, updatedAt: Date.now() } : s
        );
        this.patch({ sessions, ...(d && data.sessionId === currentId ? { detail: { ...d, status: 'running' }, busy: true } : {}) });
        return;
      }

      case 'run.finished': {
        this.flushDeltas();
        this.reportRunActive(false);
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
          const turnIndex = findRunTurnIndex(turns, runId);
          const target = turnIndex >= 0 ? turns[turnIndex] : undefined;
          if (target) {
            const needsStatus = target.status !== finalStatus;
            const needsDuration = durationMs !== null && !target.meta?.durationMs;
            if (needsStatus || needsDuration) {
              turns = turns.slice();
              turns[turnIndex] = {
                ...target,
                status: finalStatus,
                meta: {
                  ...target.meta,
                  ...(needsDuration && durationMs !== null
                    ? { durationMs, steps: target.meta?.steps ?? target.blocks.length }
                    : {}),
                },
              };
            }
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
