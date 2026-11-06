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
  /** 配对页展示的短指纹（不是密钥） */
  fingerprint?: string;
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

/**
 * 官方 dsh web 前端的本机入口（M2.1）。
 * 只有桥的客户端是 loopback、且上游 dsh 也是 loopback 时才会下发 token。
 */
export interface WebFrontendEndpoint {
  /** 带 token 的官方前端地址（token 在 query 里） */
  url: string;
  /** 不含 token 的 origin，展示/校验用 */
  origin: string;
  /** 引擎启动 token；只在本机 loopback 下发 */
  token: string;
  local: true;
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
  /** 是否置顶（轻引擎；抽屉里单独一组） */
  pinned?: boolean;
}

/** 会话正文搜索命中（E3 / 整页搜索） */
export interface SessionSearchHit {
  sessionId: string;
  title: string;
  /** 第一处命中附近的短片段，已去掉换行 */
  snippet: string;
  updatedAt: number;
  matches: number;
}

export type ToolState = 'running' | 'done' | 'error';

export type Block =
  | { kind: 'text'; id: string; text: string; done?: boolean }
  | { kind: 'thinking'; id: string; text: string; done?: boolean }
  | {
      kind: 'tool';
      id: string;
      /** 工具调用 id；快照和实时用同一个 callId 对齐 */
      callId?: string;
      name: string;
      /** 一行摘要，例如「读取 src/app.ts」 */
      summary: string;
      state: ToolState;
      detail?: string;
    }
  | {
      kind: 'approval';
      id: string;
      approvalId: string;
      /**
       * 审批/提问卡的自包含快照。
       * 历史回合里 approvals 已经清空，靠这份快照才能还原问题与回答；
       * 新宿主会在 turn 里落快照，旧数据没有就退回 tool block 解析。
       */
      snapshot?: Approval;
    }
  | {
      kind: 'capability';
      id: string;
      code: 'capability_missing';
      tool: string;
      /** 一行摘要，例如「执行 python 脚本」 */
      summary: string;
      /** 为什么轻引擎做不了 */
      reason: string;
      /** 缺的能力，界面上做胶囊展示，例如 ['python'] */
      missing: string[];
      /** bash 的原始命令（审批前就要展示） */
      command?: string;
      /** 交接后回填，用于把卡片和 ConversationLink 对上 */
      handoffId?: string;
      status: 'pending' | 'handed_off';
      /** 原始工具调用 id；Handoff 要按它从历史里取回参数（1.4 新增） */
      callId?: string;
    }
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

/**
 * 审批/提问处理完的结果。
 *
 * 提问用 selected/custom 记录用户答了什么；审批只看 decision。
 * by 记录是谁结束的（user / timeout / stop / run_finished），
 * 历史卡据此区分「已回答 / 已跳过 / 已拒绝」。
 */
export interface ApprovalResolution {
  decision: ApprovalDecision;
  selected?: string[];
  custom?: string;
  by?: string;
  at?: number;
}

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
  /**
   * 已处理结果。没有这个字段就是待回答；
   * 历史回合/快照带上它后，界面只画只读问答卡。
   */
  resolution?: ApprovalResolution;
}

/* ------------------------------------------------------------------ *
 * 事件
 * ------------------------------------------------------------------ */

export interface EventPayloads {
  'engine.status': { state: 'starting' | 'ready' | 'stopped' | 'error'; detail?: string };
  'session.created': { session: SessionSummary };
  'session.updated': { session: SessionSummary };
  /** 首次配对成功；hostId 用于把设备密钥写到对应宿主名下 */
  'device.paired': { key: string; hostId?: string };
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
    reason: 'done' | 'stopped' | 'error' | 'capability_missing';
    usage?: { inputTokens?: number; outputTokens?: number };
    error?: string;
    preview?: string;
  };
  /**
   * 轻引擎工具执行前发现缺能力：这一轮不执行任何剩余工具，
   * 时间线里已经插入 capability block，历史里已补 [CAPABILITY_MISSING] 结果。
   * （1.4 新增；PROTOCOL_VERSION 保持 1，旧客户端忽略未知事件即可。）
   */
  'capability.missing': {
    sessionId: string;
    runId: string;
    turnId: string;
    callId: string;
    tool: string;
    missing: string[];
    reason: string;
    command?: string;
    block: Extract<Block, { kind: 'capability' }>;
  };
  'approval.requested': { approval: Approval };
  'approval.resolved': {
    approvalId: string;
    decision: ApprovalDecision;
    by: string;
    /** 提问回答（旧宿主可能不带；界面只在本地知道答案时补） */
    selected?: string[];
    custom?: string;
    at?: number;
  };
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
 * 附件（原生收件后的路径引用）
 * ------------------------------------------------------------------ */

/**
 * 原生收件管线落到 `workspace/uploads/<hash16>-<name>` 后的文件引用。
 *
 * 这是 1.3 起的附件主路径：只传路径，不再传 base64。
 * 轻引擎把它拼成 `/workspace/<relPath>`，完整引擎拼成 `/root/work/<relPath>`。
 */
export interface FileRef {
  /** 手机上的绝对路径（调试用；模型只消费 relPath） */
  path: string;
  /** 引擎工作区里的相对路径，必须形如 `uploads/<file>` */
  relPath: string;
  /** 落盘用的文件名（已 sanitize，不含 hash 前缀） */
  name: string;
  /** 用户看到的原始文件名 */
  displayName?: string;
  mime?: string;
  bytes?: number;
  /** SHA-256（hex），用于去重 */
  hash?: string;
}

/** 工作区文件浏览（U8）：一个目录项 */
export interface WorkspaceEntry {
  name: string;
  kind: 'file' | 'dir';
  size: number;
  /** 毫秒时间戳 */
  mtime: number;
}

/* ------------------------------------------------------------------ *
 * Handoff v1（轻引擎 → 完整引擎）
 *
 * 只在回合边界交接：已执行工具原样带走，未执行步骤只出现在
 * pendingIntent 里；seed 文本交给完整引擎，由它继续。
 * ------------------------------------------------------------------ */

export interface HandoffRecentTurn {
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  /** assistant 的原始 tool_calls（参数是模型输出的原始 JSON 字符串） */
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  toolCallId?: string;
  name?: string;
}

export interface HandoffCompletedStep {
  callId: string;
  name: string;
  summary: string;
}

export interface HandoffBlockedCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

/** 结构化回放：一个块 = 原文里的 text / thinking / tool 卡片 */
export type HandoffReplayBlock =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string }
  | {
      kind: 'tool';
      id: string;
      /** 原始工具调用 id；结果按它和 assistant.tool_calls 对齐 */
      callId: string;
      name: string;
      /** 模型输出的原始 JSON 字符串（可能为空对象） */
      arguments: string;
      summary: string;
      state: 'running' | 'done' | 'error';
      detail?: string;
    };

export interface HandoffReplayTurn {
  id: string;
  role: 'user' | 'assistant';
  createdAt: number;
  status: 'streaming' | 'done' | 'stopped' | 'error';
  blocks: HandoffReplayBlock[];
}

/**
 * M2.2：可重建的紧凑事件序列。
 *
 * 轻引擎按 turns/history 原生重建；完整引擎没有事件导入 API，
 * 只能把同一份序列渲染成 seed 文本（明确降级，不假装原生回放）。
 */
export interface HandoffReplay {
  schema: typeof HANDOFF_REPLAY_SCHEMA;
  source: 'light-turns' | 'history';
  turns: HandoffReplayTurn[];
  stats: { turns: number; blocks: number; tools: number; truncated: boolean };
  /** 明确告诉接收侧哪些块或能力没有原生回放 */
  unsupported: string[];
}

export const HANDOFF_REPLAY_SCHEMA = 'dsh-handoff-replay/v1' as const;

export interface HandoffV1 {
  /** v1 = 摘要/最近 8 条；v2 = 额外带 replay 结构化回放 */
  version: 1 | 2;
  /** 逻辑会话 id（= 轻引擎会话 id） */
  conversationId: string;
  reason: string;
  from: { engine: 'light' | 'full'; sessionId: string; hostId?: string };
  presetId: string;
  /** 完整引擎里映射后的预设 */
  presetForTarget: string;
  permission: { source: string; target: string; escalated: boolean };
  model: {
    source?: ModelChoice;
    target?: ModelChoice;
    matched: boolean;
    /** 模型被换掉时给用户看的说明 */
    notice?: string;
  };
  channel: { baseURL: string; model: string; apiKeyRef: string };
  summary: string;
  /** 最近 8 条消息（含工具调用与结果） */
  recentTurns: HandoffRecentTurn[];
  completedSteps: HandoffCompletedStep[];
  fileRefs: FileRef[];
  pendingIntent: {
    kind: string;
    userText: string;
    assistantText?: string;
    blocked: HandoffBlockedCall[];
    missing?: string[];
  };
  /** 确定性 hash（同一会话 + 同一待执行步骤得到同一个 id） */
  handoffId: string;
  seedMarker: string;
  createdAt: number;
  /** v2：结构化 turn/block/tool 回放；v1 旧包没有这个字段 */
  replay?: HandoffReplay;
}

/* ------------------------------------------------------------------ *
 * 请求 / 响应
 * ------------------------------------------------------------------ */

export interface RequestParams {
  'capabilities.get': Record<string, never>;
  'sessions.list': { cursor?: string; limit?: number };
  'sessions.get': { sessionId: string };
  'sessions.create': { presetId: string; workspaceId?: string; title?: string };
  /**
   * 轻引擎专用：直接建一个带 seed 用户消息的会话（不触发模型），
   * 供完整引擎 → 轻引擎的 Handoff 继续使用（M2.6）。
   *
   * M2.2 起可带 replay：先按结构化事件重建 turns/history，再追加 seed。
   * handoffId 用于幂等：同一个交接包重复导入返回同一个会话，不重复建回合。
   */
  'sessions.import': {
    presetId?: string;
    title?: string;
    text: string;
    workspaceId?: string;
    handoffId?: string;
    seedMarker?: string;
    replay?: HandoffReplay;
  };
  'sessions.send': { sessionId: string; text: string; attachments?: string[]; files?: FileRef[] };
  'sessions.steer': { sessionId: string; text: string; attachments?: string[]; files?: FileRef[] };
  /**
   * 轻引擎专用：把当前会话的历史打包成 HandoffV1。
   * 完整引擎返回 unsupported（交接只会从轻引擎发起）。
   */
  'sessions.handoff': {
    sessionId: string;
    reason?: string;
    /** 用户这一轮的原话（预路由交接时还没进历史） */
    userText?: string;
    assistantText?: string;
    missing?: string[];
    /** 能力门拦截的调用 id；宿主按 id 从历史里取回精确参数 */
    blockedCallIds?: string[];
    /** 本轮待发附件（预路由时还没进历史） */
    files?: FileRef[];
    /** 最近多少条消息，默认 8 */
    recentTurns?: number;
  };
  'sessions.stop': { sessionId: string };
  'sessions.setPreset': { sessionId: string; presetId: string };
  /** 列出宿主机上可用的模型 */
  'models.list': Record<string, never>;
  /** 注册/新建一个工作区（完整引擎会创建 /root/work 下的相对路径） */
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

  /**
   * 官方 dsh web 前端的本机入口（M2.1）。
   * 非 loopback 客户端 / 非 loopback 上游返回 unsupported，不下发 token。
   */
  'web.session': Record<string, never>;

  /** 工作区文件浏览（U8；轻引擎 / 完整引擎均实现） */
  'fs.list': { path?: string };
  'fs.rename': { path: string; to: string };
  'fs.delete': { path: string };

  /** 会话管理：改名、置顶、归档（真宿主接口） */
  'sessions.rename': { sessionId: string; title: string };
  'sessions.pin': { sessionId: string; pinned: boolean };
  'sessions.archive': { sessionId: string; archived: boolean };
  /** 删除会话（E3；完整引擎直接删 dsh 会话目录，运行中拒绝） */
  'sessions.delete': { sessionId: string };
  /** 正文搜索（E3；完整引擎扫本地会话日志） */
  'sessions.search': { query: string; limit?: number };
  /** 只读终端（U8；写操作会被沙箱拒绝） */
  'shell.run': { command: string };
}

export interface RequestResults {
  'capabilities.get': Capabilities;
  'sessions.list': { sessions: SessionSummary[]; nextCursor?: string };
  'sessions.get': { session: SessionDetail };
  'sessions.create': { session: SessionSummary };
  'sessions.import': { session: SessionSummary };
  'sessions.send': { accepted: true; runId: string; queued?: boolean };
  'sessions.steer': { accepted: true };
  'sessions.handoff': HandoffV1;
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
  'web.session': WebFrontendEndpoint;
  'fs.list': { path: string; entries: WorkspaceEntry[] };
  'fs.rename': { ok: true };
  'fs.delete': { ok: true };
  'sessions.rename': { session: SessionDetail };
  'sessions.pin': { ok: true };
  'sessions.archive': { ok: true };
  'sessions.delete': { ok: true };
  'sessions.search': { results: SessionSearchHit[] };
  'shell.run': {
    stdout: string;
    stderr: string;
    exitCode: number;
    ms: number;
    timedOut: boolean;
    truncated: boolean;
  };
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
    | 'capability_missing'
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
