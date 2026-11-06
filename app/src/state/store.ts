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
import { loadAccountToken } from '../lib/accountToken';
import { humanizeError } from '../lib/errors';
import {
  createLightHost,
  loadLightConfig,
  loadLightSetupSkipped,
  saveLightConfig,
  saveLightSetupSkipped,
  type LightEngineSetup,
} from '../lib/light';
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
import { routeNeedsFullPermission, routeTurn, type RouteTurnResult } from './router';
import type { WebFrontendTarget } from '../lib/webFrontend';
import { LocalEngineClient } from '../engine/light/localClient';
import type { LightHost } from '../engine/light/host';
import { applyProviderSave, withFreshAccountToken } from '../engine/light/config';
import { ensureNotificationPermission, notifyEvent } from '../lib/notify';
import { isAppActive, openUrl } from '../lib/platform';
import {
  intakeFiles,
  intakeImagePicker,
  intakeShare,
  pickAttachments,
} from '../lib/attachments/intake';
import { classify, hashPrefix } from '../lib/attachments/classify';
import { mergeSessionRows, type SessionEngine, type SessionRow } from './sessionList';
import type { ThemeMode } from '../ui/theme/palette';
import type { AttachmentEngine, AttachmentKind, IntakeSource } from '../lib/attachments/types';
import {
  buildHandoff,
  buildReverseSeedText,
  buildSeedText,
  detailHasSeedMarker,
  findSeedTurnId,
  isConversationReadOnly,
  lastAssistantTextFromDetail,
  lastUserTextFromDetail,
  logicalIdFor,
  mapPresetForTarget,
  mergeDetail,
  physicalIdFor,
  turnDetailToHistory,
  upsertConversationLink,
  type ConversationLink,
} from '../lib/handoff';
import type {
  AccountState,
  Approval,
  Block,
  Capabilities,
  CatalogProvider,
  FileRef,
  HandoffBlockedCall,
  HandoffV1,
  Method,
  ModelChoice,
  ModelOption,
  PermissionOption,
  ProviderModel,
  ProviderProtocol,
  ProviderRow,
  RequestParams,
  RequestResults,
  ApprovalDecision,
  ApprovalResolution,
  SessionDetail,
  SessionSearchHit,
  SessionSummary,
  Turn,
  Workspace,
  WorkspaceEntry,
} from '../protocol';
import { withApprovalResolution } from '../protocol/qa';
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
  events: ['engine.status', 'session.created', 'session.updated', 'run.started', 'block.appended', 'block.delta', 'block.updated', 'run.finished', 'approval.requested', 'approval.resolved', 'capability.missing', 'account.updated'],
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
  /** 两个引擎各自的最近会话缓存：统一下拉列表用（M2.6） */
  sessionCache: Record<SessionEngine, SessionSummary[]>;
  currentId: string | null;
  detail: SessionDetail | null;
  approvals: Record<string, Approval>;
  error: string | null;
  busy: boolean;
  /** 首页输入框当前选中的锦囊 */
  draftPresetId: string | null;
  /** 当前页面：主界面 / 设置 / 全部功能 / 文件 / 搜索 / 工作区 / 终端 / 插件 */
  view: 'main' | 'settings' | 'features' | 'files' | 'search' | 'workspace' | 'terminal' | 'plugins';
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
  /** 最近一次远程宿主（M3.2）：用于断线后重连和离线提示 */
  remoteHost: { url: string; name: string; hostId: string; lastSeenAt: number } | null;
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
  /**
   * 一条逻辑会话 → 两个物理会话的映射（1.4）。
   * 列表只显示 lightSessionId；fullSessionId 的会话被隐藏。
   */
  links: ConversationLink[];
  /** 会话级引擎 pin：用户点「留在轻引擎」后，这一条会话不再自动切 */
  sessionPins: Record<string, 'light' | 'full'>;
  /** U6 文件夹：逻辑会话 id → 文件夹名（UI cache，仅本机） */
  sessionFolders: Record<string, string>;
  /** 全局自动路由（默认 true），持久化在 ui-cache */
  autoRoute: boolean;
  /** 完成的回合默认收起思考/工具过程（外观设置，持久化在 UI cache） */
  collapseProcess: boolean;
  /** U7 对话字号倍率：1 / 1.15 / 1.3（持久化在 UI cache） */
  chatFontScale: number;
  /** U7 主题：跟随系统 / 浅色 / 深色（持久化在 UI cache） */
  themeMode: ThemeMode;
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
  /** 用户是否选过「先用完整模式」；没有配置时用它决定冷启动直接起 proot */
  loadLightSetupSkipped: () => Promise<boolean>;
  now: () => number;
}

/**
 * Handoff 的副作用依赖。
 * 生产环境全走真实现；单测注入假 client / 假切换，验证 create/send/rollback 顺序。
 */
export interface HandoffDeps {
  requestLight?<M extends Method>(method: M, params: RequestParams[M]): Promise<RequestResults[M]>;
  requestFull?<M extends Method>(method: M, params: RequestParams[M]): Promise<RequestResults[M]>;
  switchToFull?(): Promise<boolean>;
  switchToLight?(): Promise<boolean>;
  now?(): number;
}

/** 一次交接的输入；预路由和能力门共用 */
export interface BeginHandoffInput {
  logicalId: string;
  reason: string;
  userText: string;
  assistantText?: string;
  missing?: string[];
  blockedCallIds?: string[];
  files?: FileRef[];
  /** 能力卡 block id，成功后回填 handed_off */
  blockId?: string;
  /** F8：proot 里跑 bash 需要 danger-full-access，能力卡确认后为 true */
  escalate?: boolean;
  title?: string;
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
    sessionCache: { light: [], full: [] },
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
    remoteHost: null,
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
    links: [],
    sessionPins: {},
    sessionFolders: {},
    autoRoute: true,
    collapseProcess: true,
    chatFontScale: 1,
    themeMode: 'system',
  };

  private readonly engineDeps: EngineDeps;
  private readonly handoffDeps: HandoffDeps;
  /** 同一时刻只允许一次交接；并发调用复用同一个 promise（避免重复 create） */
  private handoffInFlight: Promise<boolean> | null = null;
  /** 轻引擎侧的原始 detail，交接后 mergeDetail 要用 */
  private readonly baseDetails = new Map<string, SessionDetail>();

  constructor(engineDeps: Partial<EngineDeps> = {}, handoffDeps: Partial<HandoffDeps> = {}) {
    this.engineDeps = {
      hostAvailable,
      hostStatus,
      startHost,
      stopHost,
      deviceConditions: hostDeviceConditions,
      setRunActive: setNativeHostRunActive,
      loadLightConfig,
      loadLightSetupSkipped,
      now: () => Date.now(),
      ...engineDeps,
    };
    this.handoffDeps = handoffDeps;
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
  /** 冷启动初始化只跑一次；深链要等它结束再切引擎，避免和 BOOT 抢链路 */
  private engineStartInFlight: Promise<void> | null = null;
  /** 每次冷启动最多自动弹一次配置页，避免用户切到完整模式后还被反复打断 */
  private lightSetupPrompted = false;
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

  /* ------------------------ 逻辑会话 / 物理会话 ------------------------ */

  /** 逻辑 id、轻引擎 id、完整引擎 id 都能查到同一条 link */
  linkForSession(id: string | null | undefined): ConversationLink | undefined {
    if (!id) return undefined;
    return this.state.links.find(
      (link) => link.id === id || link.lightSessionId === id || link.fullSessionId === id,
    );
  }

  private linkByFullSession(fullId: string | null | undefined): ConversationLink | undefined {
    if (!fullId) return undefined;
    return this.state.links.find((link) => link.fullSessionId === fullId);
  }

  private logicalIdOf(physicalId: string | null | undefined): string | undefined {
    if (!physicalId) return undefined;
    return this.linkByFullSession(physicalId)?.id ?? physicalId;
  }

  /** 界面上/发送用的物理 sessionId；没有 link 时原样返回 */
  physicalIdFor(logicalId: string): string {
    const link = this.linkForSession(logicalId);
    if (!link) return logicalId;
    return (link.activeSide === 'full' ? link.fullSessionId : link.lightSessionId) ?? link.lightSessionId;
  }

  private setLink(link: ConversationLink): void {
    // 完整物理会话永远不在列表里单独出现（事件可能比 setLink 先到，这里补一次清理）
    const sessions = link.fullSessionId
      ? this.state.sessions.filter((session) => session.id !== link.fullSessionId)
      : this.state.sessions;
    this.patch({
      links: upsertConversationLink(this.state.links, { ...link, updatedAt: this.now() }),
      ...(sessions !== this.state.sessions ? { sessions } : {}),
    });
    this.persistUiCache();
  }

  /** 全局自动路由开关（默认 true） */
  setAutoRoute(enabled: boolean): void {
    this.patch({ autoRoute: enabled });
    this.persistUiCache();
  }

  /** 外观：完成的回合是否默认收起过程（默认 true） */
  setCollapseProcess(enabled: boolean): void {
    this.patch({ collapseProcess: enabled });
    this.persistUiCache();
  }

  /** U7 对话字号：标准 → 大 → 特大 → 标准 */
  cycleChatFontScale(): void {
    const steps = [1, 1.15, 1.3];
    const index = steps.findIndex((step) => Math.abs(step - this.state.chatFontScale) < 0.01);
    const next = steps[(index + 1) % steps.length] ?? 1;
    this.patch({ chatFontScale: next });
    this.persistUiCache();
  }

  /** U7 主题：跟随系统 / 浅色 / 深色 */
  setThemeMode(mode: ThemeMode): void {
    this.patch({ themeMode: mode });
    this.persistUiCache();
  }

  /**
   * 会话级 pin：'light' 表示以后不再自动切完整；null 清除。
   * TODO(1.4): 还没做 pin 的 UI 入口（按裁剪顺序最后补；规则与持久化已就绪）。
   */
  setSessionPin(side: 'light' | 'full' | null, logicalId: string | null = this.state.currentId): void {
    if (!logicalId) return;
    const pins = { ...this.state.sessionPins };
    if (side) pins[logicalId] = side;
    else delete pins[logicalId];
    this.patch({ sessionPins: pins });
    this.persistUiCache();
  }

  /** U6 文件夹：设置/清除会话的文件夹，仅存本机 UI cache */
  setSessionFolder(logicalId: string, folder: string): void {
    const name = folder.trim().slice(0, 24);
    const folders = { ...this.state.sessionFolders };
    if (name) folders[logicalId] = name;
    else delete folders[logicalId];
    this.patch({ sessionFolders: folders });
    this.persistUiCache();
  }

  /** 「留在轻引擎」按钮：这个会话以后不自动切；能力门仍会在下次缺能力时提示 */
  stayOnLight(_block?: Extract<Block, { kind: 'capability' }>): void {
    this.setSessionPin('light', this.state.currentId);
    this.setError('已留在轻引擎；需要时再点能力卡完成交接。');
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
        sessionCache: {
          light: this.state.sessionCache.light.slice(0, 60),
          full: this.state.sessionCache.full.slice(0, 60),
        },
        draftPresetId: this.state.draftPresetId,
        defaultModel: this.state.defaultModel,
        prewarmTier: this.state.prewarmTier,
        links: this.state.links.slice(0, 40),
        sessionPins: this.state.sessionPins,
        sessionFolders: this.state.sessionFolders,
        autoRoute: this.state.autoRoute,
        collapseProcess: this.state.collapseProcess,
        chatFontScale: this.state.chatFontScale,
        themeMode: this.state.themeMode,
        remoteHost: this.state.remoteHost,
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
          sessionCache?: Partial<Record<SessionEngine, SessionSummary[]>>;
          draftPresetId?: string | null;
          defaultModel?: ModelChoice;
          prewarmTier?: PrewarmTier;
          links?: ConversationLink[];
          sessionPins?: Record<string, 'light' | 'full'>;
          sessionFolders?: Record<string, string>;
          autoRoute?: boolean;
          collapseProcess?: boolean;
          chatFontScale?: number;
          themeMode?: ThemeMode;
          remoteHost?: { url: string; name: string; hostId: string; lastSeenAt: number } | null;
        };
        if (Array.isArray(parsed.sessions) && this.state.sessions.length === 0) {
          nextPatch.sessions = parsed.sessions;
        }
        if (parsed.sessionCache && typeof parsed.sessionCache === 'object') {
          const light = parsed.sessionCache.light;
          const full = parsed.sessionCache.full;
          nextPatch.sessionCache = {
            light: Array.isArray(light) && this.state.sessionCache.light.length === 0 ? light : this.state.sessionCache.light,
            full: Array.isArray(full) && this.state.sessionCache.full.length === 0 ? full : this.state.sessionCache.full,
          };
        }
        if (Array.isArray(parsed.links) && this.state.links.length === 0) {
          nextPatch.links = parsed.links.filter(
            (link): link is ConversationLink =>
              Boolean(link && typeof link.id === 'string' && typeof link.lightSessionId === 'string'),
          );
        }
        if (parsed.sessionPins && typeof parsed.sessionPins === 'object') {
          nextPatch.sessionPins = parsed.sessionPins;
        }
        if (parsed.sessionFolders && typeof parsed.sessionFolders === 'object') {
          nextPatch.sessionFolders = parsed.sessionFolders;
        }
        if (typeof parsed.autoRoute === 'boolean') {
          nextPatch.autoRoute = parsed.autoRoute;
        }
        if (typeof parsed.collapseProcess === 'boolean') {
          nextPatch.collapseProcess = parsed.collapseProcess;
        }
        if (typeof parsed.chatFontScale === 'number' && parsed.chatFontScale >= 1) {
          nextPatch.chatFontScale = Math.min(parsed.chatFontScale, 1.3);
        }
        if (
          parsed.themeMode === 'system' ||
          parsed.themeMode === 'light' ||
          parsed.themeMode === 'dark'
        ) {
          nextPatch.themeMode = parsed.themeMode;
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
        if (
          parsed.remoteHost
          && typeof parsed.remoteHost.url === 'string'
          && typeof parsed.remoteHost.name === 'string'
          && typeof parsed.remoteHost.hostId === 'string'
        ) {
          nextPatch.remoteHost = parsed.remoteHost;
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
      if (ok) {
        await saveLightConfig(setup);
        await saveLightSetupSkipped(false);
      }
    } catch (err) {
      client?.close();
      host?.close();
      // 失败别停在「连接中」；清掉引擎链路，回退逻辑才会重新连
      this.patch({ conn: 'closed', engineKind: null });
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
      if (link === 'remote' && this.state.url.trim()) {
        this.patch({
          remoteHost: {
            url: this.state.url.trim(),
            name: caps.host.name,
            hostId: caps.host.id,
            lastSeenAt: Date.now(),
          },
        });
      }
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
      // 断开后必须回到主路由，否则 settings/files 等页会盖住 ConnectScreen
      view: 'main',
      connectModalOpen: true,
    });
    // 用户主动断开：只更新状态机，不自动重连（effects 不执行）
    this.emitEngine({ type: 'LINK_LOST', error: '已断开当前连接', now: this.now() });
  }

  /* ------------------------------------------------------------ */

  async refreshSessions(): Promise<void> {
    if (!this.client) return;
    try {
      const { sessions: incoming } = await this.client.request('sessions.list', {});
      const links = this.state.links;
      const visible: SessionSummary[] = [];
      const seen = new Set<string>();
      for (const session of incoming) {
        const link = this.linkByFullSession(session.id);
        if (link) {
          // 完整物理会话 → 逻辑条目：标题/预设用轻引擎侧，状态/preview 用完整侧
          if (seen.has(link.id)) {
            const index = visible.findIndex((item) => item.id === link.id);
            if (index >= 0) {
              visible[index] = {
                ...visible[index]!,
                status: session.status,
                updatedAt: session.updatedAt,
                preview: session.preview,
                ...(session.runningSince ? { runningSince: session.runningSince } : {}),
              };
            }
            continue;
          }
          const previous = this.state.sessions.find((item) => item.id === link.id);
          visible.push({
            ...(previous ?? { ...session, id: link.id }),
            id: link.id,
            title: link.title || session.title,
            presetId: link.presetId || session.presetId,
            status: session.status,
            updatedAt: session.updatedAt,
            preview: session.preview,
            ...(session.runningSince ? { runningSince: session.runningSince } : {}),
          });
          seen.add(link.id);
          continue;
        }
        // 任何 link 的完整会话都不单独显示（失败/孤儿也藏起来）
        if (links.some((item) => item.fullSessionId === session.id)) continue;
        if (seen.has(session.id)) continue;
        visible.push(session);
        seen.add(session.id);
      }
      // 完整引擎的 sessions.list 只有 proot 会话：把轻引擎逻辑条目留在列表里
      for (const link of links) {
        if (seen.has(link.id)) continue;
        const previous = this.state.sessions.find((item) => item.id === link.id);
        if (previous) {
          visible.push(previous);
          seen.add(link.id);
        }
      }
      visible.sort((a, b) => b.updatedAt - a.updatedAt);

      let detail = this.state.detail;
      if (detail) {
        const logicalId = this.linkForSession(detail.id)?.id ?? detail.id;
        const current = visible.find((item) => item.id === logicalId);
        if (current) {
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
      }
      this.patch({
        sessions: visible,
        ...(this.sessionEngine()
          ? { sessionCache: { ...this.state.sessionCache, [this.sessionEngine()!]: visible } }
          : {}),
        ...(detail ? { detail } : {}),
      });
      this.persistUiCache();
    } catch (err) {
      this.fail(err);
    }
  }

  private sessionEngine(): SessionEngine | null {
    if (this.state.engineKind === 'light') return 'light';
    if (this.state.engineKind === 'remote') return 'full';
    return null;
  }

  /** M2.6：当前引擎列表 + 另一个引擎的缓存，合并后给抽屉用 */
  sessionRows(): SessionRow[] {
    const current = this.sessionEngine() ?? 'light';
    const other: SessionEngine = current === 'light' ? 'full' : 'light';
    return mergeSessionRows(
      this.state.sessions,
      current,
      this.state.sessionCache[other],
      other,
    );
  }

  /** M2.6：点另一个引擎的会话先切引擎（完整会起 proot），再按原 id 打开 */
  async openSessionRow(id: string, engine: SessionEngine): Promise<void> {
    if (!this.client) return;
    const current = this.sessionEngine();
    if (current !== engine) {
      const ok = await this.switchEngine(engine);
      if (!ok) return;
    }
    await this.openSession(id);
  }

  /**
   * M2.1：官方 Web 前端的本机入口。
   *
   * 先确定要定位的完整会话（轻引擎会话无法映射到官方前端，返回首页 + 说明），
   * 再确保完整引擎在线，最后让桥下发 URL/token。token 不写日志、不落 UI cache。
   */
  async getWebFrontendTarget(options: { sessionId?: string | null } = {}): Promise<WebFrontendTarget> {
    // 冷启动直接进实验室：等缓存里的 currentId / links 恢复后再定位会话
    if (this.engineStartInFlight) await this.engineStartInFlight;
    else if (!this.engineStarted) await this.engineStart();
    // 显式传 null = 打开官方前端首页；不传才回落到当前会话
    const requested = 'sessionId' in options ? options.sessionId : this.state.currentId;
    const target = this.webSessionTargetFor(requested);
    if (this.state.engineKind !== 'remote') {
      const ok = await this.switchEngine('full');
      if (!ok) {
        throw new Error(this.state.error ?? '完整引擎没起来，打不开官方 Web 界面');
      }
    }
    const endpoint = await this.requestFull('web.session', {});
    return {
      ...endpoint,
      ...(target.id ? { sessionId: target.id } : {}),
      ...(target.note ? { note: target.note } : {}),
    };
  }

  /** 逻辑会话 → 官方 Web 能定位到的完整物理会话；轻引擎侧只给降级说明 */
  private webSessionTargetFor(logicalId: string | null | undefined): { id?: string; note?: string } {
    if (!logicalId) return {};
    const link = this.linkForSession(logicalId);
    if (link) {
      if (link.activeSide === 'full' && link.fullSessionId) return { id: link.fullSessionId };
      return { note: '当前是轻引擎会话，官方 Web 前端只能打开完整引擎页面；已打开首页。' };
    }
    if (this.state.engineKind === 'remote') return { id: logicalId };
    return { note: '当前会话不在完整引擎，已打开官方 Web 前端首页。' };
  }

  /**
   * M2.1：WebView 里点会话 / dshpalm://session 深链回到 RN。
   * 成功才切主界面；失败留在 WebView（或原页面）并返回可读错误。
   */
  async openSessionFromWebView(
    sessionId: string,
    engine: 'full' | 'light' = 'full',
  ): Promise<{ ok: boolean; error?: string }> {
    const id = sessionId.trim();
    if (!id) return { ok: false, error: 'WebView 没给出会话 id' };

    // 冷启动直接点深链：先等本地缓存/默认引擎就绪，再切目标引擎
    if (this.engineStartInFlight) await this.engineStartInFlight;
    else if (!this.engineStarted) await this.engineStart();

    const target: EngineTarget = engine === 'light' ? 'light' : 'full';
    if (target === 'full' ? this.state.engineKind !== 'remote' : this.state.engineKind !== 'light') {
      const ok = await this.switchEngine(target);
      if (!ok) {
        const error =
          target === 'full'
            ? '这个 WebView 会话属于完整引擎，但完整引擎没起来；没有切回来。'
            : '这个会话属于轻引擎，但轻引擎没连上；没有切回来。';
        this.setError(error);
        return { ok: false, error };
      }
    }

    const logicalId = this.logicalIdOf(id) ?? id;
    await this.openSession(logicalId);
    if (this.state.error) return { ok: false, error: this.state.error };

    // openSession 只改 detail/currentId；这里成功后才把用户从设置/WebView 带回会话页
    this.patch({ view: 'main', connectModalOpen: false, error: null });
    return { ok: true };
  }

  /** M2.6：完整会话 → 轻引擎继续（摘要 + 最近 8 轮 + 工具结果，原完整会话之后只读） */
  async continueFullInLight(fullSessionId: string): Promise<boolean> {
    if (this.state.engine.mode !== 'full') {
      this.setError('请先切到完整引擎，再发起「在轻引擎继续」');
      return false;
    }
    this.noteUserActivity();
    let fullDetail: SessionDetail;
    try {
      const result = await this.requestFull('sessions.get', { sessionId: fullSessionId });
      fullDetail = result.session;
    } catch (error) {
      this.fail(error);
      return false;
    }
    const userText = lastUserTextFromDetail(fullDetail);
    const assistantText = lastAssistantTextFromDetail(fullDetail);
    const handoff = buildHandoff({
      conversationId: fullSessionId,
      reason: 'continue_in_light',
      from: { engine: 'full', sessionId: fullSessionId },
      presetId: fullDetail.presetId,
      history: turnDetailToHistory(fullDetail.turns),
      turns: fullDetail.turns,
      ...(userText ? { userText } : {}),
      ...(assistantText ? { assistantText } : {}),
      limit: 8,
    });
    const seed = buildReverseSeedText(handoff);

    const switched = await this.switchToLightForHandoff();
    if (!switched) {
      this.setError('轻引擎没连上，反向交接已取消');
      return false;
    }
    try {
      const { session: imported } = await this.requestLight('sessions.import', {
        presetId: fullDetail.presetId,
        title: fullDetail.title,
        text: seed,
        handoffId: handoff.handoffId,
        seedMarker: handoff.seedMarker,
        ...(handoff.replay ? { replay: handoff.replay } : {}),
      });
      const { session: lightDetail } = await this.requestLight('sessions.get', {
        sessionId: imported.id,
      });
      const seedTurnId = findSeedTurnId(lightDetail, handoff.seedMarker);
      const link: ConversationLink = {
        id: imported.id,
        lightSessionId: imported.id,
        fullSessionId,
        title: fullDetail.title,
        presetId: fullDetail.presetId,
        activeSide: 'light',
        status: 'active',
        handoffId: handoff.handoffId,
        seedMarker: handoff.seedMarker,
        handoffDirection: 'full_to_light',
        ...(seedTurnId ? { seedTurnId } : {}),
        updatedAt: this.now(),
      };
      this.patch({
        links: upsertConversationLink(this.state.links, link),
        currentId: link.id,
        detail: mergeDetail(link, lightDetail, fullDetail),
        error: null,
      });
      await this.refreshSessions();
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  async openSession(id: string): Promise<void> {
    if (!this.client) return;
    this.noteUserActivity();
    const link = this.linkForSession(id);
    const logicalId = link?.id ?? id;
    const cached = this.detailCache.get(logicalId);
    this.detailCache.delete(logicalId);
    // 重进会话先把 currentId/detail 切过去，避免 sessions.get 期间到达的流式帧被丢
    this.patch(
      cached
        ? { busy: true, error: null, currentId: logicalId, detail: cached }
        : { busy: true, error: null },
    );

    if (link) {
      await this.openLinkedSession(link, cached);
      return;
    }

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

  /**
   * 逻辑会话重新打开：
   * - active full 且完整链路在 → 拉 proot 详情，和轻引擎缓存合并；
   * - active full 但 proot 已停 → 只读显示缓存，绝不在 light 里重放；
   * - active light → 正常拉轻引擎详情。
   */
  private async openLinkedSession(link: ConversationLink, cached?: SessionDetail): Promise<void> {
    const base = this.baseDetails.get(link.id) ?? cached ?? null;
    const logicalId = link.id;
    try {
      if (link.activeSide === 'full') {
        if (this.state.engine.mode === 'full' && link.fullSessionId) {
          const { session } = await this.client!.request('sessions.get', {
            sessionId: link.fullSessionId,
          });
          const merged = mergeDetail(link, base, session);
          this.patch({ detail: merged ?? session, currentId: logicalId, busy: false });
          if (merged) this.detailCache.set(logicalId, merged);
          if (link.fullSessionId) {
            const { approvals } = await this.client!.request('approvals.list', {
              sessionId: link.fullSessionId,
            });
            const map: Record<string, Approval> = {};
            for (const approval of approvals) map[approval.id] = approval;
            this.patch({ approvals: map });
          }
          return;
        }
        // proot 已经停了：只读缓存；没有缓存就退回轻引擎侧（同样只读）
        let detail = base ?? cached ?? null;
        if (!detail && this.state.engineKind === 'light') {
          try {
            const { session } = await this.client!.request('sessions.get', {
              sessionId: link.lightSessionId,
            });
            detail = mergeDetail(link, session, null);
          } catch {
            /* 连轻侧快照也拿不到时保持当前 detail */
          }
        }
        this.patch({ detail: detail ?? this.state.detail, currentId: logicalId, busy: false });
        return;
      }

      if (this.state.engineKind === 'light') {
        const { session } = await this.client!.request('sessions.get', {
          sessionId: link.lightSessionId,
        });
        let turns = normalizeTurns(session.turns);
        const active = session.status === 'running' || session.status === 'waiting_approval';
        const live = active
          ? cached?.turns.find((t) => t.role === 'assistant' && t.status === 'streaming')
          : undefined;
        if (live) turns = overlayLiveTurn(turns, live);
        const detail = mergeDetail(link, { ...session, turns }, null) ?? session;
        this.patch({ detail, currentId: logicalId, busy: false });
        const { approvals } = await this.client!.request('approvals.list', {
          sessionId: link.lightSessionId,
        });
        const map: Record<string, Approval> = {};
        for (const approval of approvals) map[approval.id] = approval;
        this.patch({ approvals: map });
        return;
      }
      // 完整链路上打开一个 active-light 逻辑会话：只读缓存
      this.patch({ detail: base ?? this.state.detail, currentId: logicalId, busy: false });
    } catch (err) {
      this.fail(err);
    }
  }

  closeSession(): void {
    const { detail, currentId } = this.state;
    if (detail && currentId) {
      this.detailCache.set(currentId, detail);
      const link = this.linkForSession(currentId);
      // 只有轻引擎侧的 detail 才值得作为 merge 基底；完整侧不要反向覆盖
      if (!link || link.activeSide === 'light') this.baseDetails.set(currentId, detail);
    }
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

  /** U6：全部功能页（卡片网格） */
  openFeatures(): void {
    this.patch({ view: 'features', error: null });
  }

  closeFeatures(): void {
    this.patch({ view: 'main' });
  }

  /** U8：工作区文件浏览（轻引擎和完整引擎） */
  openFiles(): void {
    this.patch({ view: 'files', error: null });
  }

  closeFiles(): void {
    this.patch({ view: 'main' });
  }

  /** E3 / 整页搜索：全文搜索会话 */
  openSearch(): void {
    this.patch({ view: 'search', error: null });
  }

  closeSearch(): void {
    this.patch({ view: 'main' });
  }

  /** U8：工作区页（轻引擎只有单工作区，先做只读概览 + 文件入口） */
  openWorkspace(): void {
    this.patch({ view: 'workspace', error: null });
  }

  closeWorkspace(): void {
    this.patch({ view: 'main' });
  }

  /** U8 只读终端 */
  openTerminal(): void {
    this.patch({ view: 'terminal', error: null });
  }

  closeTerminal(): void {
    this.patch({ view: 'main' });
  }

  /** M2.3：插件兼容矩阵（内置快照，离线可看） */
  openPlugins(): void {
    this.patch({ view: 'plugins', error: null });
  }

  closePlugins(): void {
    this.patch({ view: 'main' });
  }

  async runShell(command: string): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    ms: number;
    timedOut: boolean;
    truncated: boolean;
  }> {
    if (!this.client) throw new Error('还没连上宿主');
    return this.client.request('shell.run', { command });
  }

  async searchSessions(query: string): Promise<SessionSearchHit[]> {
    if (!this.client) throw new Error('还没连上宿主');
    const { results } = await this.client.request('sessions.search', { query });
    return results;
  }

  async listWorkspace(path = '/'): Promise<{ path: string; entries: WorkspaceEntry[] }> {
    if (!this.client) throw new Error('还没连上宿主');
    return this.client.request('fs.list', { path });
  }

  async renameWorkspace(path: string, to: string): Promise<void> {
    if (!this.client) throw new Error('还没连上宿主');
    await this.client.request('fs.rename', { path, to });
  }

  async deleteWorkspace(path: string): Promise<void> {
    if (!this.client) throw new Error('还没连上宿主');
    await this.client.request('fs.delete', { path });
  }

  /**
   * 轻引擎账号 401 的恢复路径（M2.7 最小版）：
   * 切完整引擎 → 打开设置账号卡，让用户重新登录；登录后点「切回轻引擎」会用新 token 重建轻引擎。
   */
  async recoverLightAuth(): Promise<void> {
    this.clearError();
    if (this.state.engine.mode !== 'full') {
      const ok = await this.switchEngine('full');
      if (!ok) {
        this.setError('完整引擎没起来；也可以在设置里给轻引擎配置独立 API Key。');
        return;
      }
    }
    await this.openSettings();
    this.setError('已切到完整模式：在「DeepSeek 账号」卡点「重新登录」，成功后再切回轻引擎。');
  }

  /** 账号已登录但 token 过期时，先退出再重新走 OAuth（M2.7） */
  async reloginAccount(): Promise<void> {
    await this.signOutAccount();
    await this.startAccountSignIn();
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
    try {
      const share = await intakeShare();
      if (!share) return;
      if (share.files.length > 0) this.appendIntake(share.files);
      if (share.errors?.length) this.setError(share.errors[0] ?? '有附件没能读取');
      if (share.text) this.patch({ pendingShare: { text: share.text } });
    } catch (err) {
      // 分享方没给读权限 / 文件被删：别让未捕获的 Promise 抛到红屏，给人话提示
      this.setError(err instanceof Error ? err.message : '读取分享内容失败');
    }
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
    // 轻引擎只有一条模型渠道，配置在 App 侧（SecureStore）；不能交给宿主，否则重启即丢
    if (this.state.engineKind === 'light') {
      await this.saveLightProvider(input);
      return;
    }
    if (!this.client) return;
    const { providers } = await this.client.request('providers.save', input);
    this.patch({ providers });
    // 新渠道的模型要能马上出现在会话的模型选择里
    void this.refreshModels();
  }

  /** M2.5：把 ProvidersCard 的保存落到轻引擎单渠道并重连；失败不覆盖旧配置 */
  private async saveLightProvider(input: RequestParams['providers.save']): Promise<void> {
    if (input.mode !== 'custom') {
      throw new Error('轻引擎只有一条自定义模型渠道；第三方目录请切完整引擎配置');
    }
    const setup = this.lightSetup;
    if (!setup) throw new Error('轻引擎还没配置模型渠道');
    const next = applyProviderSave(setup, {
      mode: 'custom',
      baseURL: input.baseURL,
      api: input.api,
      models: input.models,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    });
    await this.connectLight(next);
    if (this.state.engineKind !== 'light' || this.state.conn !== 'connected') {
      // connectLight 只有连上才写 SecureStore，这里恢复内存里的旧 setup 以免下次重连读错
      this.lightSetup = setup;
      throw new Error('新渠道没连上，旧配置未覆盖；检查 Base URL / API Key / 模型名');
    }
    await this.refreshProviders();
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
  /** 路由输入：附件只取分类需要的字段 */
  private routeAttachments(): Array<{ name: string; mime?: string; bytes?: number; kind: string }> {
    return this.state.pendingAttachments.map((item) => ({
      name: item.name,
      ...(item.displayName ? { displayName: item.displayName } : {}),
      ...(item.mime ? { mime: item.mime } : {}),
      ...(typeof item.bytes === 'number' ? { bytes: item.bytes } : {}),
      kind: item.kind,
    }));
  }

  private currentPin(): 'light' | 'full' | null {
    const id = this.state.currentId;
    return id ? this.state.sessionPins[id] ?? null : null;
  }

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
    // 预路由在创建会话之前：错误/不支持时不建会话、不丢草稿
    const route = routeTurn({
      text: trimmed,
      attachments: this.routeAttachments(),
      manualPin: null,
      activeFull: this.state.engine.mode === 'full',
      autoRoute: this.state.autoRoute,
      engine: this.state.engine,
    });
    if (route.target === 'blocked-unsupported') {
      this.setError(`暂不支持：${route.reason}`);
      return false;
    }
    if (
      route.override === 'light' &&
      this.state.engine.mode === 'full'
    ) {
      this.setError('反向交接（完整 → 轻）暂未支持；请点顶栏切回轻引擎后再发。');
      return false;
    }
    if (route.target === 'full' && this.state.engine.mode !== 'full') {
      const guard = canSwitch(this.state.engine, 'full');
      if (!guard.ok || !this.engineDeps.hostAvailable) {
        this.setError(
          !this.engineDeps.hostAvailable
            ? '这台设备不支持完整引擎（需要原生构建，Expo Go 不行）'
            : (guard.reason ?? '现在不能切换到完整引擎'),
        );
        return false;
      }
    }
    const outgoing = route.text;
    const presetId = this.state.draftPresetId ?? this.state.caps?.presets[0]?.id ?? 'standard';
    const draftModel = this.state.defaultModel;
    const draftPermission = this.state.defaultPermission;
    const rawTitle = outgoing || this.state.pendingAttachments[0]?.name || '新会话';
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
      if (route.target === 'full' && this.state.engine.mode !== 'full') {
        // 先有一个轻引擎源会话，再走交接；seed 里会带用户这一句
        this.patch({ busy: false });
        const ok = await this.beginHandoff({
          logicalId: session.id,
          reason: route.reason,
          userText: outgoing,
          ...(route.missing ? { missing: route.missing } : {}),
          files: this.state.pendingAttachments.filter((item) => item.status === 'ready').map(toFileRef),
          escalate: routeNeedsFullPermission(route.signals),
        });
        if (ok) this.patch({ pendingAttachments: [] });
        return ok;
      }
      return await this.send(outgoing, { skipRoute: true });
    } catch (err) {
      this.fail(err);
      return false;
    }
  }

  async send(
    text: string,
    options: { skipRoute?: boolean; route?: RouteTurnResult } = {},
  ): Promise<boolean> {
    const { currentId, detail } = this.state;
    const trimmed = text.trim();
    const stagedList = this.state.pendingAttachments.slice();
    if (!this.client || !currentId || !detail || (!trimmed && stagedList.length === 0)) return false;
    if (this.state.attaching) {
      this.setError('附件还在读取中，请稍候…');
      return false;
    }
    const link = this.linkForSession(currentId);
    // 完整侧链路断了：逻辑会话只读，绝不在轻引擎里自动重放
    if (link && isConversationReadOnly(link, this.state.engine.mode)) {
      this.setError('完整引擎已停止，这个会话只读；需要继续请在顶栏重新切到完整模式。');
      return false;
    }
    this.noteUserActivity();
    let outgoing = trimmed;
    let route = options.route;
    if (!options.skipRoute) {
      route = routeTurn({
        text: trimmed,
        attachments: this.routeAttachments(),
        manualPin: this.currentPin(),
        activeFull: this.state.engine.mode === 'full' || link?.activeSide === 'full',
        autoRoute: this.state.autoRoute,
        engine: this.state.engine,
      });
      outgoing = route.text;
      if (route.target === 'blocked-unsupported') {
        this.setError(`暂不支持：${route.reason}`);
        return false;
      }
      // 明确要「轻」但当前人在完整引擎：反向交接未做，别把消息发错引擎
      // TODO(1.4): 反向交接（完整 → 轻）按裁剪顺序后置。
      if (
        route.target === 'light' &&
        this.state.engine.mode === 'full' &&
        (route.override === 'light' || this.currentPin() === 'light')
      ) {
        this.setError('反向交接（完整 → 轻）暂未支持；请点顶栏切回轻引擎后再发。');
        return false;
      }
      // 预路由命中完整引擎且当前链路还是轻：走 Handoff（seed 带用户这句话）
      if (route.target === 'full' && this.state.engine.mode !== 'full') {
        const ok = await this.beginHandoff({
          logicalId: currentId,
          reason: route.reason,
          userText: outgoing,
          ...(route.missing ? { missing: route.missing } : {}),
          files: stagedList.filter((item) => item.status === 'ready').map(toFileRef),
          escalate: routeNeedsFullPermission(route.signals),
        });
        if (ok) this.patch({ pendingAttachments: [] });
        return ok;
      }
    }
    const physicalId = this.physicalIdFor(currentId);
    const running = detail.status === 'running' || detail.status === 'waiting_approval';
    // 附件只传路径引用；文件早已由原生收件落进 workspace/uploads
    const files = stagedList.filter((item) => item.status === 'ready').map(toFileRef);
    this.patch({ busy: true, error: null });
    try {
      const payload = {
        sessionId: physicalId,
        text: outgoing,
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

  /** 能力卡上的「用完整模式继续」：确认后交接；bash 会升级 proot 权限（F8） */
  async continueHandoff(block: Extract<Block, { kind: 'capability' }>): Promise<boolean> {
    const currentId = this.state.currentId;
    if (!currentId) return false;
    if (block.status === 'handed_off') return true;
    const callId = block.callId ?? (block.id.startsWith('cap_') ? block.id.slice(4) : undefined);
    return this.beginHandoff({
      logicalId: currentId,
      reason: 'capability_missing',
      userText: lastUserTextFromDetail(this.state.detail),
      ...(lastAssistantTextFromDetail(this.state.detail)
        ? { assistantText: lastAssistantTextFromDetail(this.state.detail) }
        : {}),
      missing: block.missing,
      ...(callId ? { blockedCallIds: [callId] } : {}),
      blockId: block.id,
      escalate: block.tool === 'bash',
    });
  }

  private markCapabilityHandedOff(blockId: string, handoffId: string): void {
    const detail = this.state.detail;
    if (!detail) return;
    let changed = false;
    const turns = detail.turns.map((turn) => {
      let blocks = turn.blocks;
      for (let i = 0; i < blocks.length; i += 1) {
        const block = blocks[i]!;
        if (block.kind !== 'capability' || block.id !== blockId) continue;
        if (blocks === turn.blocks) blocks = turn.blocks.slice();
        blocks[i] = { ...block, status: 'handed_off', handoffId };
        changed = true;
      }
      return blocks === turn.blocks ? turn : { ...turn, blocks };
    });
    if (changed) this.patch({ detail: { ...detail, turns } });
  }

  async stop(): Promise<void> {
    const { currentId } = this.state;
    if (!this.client || !currentId) return;
    try {
      await this.client.request('sessions.stop', { sessionId: this.physicalIdFor(currentId) });
    } catch (err) {
      this.fail(err);
    }
  }

  /* ------------------------ Handoff v1 ------------------------ */

  private requestLight<M extends Method>(method: M, params: RequestParams[M]): Promise<RequestResults[M]> {
    const injected = this.handoffDeps.requestLight;
    if (injected) return injected(method, params);
    if (!this.client) return Promise.reject(new Error('轻引擎还没连上'));
    return this.client.request(method, params);
  }

  private requestFull<M extends Method>(method: M, params: RequestParams[M]): Promise<RequestResults[M]> {
    const injected = this.handoffDeps.requestFull;
    if (injected) return injected(method, params);
    if (!this.client) return Promise.reject(new Error('完整引擎还没连上'));
    return this.client.request(method, params);
  }

  private switchToFullForHandoff(): Promise<boolean> {
    return this.handoffDeps.switchToFull ? this.handoffDeps.switchToFull() : this.switchEngine('full');
  }

  private switchToLightForHandoff(): Promise<boolean> {
    return this.handoffDeps.switchToLight ? this.handoffDeps.switchToLight() : this.switchEngine('light');
  }

  /**
   * 一条逻辑会话的交接入口：
   *  1. 用轻引擎历史生成 HandoffV1（确定性 id/marker）；
   *  2. 两阶段切到完整引擎（失败留在轻引擎，源会话不动）；
   *  3. models.list → create → rename → permission → model → seed 一次；
   *  4. 任一步在 seed 前失败都回滚源 currentId/detail；seed 结果不确定时先查 marker。
   *
   * 并发调用复用同一个 promise，避免重复 create。
   */
  async beginHandoff(input: BeginHandoffInput): Promise<boolean> {
    const existing = this.linkForSession(input.logicalId);
    if (existing?.status === 'active' && existing.activeSide === 'full') return true;
    if (this.handoffInFlight) return this.handoffInFlight;
    const run = this.beginHandoffInner(input).finally(() => {
      if (this.handoffInFlight === run) this.handoffInFlight = null;
    });
    this.handoffInFlight = run;
    return run;
  }

  private async beginHandoffInner(input: BeginHandoffInput): Promise<boolean> {
    const logicalId = input.logicalId;
    const sourceId = this.state.currentId;
    const sourceDetail = this.state.detail;
    if (!sourceId || !sourceDetail || sourceId !== logicalId) {
      this.setError('交接失败：当前会话不在轻引擎里');
      return false;
    }
    const guard = canSwitch(this.state.engine, 'full');
    if (!guard.ok) {
      this.setError(guard.reason ?? '现在不能切换到完整引擎');
      return false;
    }
    if (!this.engineDeps.hostAvailable) {
      this.setError('这台设备不支持完整引擎（需要原生构建，Expo Go 不行）');
      return false;
    }
    this.noteUserActivity();
    this.baseDetails.set(logicalId, sourceDetail);

    let handoff: HandoffV1;
    try {
      handoff = await this.requestLight('sessions.handoff', {
        sessionId: this.physicalIdFor(logicalId),
        reason: input.reason,
        ...(input.userText ? { userText: input.userText } : {}),
        ...(input.assistantText ? { assistantText: input.assistantText } : {}),
        ...(input.missing && input.missing.length > 0 ? { missing: input.missing } : {}),
        ...(input.blockedCallIds && input.blockedCallIds.length > 0
          ? { blockedCallIds: input.blockedCallIds }
          : {}),
        ...(input.files && input.files.length > 0 ? { files: input.files } : {}),
      });
    } catch (error) {
      this.setError(`交接包生成失败：${humanizeError(error)}`);
      return false;
    }

    // 两阶段切换：失败时 switchEngine 自己会回轻引擎，源会话只读保留
    const switched = await this.switchToFullForHandoff();
    if (!switched) {
      this.patch({ currentId: sourceId, detail: sourceDetail, busy: false });
      this.setError('完整引擎没启动起来，已留在轻引擎；草稿还在');
      return false;
    }
    // connectLocal 会把 currentId 清空，这里先把逻辑会话接回来
    this.patch({ currentId: sourceId, detail: sourceDetail, busy: true, error: null });

    let fullSessionId: string | undefined;
    let link: ConversationLink | undefined;
    try {
      /* 建会话之前先确认完整引擎有模型；没有就回滚，不留下不可用的会话 */
      const models = await this.requestFull('models.list', {});
      if (models.models.length === 0) throw new Error('完整引擎没有可用模型，交接已取消');

      const sourceModel = handoff.model.source;
      const matched = sourceModel
        ? models.models.find(
            (option) => option.provider === sourceModel.provider && option.id === sourceModel.model,
          )
        : undefined;
      const fallbackOption = models.default
        ? models.models.find(
            (option) =>
              option.provider === models.default?.provider && option.id === models.default?.model,
          ) ?? models.models[0]
        : models.models[0];
      const targetModel: ModelChoice | undefined = matched
        ? { provider: matched.provider, model: matched.id }
        : fallbackOption
          ? { provider: fallbackOption.provider, model: fallbackOption.id }
          : undefined;
      const targetPresetIds = this.state.caps?.presets.map((preset) => preset.id) ?? [];
      const presetForTarget = mapPresetForTarget(handoff.presetId, targetPresetIds);
      const targetPermission = input.escalate
        ? 'danger-full-access'
        : handoff.permission.source;

      handoff = {
        ...handoff,
        presetForTarget,
        permission: {
          source: handoff.permission.source,
          target: targetPermission,
          escalated: input.escalate === true,
        },
        model: {
          ...handoff.model,
          ...(targetModel ? { target: targetModel } : {}),
          matched: Boolean(matched),
          ...(!matched && targetModel
            ? { notice: `模型已切换为 ${targetModel.model}（完整引擎没有 ${sourceModel?.model ?? '原模型'}）` }
            : {}),
        },
      };

      const title = (input.title ?? sourceDetail.title).trim() || '交接会话';
      const created = await this.requestFull('sessions.create', {
        presetId: presetForTarget,
        title,
      });
      fullSessionId = created.session.id;

      link = {
        id: logicalId,
        lightSessionId: sourceDetail.id,
        fullSessionId,
        title,
        presetId: handoff.presetId,
        activeSide: 'full',
        status: 'pending',
        handoffId: handoff.handoffId,
        seedMarker: handoff.seedMarker,
        handoffDirection: 'light_to_full',
        updatedAt: this.now(),
      };
      // 立刻持久化 fullSessionId：后面失败也能从 ui-cache 找到孤儿会话
      this.setLink(link);

      await this.requestFull('sessions.rename', { sessionId: fullSessionId, title });
      await this.requestFull('sessions.setPermission', {
        sessionId: fullSessionId,
        preset: targetPermission,
      });
      if (targetModel) {
        await this.requestFull('sessions.setModel', {
          sessionId: fullSessionId,
          provider: targetModel.provider,
          model: targetModel.model,
        });
      }

      const seedText = buildSeedText(handoff);
      try {
        await this.requestFull('sessions.send', { sessionId: fullSessionId, text: seedText });
      } catch (sendError) {
        // 发送结果不确定：先看完整引擎里有没有 seed marker；有就说明其实落地了。
        // 绝不重发 seed（更不会重放已完成的工具）。
        let seeded = false;
        try {
          const got = await this.requestFull('sessions.get', { sessionId: fullSessionId });
          seeded = detailHasSeedMarker(got.session, handoff.seedMarker);
        } catch {
          /* 查不到就按失败回滚 */
        }
        if (!seeded) throw sendError;
      }

      let fullDetail: SessionDetail | null = null;
      try {
        fullDetail = (await this.requestFull('sessions.get', { sessionId: fullSessionId })).session;
      } catch {
        /* seed 已发成功；拿不到快照就先显示轻引擎侧，等下一次 refresh */
      }
      const seedTurnId = findSeedTurnId(fullDetail, handoff.seedMarker);
      const activeLink: ConversationLink = {
        ...link,
        status: 'active',
        activeSide: 'full',
        ...(seedTurnId ? { seedTurnId } : {}),
        updatedAt: this.now(),
      };
      this.setLink(activeLink);
      const merged = mergeDetail(activeLink, sourceDetail, fullDetail);
      const running = merged?.status === 'running' || merged?.status === 'waiting_approval';
      this.patch({
        currentId: logicalId,
        detail: merged ?? sourceDetail,
        busy: running,
        error: null,
      });
      if (merged) {
        this.detailCache.set(logicalId, merged);
        this.baseDetails.set(logicalId, sourceDetail);
      }
      if (input.blockId) this.markCapabilityHandedOff(input.blockId, handoff.handoffId);
      // 用户已经选择继续完整引擎：清掉「留在轻引擎」的 pin，避免下一条又走反向交接报错
      if (this.state.sessionPins[logicalId]) this.setSessionPin(null, logicalId);
      void this.refreshSessions();
      this.persistUiCache();
      return true;
    } catch (error) {
      // TODO(1.4): 失败的 full 会话目前只标记 failed 并隐藏，孤儿清理后置。
      if (link) {
        this.setLink({
          ...link,
          status: 'failed',
          activeSide: 'light',
          lastError: humanizeError(error),
        });
      }
      await this.rollbackHandoff(sourceId, sourceDetail, error);
      return false;
    }
  }

  /** seed 之前的失败：回轻引擎、恢复源会话；完整会话只留在 link 里，列表不显示 */
  private async rollbackHandoff(
    sourceId: string,
    sourceDetail: SessionDetail,
    error: unknown,
  ): Promise<void> {
    const message = humanizeError(error);
    this.patch({ busy: false, error: null });
    if (this.state.engine.mode === 'full') {
      try {
        await this.switchToLightForHandoff();
      } catch {
        /* switchEngine 自己会把错误写进 state */
      }
    }
    this.baseDetails.set(sourceId, sourceDetail);
    this.detailCache.set(sourceId, sourceDetail);
    if (this.state.engine.mode === 'full') {
      // 回轻失败：至少别让下一条消息发到错误的物理会话
      this.patch({ currentId: null, detail: sourceDetail, busy: false, error: message });
      return;
    }
    this.patch({ currentId: sourceId, detail: sourceDetail, busy: false, error: message });
  }

  /* ------------------------ 会话管理 ------------------------ */

  async renameSession(id: string, title: string): Promise<void> {
    if (!this.client) return;
    const logicalId = this.linkForSession(id)?.id ?? id;
    try {
      const { session } = await this.client.request('sessions.rename', {
        sessionId: this.physicalIdFor(logicalId),
        title,
      });
      const sessions = this.state.sessions.map((s) =>
        s.id === logicalId ? { ...s, title: session.title } : s,
      );
      const link = this.linkForSession(logicalId);
      if (link) this.setLink({ ...link, title: session.title });
      const patch: Partial<AppState> = { sessions };
      if (this.state.detail?.id === logicalId) {
        patch.detail = { ...this.state.detail, title: session.title };
      }
      this.patch(patch);
    } catch (err) {
      this.fail(err);
    }
  }

  async setSessionPinned(id: string, pinned: boolean): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.request('sessions.pin', {
        sessionId: this.physicalIdFor(this.linkForSession(id)?.id ?? id),
        pinned,
      });
      await this.refreshSessions();
    } catch (err) {
      this.fail(err);
    }
  }

  async archiveSession(id: string, archived: boolean): Promise<void> {
    if (!this.client) return;
    const logicalId = this.linkForSession(id)?.id ?? id;
    try {
      await this.client.request('sessions.archive', {
        sessionId: this.physicalIdFor(logicalId),
        archived,
      });
      if (archived && this.state.currentId === logicalId) this.closeSession();
      await this.refreshSessions();
    } catch (err) {
      this.fail(err);
    }
  }

  /** E3：删除会话（轻引擎实现；完整引擎会报不支持） */
  async deleteSession(id: string): Promise<void> {
    if (!this.client) return;
    const logicalId = this.linkForSession(id)?.id ?? id;
    const physicalId = this.physicalIdFor(logicalId);
    try {
      await this.client.request('sessions.delete', { sessionId: physicalId });
      if (this.state.currentId === logicalId) this.closeSession();
      const links = this.state.links.filter(
        (link) =>
          link.id !== logicalId &&
          link.lightSessionId !== physicalId &&
          link.fullSessionId !== physicalId,
      );
      if (links.length !== this.state.links.length) this.patch({ links });
      if (this.state.sessionFolders[logicalId]) {
        const folders = { ...this.state.sessionFolders };
        delete folders[logicalId];
        this.patch({ sessionFolders: folders });
      }
      this.baseDetails.delete(logicalId);
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

  /** 新建工作区：完整引擎可创建在 /root/work 下，轻引擎显式不支持 */
  async createWorkspace(path: string): Promise<boolean> {
    if (!this.client) return false;
    const name = path.trim();
    if (!name) return false;
    try {
      const { workspace } = await this.client.request('workspaces.create', { path: name });
      const workspaces = [...this.state.workspaces.filter((item) => item.id !== workspace.id), workspace];
      this.patch({ workspaces, error: null });
      return true;
    } catch (error) {
      this.setError(humanizeError(error));
      return false;
    }
  }

  /** 完整引擎返回的 detail 只取状态/模型/权限，逻辑会话的合并回合不能丢 */
  private mergePhysicalDetail(session: SessionDetail): SessionDetail {
    const current = this.state.detail;
    const link = this.linkForSession(this.state.currentId);
    if (!link || !current || current.id !== link.id) return session;
    return {
      ...current,
      status: session.status,
      updatedAt: session.updatedAt,
      ...(session.model ? { model: session.model } : {}),
      permission: session.permission,
      contract: session.contract,
    };
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
      const { session } = await this.client.request('sessions.setPermission', {
        sessionId: this.physicalIdFor(currentId),
        preset,
      });
      this.patch({ detail: this.mergePhysicalDetail(session) });
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
        sessionId: this.physicalIdFor(currentId),
        provider,
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      });
      this.patch({ detail: this.mergePhysicalDetail(session), modelSheetOpen: false });
    } catch (err) {
      this.fail(err);
    }
  }

  private approvalSnapshot(approvalId: string): Approval | undefined {
    for (const turn of this.state.detail?.turns ?? []) {
      for (const block of turn.blocks) {
        if (block.kind === 'approval' && block.approvalId === approvalId && block.snapshot) {
          return block.snapshot;
        }
      }
    }
    return undefined;
  }

  /** 把处理结果写进时间线快照；后续即使 approvals 被清掉，也只画只读卡 */
  private markApprovalResolved(approvalId: string, resolution: ApprovalResolution): void {
    const detail = this.state.detail;
    if (!detail) return;
    const base = this.state.approvals[approvalId] ?? this.approvalSnapshot(approvalId);
    let turns = detail.turns;
    let changed = false;
    for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
      const turn = turns[turnIndex]!;
      let blocks = turn.blocks;
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        const block = blocks[blockIndex]!;
        if (block.kind !== 'approval' || block.approvalId !== approvalId) continue;
        const snapshot = base ?? block.snapshot;
        if (!snapshot) continue;
        if (blocks === turn.blocks) blocks = turn.blocks.slice();
        blocks[blockIndex] = {
          ...block,
          snapshot: withApprovalResolution(snapshot, resolution),
        };
        changed = true;
      }
      if (blocks !== turn.blocks) {
        if (turns === detail.turns) turns = detail.turns.slice();
        turns[turnIndex] = { ...turn, blocks };
      }
    }
    if (changed) this.patch({ detail: { ...detail, turns } });
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
      this.markApprovalResolved(approvalId, {
        decision,
        by: 'user',
        at: Date.now(),
      });
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
        sessionId: this.physicalIdFor(currentId),
        callId,
        answers: [{ id: questionId, selected, ...(custom ? { custom } : {}) }],
      });
      this.markApprovalResolved(callId, {
        decision: 'approve',
        selected,
        ...(custom ? { custom } : {}),
        by: 'user',
        at: Date.now(),
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
  engineStart(): Promise<void> {
    if (this.engineStartInFlight) return this.engineStartInFlight;
    if (this.engineStarted) return Promise.resolve();
    this.engineStarted = true;
    const run = this.engineStartInner().finally(() => {
      if (this.engineStartInFlight === run) this.engineStartInFlight = null;
    });
    this.engineStartInFlight = run;
    return run;
  }

  private async engineStartInner(): Promise<void> {
    await this.hydrateLocalCache();
    void ensureNotificationPermission();
    // 没有轻引擎配置、且用户上次选了「先用完整模式」：直接起完整引擎，不再弹配置页
    if (!this.lightSetup) {
      const saved = await this.engineDeps.loadLightConfig().catch(() => null);
      if (!saved) {
        const skipped = await this.engineDeps.loadLightSetupSkipped().catch(() => false);
        if (skipped && this.engineDeps.hostAvailable) {
          this.emitEngine({ type: 'BOOT', tier: this.state.prewarmTier, now: this.now() });
          this.startIdleSweeper();
          const ok = await this.switchEngine('full');
          if (ok) {
            this.closeLightSetup();
            this.closeSettings();
          } else {
            this.openLightSetup();
          }
          return;
        }
      }
    }

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
   * 用户没配轻引擎渠道、选择「先用完整模式」：
   * 记住选择（下次启动直接起 proot），关掉配置页并切完整引擎。
   */
  async skipLightSetup(): Promise<void> {
    this.closeLightSetup();
    this.closeSettings();
    this.patch({ error: null });
    await saveLightSetupSkipped(true);
    if (!this.engineDeps.hostAvailable) {
      this.setError('这台设备不支持完整引擎（需要原生构建，Expo Go 不行）');
      return;
    }
    const ok = await this.switchEngine('full');
    if (!ok) {
      this.setError('完整引擎没启动起来，稍后可以再试，或重新配置轻引擎。');
    }
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
    // 用户主动切轻引擎：清掉「先用完整模式」的跳过标记，下次启动回轻引擎
    if (target === 'light') void saveLightSetupSkipped(false);
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
            this.setError(
              this.state.lightSetupOpen
                ? '先配置轻引擎渠道（或登录 DeepSeek 账号），再切回轻引擎'
                : '切回轻引擎失败，仍停留在完整引擎',
            );
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

  /**
   * 解析轻引擎渠道：
   * 1. 已保存的配置；
   * 2. 没有配置时，若 dsh 账号已登录，自动用账号 token（不需要 API Key）；
   * 3. 账号 token 过期/不存在，才要求用户配置或切完整模式。
   */
  private async resolveLightSetup(): Promise<LightEngineSetup | null> {
    let setup = this.lightSetup ?? (await this.engineDeps.loadLightConfig());
    // 旧版本保存的账号配置可能没有 authMode/authToken：只要没有 API Key，就补账号 token，
    // 否则会连上一个“无鉴权”的轻引擎，发消息必 401（2026-11-05 真机就是 auth=none）。
    if (setup && !setup.apiKey && !setup.authToken) {
      const token = await loadAccountToken();
      if (token) setup = { ...setup, authMode: 'account', authToken: token };
    }
    if (setup?.authMode === 'account') {
      // 每次重连都重读账号 token：浏览器 OAuth 重登后旧 token 已失效（M2.7）
      setup = withFreshAccountToken(setup, await loadAccountToken());
    }
    if (!setup) {
      const token = await loadAccountToken();
      if (token) {
        setup = {
          baseURL: 'https://api.deepseek.com/v1',
          apiKey: '',
          model: 'deepseek-chat',
          providerName: 'DeepSeek 账号',
          authMode: 'account',
          authToken: token,
        };
      }
    }
    return setup;
  }

  /** 确保轻引擎在线（已经连着就什么都不做）；返回是否就绪 */
  private async connectLightEffect(): Promise<boolean> {
    if (this.state.engine.lightReady && this.state.engineKind === 'light' && this.state.conn === 'connected') {
      return true;
    }
    const setup = await this.resolveLightSetup();
    if (!setup) {
      // 没有渠道 = 轻引擎不可用；先回到未连接态，再引导配置（只自动弹一次）
      this.patch({ conn: 'closed', engineKind: null });
      this.emitEngine({
        type: 'LIGHT_FAILED',
        error: '轻引擎还没配置模型渠道：填 Base URL / 模型 / Key，或先用完整模式。',
      });
      if (!this.lightSetupPrompted) {
        const skipped = await this.engineDeps.loadLightSetupSkipped().catch(() => false);
        if (!skipped) {
          this.lightSetupPrompted = true;
          this.openLightSetup();
        }
      }
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
    // 有逻辑会话正在完整侧时，空闲回收不能停 proot；用户显式切换/停止除外
    if (
      reason === 'idle' &&
      this.state.links.some((link) => link.activeSide === 'full' && link.status === 'active')
    ) {
      return;
    }
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
        // 旧会话属于已经死掉的完整引擎：普通完整会话清 currentId 只读；
        // 逻辑会话保留 currentId（activeSide=full 在轻引擎里天然只读），绝不自动重放。
        const activeLink = this.state.links.some(
          (link) => link.activeSide === 'full' && link.status === 'active',
        );
        this.suppressAutoOpen = true;
        if (!activeLink) this.patch({ currentId: null });
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
    void notifyEvent(title, body, `approval:${approval.sessionId}:${approval.id}`, {
      sessionId: approval.sessionId,
      approvalId: approval.id,
      engine: this.state.engineKind === 'light' ? 'light' : 'full',
    });
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
        { sessionId: data.sessionId, engine: this.state.engineKind === 'light' ? 'light' : 'full' },
      );
      return;
    }
    void notifyEvent(
      `回复完成 · ${sessionTitle}`,
      data.preview || '已完成本轮回复，点击查看',
      `run:${data.sessionId}`,
      { sessionId: data.sessionId, engine: this.state.engineKind === 'light' ? 'light' : 'full' },
    );
  }

  /* ------------------------------------------------------------ */

  /** 完整引擎的物理会话事件 → 逻辑条目；绝不让第二个会话出现在列表里 */
  private applyLinkedSessionUpdate(link: ConversationLink, incoming: SessionSummary): void {
    const existing = this.state.sessions.find((item) => item.id === link.id);
    const summary: SessionSummary = {
      ...(existing ?? { ...incoming, id: link.id }),
      id: link.id,
      title: link.title || incoming.title,
      presetId: link.presetId || incoming.presetId,
      status: incoming.status,
      updatedAt: incoming.updatedAt,
      preview: incoming.preview,
      ...(incoming.runningSince ? { runningSince: incoming.runningSince } : {}),
    };
    const sessions = existing
      ? this.state.sessions.map((item) => (item.id === link.id ? summary : item))
      : [summary, ...this.state.sessions];
    let detail = this.state.detail;
    if (detail && detail.id === link.id) {
      let next = { ...detail, ...summary };
      if (incoming.status !== 'running' && incoming.status !== 'waiting_approval') {
        next = finalizeDetailTurn(next, incoming.updatedAt);
      }
      detail = next;
    }
    this.patch({ sessions, ...(detail ? { detail } : {}) });
    this.persistUiCache();
  }

  /** 事件统一在这里落到状态上；UI 不做任何拼装 */
  private applyEvent(name: string, rawData: any): void {
    let data = rawData;

    // 完整物理会话 id → 逻辑 id；UI/store 的其余逻辑只认逻辑会话
    if ((name === 'session.created' || name === 'session.updated') && rawData?.session) {
      const incoming = rawData.session as SessionSummary;
      const link = this.linkByFullSession(incoming.id);
      if (link) {
        this.applyLinkedSessionUpdate(link, incoming);
        return;
      }
    } else if (rawData && typeof rawData === 'object') {
      const physical =
        (typeof rawData.sessionId === 'string' ? rawData.sessionId : undefined) ??
        (rawData.approval && typeof rawData.approval.sessionId === 'string'
          ? rawData.approval.sessionId
          : undefined);
      const link = physical ? this.linkByFullSession(physical) : undefined;
      if (link) {
        data = {
          ...rawData,
          ...(typeof rawData.sessionId === 'string' ? { sessionId: link.id } : {}),
          ...(rawData.approval
            ? { approval: { ...rawData.approval, sessionId: link.id } }
            : {}),
        };
      }
    }

    const { detail, currentId } = this.state;

    switch (name) {
      case 'capability.missing': {
        // capability block 已经通过 block.appended 进时间线；这里只做兜底：
        // 如果 UI 漏了事件，把 block 补进当前回合。
        const block = data.block as Extract<Block, { kind: 'capability' }> | undefined;
        if (!block || !detail || data.sessionId !== currentId) return;
        const has = detail.turns.some((turn) =>
          turn.blocks.some((item) => item.kind === 'capability' && item.id === block.id),
        );
        if (has) return;
        const turns = detail.turns.slice();
        for (let i = turns.length - 1; i >= 0; i -= 1) {
          if (turns[i]?.role !== 'assistant') continue;
          turns[i] = { ...turns[i]!, blocks: [...turns[i]!.blocks, block] };
          this.patch({ detail: { ...detail, turns } });
          return;
        }
        return;
      }

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
        const block: Block = {
          kind: 'approval',
          id: 'ap-' + approval.id,
          approvalId: approval.id,
          snapshot: approval,
        };
        const turns = d.turns.slice();
        let placed = false;
        for (let i = turns.length - 1; i >= 0; i--) {
          const t = turns[i]!;
          if (t.role !== 'assistant') continue;
          if (t.blocks.some((b) => b.kind === 'approval' && b.approvalId === approval.id)) {
            turns[i] = {
              ...t,
              blocks: t.blocks.map((b) =>
                b.kind === 'approval' && b.approvalId === approval.id
                  ? { ...b, snapshot: approval }
                  : b
              ),
            };
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
        const approvalId = data.approvalId as string;
        const current = this.state.approvals[approvalId] ?? this.approvalSnapshot(approvalId);
        const decision: ApprovalDecision =
          data.decision === 'approve' || data.decision === 'reject'
            ? data.decision
            : current?.resolution?.decision ?? 'reject';
        this.markApprovalResolved(approvalId, {
          decision,
          ...(Array.isArray(data.selected) ? { selected: data.selected as string[] } : {}),
          ...(typeof data.custom === 'string' ? { custom: data.custom } : {}),
          by: typeof data.by === 'string' ? data.by : 'user',
          at: typeof data.at === 'number' ? data.at : Date.now(),
        });
        const next = { ...this.state.approvals };
        delete next[approvalId];
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
        // 401/429/断网这类模型错误要在聊天页横幅里给人话，而不是只在回合上显示“出错”
        const runError = (data as { error?: unknown }).error;
        const banner =
          runError != null && data.sessionId === currentId
            ? { error: humanizeError(runError) }
            : {};
        this.patch({
          approvals,
          sessions,
          busy: false,
          ...(nextDetail ? { detail: nextDetail } : {}),
          ...banner,
        });
        return;
      }

      default:
        return;
    }
  }
}

export const store = new Store();
