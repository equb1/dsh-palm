/**
 * dsh-palm 协议契约 v1
 *
 * 设计原则（见 docs/02-architecture.md）：
 *  1. 引擎是独立进程，UI 是纯客户端；这一份类型是双方唯一的约定。
 *  2. 客户端连上来先协商能力，界面不写 `if (platform === ...)`。
 *  3. 流式内容是「块」，不是字符串。增量修复由引擎做，客户端只收已修好的块。
 *  4. 审批必须自包含：只看这一张卡就能决定。
 */

export const PROTOCOL_VERSION = 1 as const;

/* ------------------------------------------------------------------ *
 * 基础
 * ------------------------------------------------------------------ */

export type HostKind = 'phone' | 'desktop' | 'server';

export interface HostInfo {
  id: string;
  kind: HostKind;
  /** 展示用名字，例如「小陈的手机」 */
  name: string;
  platform: string;
  engineVersion: string;
}

/** 客户端连上来后必须读取；界面按这个渲染，禁止按平台硬编码 */
export interface Capabilities {
  protocol: number;
  host: HostInfo;
  events: string[];
  actions: ActionName[];
  presets: Preset[];
  workspaces: Workspace[];
  limits: {
    maxAttachmentMB: number;
    /** 跨宿主取文件的单次上限（见 docs/02-architecture.md「文件引用」） */
    maxFetchFileMB: number;
  };
}

export type ActionName =
  | 'approve'
  | 'reject'
  | 'steer'
  | 'stop'
  | 'switch_preset'
  | 'create_session';

/* ------------------------------------------------------------------ *
 * 能力契约（见 docs/03-workspaces-presets.md）
 * ------------------------------------------------------------------ */

export type Surface = 'camera' | 'share_intake' | 'gallery' | 'microphone' | 'notifications';

export interface CapabilityContract {
  /** 工具白名单：模型只能看见这里列出的工具 */
  tools: string[];
  fs?: Array<{ path: string; mode: 'ro' | 'rw' }>;
  net?: 'allow' | 'deny';
  exec?: 'deny' | 'python-limited';
  surfaces?: Surface[];
}

export interface Preset {
  id: string;
  name: string;
  /** 单字或 emoji，列表里当图标用 */
  glyph: string;
  tagline: string;
  version: string;
  builtin: boolean;
  contract: CapabilityContract;
  modelPolicy: {
    /** 能力需求，不是模型 id —— 见 D11「别把预设硬绑模型」 */
    needs?: string[];
    prefer?: string;
  };
}

export interface Workspace {
  id: string;
  name: string;
  /** 宿主上的真实路径；跨宿主不可访问 */
  root: string;
  presetIds: string[];
}

/* ------------------------------------------------------------------ *
 * 会话
 * ------------------------------------------------------------------ */

export type SessionStatus = 'idle' | 'running' | 'waiting_approval' | 'error' | 'offline';

export interface SessionSummary {
  id: string;
  title: string;
  presetId: string;
  workspaceId: string;
  hostId: string;
  status: SessionStatus;
  updatedAt: number;
  unread: number;
  preview: string;
  /** 运行中时的开始时间，用于顶部计时 */
  runningSince?: number;
}

export type ToolState = 'running' | 'done' | 'error';

export type Block =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string }
  | {
      kind: 'tool';
      id: string;
      name: string;
      /** 一行摘要，例如「读取 src/app.ts」 */
      summary: string;
      state: ToolState;
      detail?: string;
    }
  | { kind: 'approval'; id: string; approvalId: string }
  | { kind: 'image'; id: string; ref: string; mime: string };

export type TurnStatus = 'streaming' | 'done' | 'stopped' | 'error';

export interface Turn {
  id: string;
  /** 这一轮属于哪次 run；同一 run 的快照/实时回合才能合并 */
  runId?: string;
  role: 'user' | 'assistant';
  createdAt: number;
  blocks: Block[];
  status: TurnStatus;
  usage?: { inputTokens?: number; outputTokens?: number };
  meta?: { durationMs?: number; steps?: number };
}

export interface ModelChoice {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface ModelOption {
  provider: string;
  /** provider 的显示名，例如 DeepSeek */
  providerName: string;
  id: string;
  name: string;
  description?: string;
  /** 这个模型支持哪些思考档位；空表示不支持 */
  efforts?: Array<{ id: string; name: string; description?: string }>;
  defaultEffort?: string;
}

export interface PermissionOption {
  value: string;
  name: string;
  description?: string;
}

/* ------------------------------------------------------------------ *
 * 账号（见 docs/12-model-login.md）
 *
 * 手机自己是宿主时，OAuth 的回调就落在本机引擎的端口上，
 * 系统浏览器和引擎在同一台设备上 —— 登录不需要电脑。
 * ------------------------------------------------------------------ */

export type AccountPhase =
  | 'initializing'
  | 'waiting-browser'
  | 'exchanging'
  | 'committing'
  | 'succeeded'
  | 'cancelled'
  | 'expired'
  | 'failed';

export interface AccountAttempt {
  id: string;
  phase: AccountPhase;
  /** 只在 waiting-browser 阶段给：拿它去开系统浏览器 */
  authorizeUrl?: string;
  expiresAt?: number;
  errorCode?: 'expired' | 'no-response' | 'network' | 'protocol' | 'storage';
}

export interface AccountUser {
  phone?: string;
  phoneNumber?: string;
  /** 宿主如果已经脱敏，直接透传 */
  maskedPhone?: string;
  email?: string;
  name?: string;
}

export interface AccountState {
  status: 'signed-out' | 'credential-stored';
  attempt: AccountAttempt | null;
  links: { usageUrl: string; topUpUrl: string };
  /** 账号资料；官方宿主登录后会带手机号，轻引擎没有 */
  user?: AccountUser;
}

export interface SessionDetail extends SessionSummary {
  turns: Turn[];
  /** 当前会话选的模型；没选过就是宿主默认 */
  model?: ModelChoice;
  /** 当前权限预设：read-only / workspace-write / danger-full-access / auto / custom */
  permission?: string;
  /** 会话当前的契约（可能被「会话内升级」改过） */
  contract: CapabilityContract;
}

/* ------------------------------------------------------------------ *
 * 模型提供商（见 docs/12-model-login.md）
 *
 * 和 dsh 官方一致：账号登录是主路径，API Key 走"渠道"。
 * 一个渠道 = 协议 + Base URL + Key + 模型列表，存在宿主上。
 * ------------------------------------------------------------------ */

/** 线协议标识，和 settings.yaml 里的值一致 */
export type ProviderProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

export interface ProviderModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ProviderRow {
  /** 路由 id，例如 openrouter */
  id: string;
  displayName: string;
  api: string;
  baseURL: string;
  models: ProviderModel[];
  /** Key 存哪个 ref；没有就是不用 Key */
  apiKeyEnv?: string;
  configured: boolean;
  /** catalog = 内置目录里的提供商（协议/地址/模型由适配器给）；custom = 自己填的 */
  source: 'custom' | 'catalog';
}

/** 内置目录里可选的一个提供商 */
export interface CatalogProvider {
  id: string;
  displayName: string;
  defaultBaseURL?: string;
  /** 这个提供商认哪些环境变量（仅作提示） */
  env?: string[];
}

/* ------------------------------------------------------------------ *
 * 审批（见 docs/01-product.md「能不能只看锁屏那一屏就做决定」）
 * ------------------------------------------------------------------ */

export type RiskLevel = 'low' | 'medium' | 'high';
export type ApprovalDecision = 'approve' | 'reject';

export interface Approval {
  id: string;
  sessionId: string;
  runId: string;
  createdAt: number;
  /**
   * 'approval'（默认）= 危险操作要批准；'question' = Agent 在问用户选哪个。
   * 两者走同一个展示位，但回答方式不同：前者是 allow/deny，后者是选选项。
   */
  kind?: 'approval' | 'question';
  /** 一句话说清要发生什么 */
  title: string;
  /** 将要执行的原文（命令 / 工具名 + 参数） */
  command?: string;
  risk: RiskLevel;
  /** 人类可读的风险说明，最多两行 */
  summary: string;
  /** 可选的改动摘要 */
  diff?: string;
  actions: ApprovalDecision[];
  expiresAt?: number;
  /** kind === 'question' 时的可选项 */
  options?: Array<{ label: string; description?: string }>;
  /** 能不能多选 */
  multiSelect?: boolean;
  /** 选项所属的问题 id，回答时要带回去 */
  questionId?: string;
  /**
   * 确认型提问（引擎带 intent）才有：approve 是"批准"那个选项的文案。
   * 普通提问没有这个字段，界面就不该标推荐。
   */
  intent?: { kind: string; approve: string };
  /** 这次要审阅的内容（确认型提问会带） */
  detail?: string;
}

/* ------------------------------------------------------------------ *
 * 事件
 * ------------------------------------------------------------------ */

export interface EventPayloads {
  'engine.status': { state: 'starting' | 'ready' | 'stopped' | 'error'; detail?: string };
  'session.created': { session: SessionSummary };
  'session.updated': { session: SessionSummary };
  'run.started': { sessionId: string; runId: string; turnId: string };
  'block.appended': { sessionId: string; runId: string; turn: Turn };
  'block.delta': {
    sessionId: string;
    runId: string;
    turnId: string;
    blockId: string;
    op: 'append' | 'replace';
    text: string;
  };
  'block.updated': { sessionId: string; runId: string; turnId: string; block: Block };
  'run.finished': {
    sessionId: string;
    runId: string;
    reason: 'done' | 'stopped' | 'error';
    usage?: { inputTokens?: number; outputTokens?: number };
    error?: string;
    preview?: string;
  };
  'approval.requested': { approval: Approval };
  'approval.resolved': { approvalId: string; decision: ApprovalDecision; by: string };
  /** 账号状态变化（登录流程每个阶段都会推一次） */
  'account.updated': { account: AccountState };
  'job.progress': { jobId: string; pct: number; note?: string };
  'job.done': {
    jobId: string;
    ref?: string;
    mime?: string;
    file?: { name: string; size: number };
    error?: string;
  };
}

export type EventName = keyof EventPayloads;

export interface EngineEvent<K extends EventName = EventName> {
  type: 'event';
  v: number;
  event: K;
  seq: number;
  data: EventPayloads[K];
}

/* ------------------------------------------------------------------ *
 * 请求 / 响应
 * ------------------------------------------------------------------ */

export interface RequestParams {
  'capabilities.get': Record<string, never>;
  'sessions.list': { cursor?: string; limit?: number };
  'sessions.get': { sessionId: string };
  'sessions.create': { presetId: string; workspaceId?: string; title?: string };
  'sessions.send': { sessionId: string; text: string; attachments?: string[] };
  'sessions.steer': { sessionId: string; text: string; attachments?: string[] };
  'sessions.stop': { sessionId: string };
  'sessions.setPreset': { sessionId: string; presetId: string };
  /** 列出宿主机上可用的模型 */
  'models.list': Record<string, never>;
  /** 注册/新建一个工作区（path 必须在宿主上存在） */
  'workspaces.create': { path: string };
  /** 上传一个附件，拿到回执后可以带进 sessions.send */
  'attachments.upload': { sessionId: string; data: string; name?: string };
  /** 宿主支持的权限预设 */
  'permissions.list': Record<string, never>;
  /** 切会话的权限预设（沙箱 + 审批策略一起换） */
  'sessions.setPermission': { sessionId: string; preset: string };
  /** 切会话的模型（写进会话事件，持久） */
  'sessions.setModel': { sessionId: string; provider: string; model: string; reasoningEffort?: string };
  'approvals.list': { sessionId?: string };
  'approvals.resolve': { approvalId: string; decision: ApprovalDecision };
  /** 回答 ask_user_question（Agent 在问用户选哪个） */
  'questions.answer': {
    sessionId: string;
    /** 工具调用 id，也就是 Approval.id */
    callId: string;
    /** 每个问题一条，selected 是选中的选项 label */
    answers: Array<{ id: string; selected: string[]; custom?: string }>;
  };
  'presets.list': Record<string, never>;
  'workspaces.list': Record<string, never>;
  /** 模型凭据：查状态 / 写入（存在宿主上，手机不留） */
  'credentials.describe': { refs: string[] };
  'credentials.set': { ref: string; value: string };
  /** 删除某个凭据（真引擎用 credentials/unset，set 传空值会被拒） */
  'credentials.unset': { ref: string };
  /** 读账号状态（未登录 / 已存凭据 + 正在进行的登录尝试） */
  'account.state': Record<string, never>;
  /**
   * 开始浏览器登录。
   * 回调地址由宿主自己决定（本机模式下就是引擎自己的 loopback），
   * 客户端只负责把返回的 authorizeUrl 交给系统浏览器。
   */
  'account.signIn': Record<string, never>;
  'account.cancelSignIn': { attemptId: string };
  'account.signOut': Record<string, never>;

  /** 宿主上已配置的模型提供商（不含 DeepSeek 账号） */
  'providers.list': Record<string, never>;
  /** 内置目录（可选的第三方提供商） */
  'providers.catalog': Record<string, never>;
  /** 用 Base URL + Key 去服务商拉模型列表 */
  'providers.discover': { baseURL: string; api: ProviderProtocol; apiKey?: string };
  /** 新建或更新一个提供商；apiKey 为空表示沿用原来的 */
  'providers.save':
    | {
        /** custom：自己填协议/地址/模型 */
        mode: 'custom';
        id: string;
        displayName?: string;
        baseURL: string;
        api: ProviderProtocol;
        models: ProviderModel[];
        apiKey?: string;
      }
    | {
        /** catalog：从内置目录选，只填 Key（可选改地址） */
        mode: 'catalog';
        id: string;
        baseURL?: string;
        apiKey: string;
      };
  'providers.remove': { id: string };

  /** 会话管理：改名、置顶、归档（真宿主接口） */
  'sessions.rename': { sessionId: string; title: string };
  'sessions.pin': { sessionId: string; pinned: boolean };
  'sessions.archive': { sessionId: string; archived: boolean };
}

export interface RequestResults {
  'capabilities.get': Capabilities;
  'sessions.list': { sessions: SessionSummary[]; nextCursor?: string };
  'sessions.get': { session: SessionDetail };
  'sessions.create': { session: SessionSummary };
  'sessions.send': { accepted: true; runId: string };
  'sessions.steer': { accepted: true };
  'sessions.stop': { accepted: true };
  'sessions.setPreset': { session: SessionDetail };
  'models.list': { models: ModelOption[]; default?: ModelChoice };
  'sessions.setModel': { session: SessionDetail };
  'permissions.list': { options: PermissionOption[]; default?: string };
  'attachments.upload': { receiptId: string; name?: string };
  'workspaces.create': { workspace: Workspace };
  'sessions.setPermission': { session: SessionDetail };
  'approvals.list': { approvals: Approval[] };
  'approvals.resolve': { accepted: true };
  'questions.answer': { accepted: true };
  'presets.list': { presets: Preset[] };
  'workspaces.list': { workspaces: Workspace[] };
  'credentials.describe': { credentials: Record<string, { configured: boolean; writable: boolean }> };
  'credentials.set': { ok: true };
  'credentials.unset': { ok: true };
  'account.state': { account: AccountState };
  'account.signIn': { account: AccountState };
  'account.cancelSignIn': { account: AccountState };
  'account.signOut': { account: AccountState };
  'providers.list': { providers: ProviderRow[] };
  'providers.catalog': { providers: CatalogProvider[] };
  'providers.discover': { models: ProviderModel[] };
  'providers.save': { providers: ProviderRow[] };
  'providers.remove': { providers: ProviderRow[] };
  'sessions.rename': { session: SessionDetail };
  'sessions.pin': { ok: true };
  'sessions.archive': { ok: true };
}

export type Method = keyof RequestParams;

export interface RequestMessage<M extends Method = Method> {
  type: 'req';
  v: number;
  id: string;
  method: M;
  params: RequestParams[M];
}

export type ResponseMessage =
  | { type: 'res'; v: number; id: string; ok: true; result: unknown }
  | { type: 'res'; v: number; id: string; ok: false; error: ProtocolError };

export interface ProtocolError {
  code:
    | 'bad_request'
    | 'not_found'
    | 'unsupported'
    | 'busy'
    | 'unauthorized'
    | 'internal';
  message: string;
  /** 能直接告诉用户怎么办的一句话 */
  hint?: string;
}

export type ServerMessage = EngineEvent | ResponseMessage;

/* ------------------------------------------------------------------ *
 * 工具函数
 * ------------------------------------------------------------------ */

export function isEvent(msg: ServerMessage): msg is EngineEvent {
  return msg.type === 'event';
}

export function isResponse(msg: ServerMessage): msg is ResponseMessage {
  return msg.type === 'res';
}

/** 单从 payload 判断这条事件是否与某个会话相关（用于路由） */
export function eventSessionId(data: unknown): string | undefined {
  if (data && typeof data === 'object') {
    const sid = (data as { sessionId?: unknown }).sessionId;
    if (typeof sid === 'string') return sid;
    const session = (data as { session?: { id?: unknown } }).session;
    if (session && typeof session.id === 'string') return session.id;
  }
  return undefined;
}
