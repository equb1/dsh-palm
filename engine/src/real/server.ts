/**
 * 真引擎桥：对外说「我们的协议」，对内调真 dsh 的 HTTP/WS。
 *
 * 这一层就是 docs/02-architecture.md 里的"桥接层"——
 * UI 永远只连这里，dsh 换版本时改的是桥，不是界面。
 */
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

import type {
  AccountState,
  Capabilities,
  CatalogProvider,
  ProviderModel,
  ProviderRow,
  Method,
  Approval,
  Block,
  ModelOption,
  Preset,
  ProtocolError,
  RequestParams,
  SessionDetail,
  SessionSummary,
  Turn,
  Workspace,
} from '../../../app/src/protocol';
import { PROTOCOL_VERSION } from '../../../app/src/protocol';
import { DshRealClient, type RealSessionListItem } from './dshClient';
import { projectRecords, type RealRecord } from './project';
import { promptWithProotFiles } from './promptParts';
import { canonicalRunId, canonicalTurnId, liveBlockId, mergeLiveTurn } from '../../../app/src/protocol/turns';
import {
  buildWebFrontendEndpoint,
  isLoopbackAddress,
  WebFrontendError,
} from '../../../app/src/lib/webFrontend';
import { DeviceStore } from './devices';

export interface RealBridgeOptions {
  /** 真 dsh 的根地址，例如 http://127.0.0.1:8899 */
  baseUrl: string;
  /** 启动时打印的那个 token */
  token: string;
  port?: number;
  /** 配对码；传空字符串表示关闭鉴权（只在本机调试时用） */
  pairCode?: string;
  /** 设备密钥文件路径；不给就不发设备密钥，只认配对码 */
  devicesFile?: string;
}

const HOST_ID = 'host-real-dsh';

let seq = 0;
const clients = new Set<WebSocket>();

function broadcast<K extends string>(event: K, data: unknown): void {
  seq += 1;
  const msg = { type: 'event', v: PROTOCOL_VERSION, event, seq, data };
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}

function presetFromId(id: string, isDefault?: boolean): Preset {
  const known: Record<string, { name: string; glyph: string; tagline: string }> = {
    standard: { name: '标准', glyph: '标', tagline: '宿主预设 · standard' },
    minimal: { name: '精简', glyph: '简', tagline: '宿主预设 · minimal' },
    ptc: { name: 'PTC', glyph: 'P', tagline: '宿主预设 · ptc' },
    cordis: { name: 'Cordis', glyph: 'C', tagline: '宿主预设 · cordis' },
  };
  const meta = known[id] ?? { name: id, glyph: id.slice(0, 1).toUpperCase(), tagline: '宿主预设' };
  return {
    id,
    name: meta.name,
    glyph: meta.glyph,
    tagline: isDefault ? `${meta.tagline}（默认）` : meta.tagline,
    version: 'host',
    builtin: true,
    // 真宿主的工具面我们不知道，也没有工具白名单的概念 —— 如实留空，别假装知道
    contract: { tools: [], net: 'allow' },
    modelPolicy: {},
  };
}

function basename(p: string | undefined): string {
  if (!p) return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** 用户回合的展示文案：附件计数与模型看到的正文分开算 */
function userDisplayText(cleanText: string, rawText: string, extraCount: number): string {
  if (cleanText.length > 0) return extraCount > 0 ? `${cleanText}\n[已附带 ${extraCount} 个文件]` : rawText;
  return extraCount > 0 ? `[已发送 ${extraCount} 个附件]` : rawText;
}

/** 工具参数可能是 JSON 字符串或对象；实时 tool 行也要有可读摘要 */
function summarizeToolArgs(raw: unknown): string {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return String(value).replace(/\s+/g, ' ').trim().slice(0, 60);
    }
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const key of ['query', 'command', 'cmd', 'path', 'file_path', 'filePath', 'url', 'text', 'prompt']) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) return v.replace(/\s+/g, ' ').trim().slice(0, 60);
    }
    const first = Object.values(o).find((v) => typeof v === 'string' && v.trim());
    if (typeof first === 'string') return first.replace(/\s+/g, ' ').trim().slice(0, 60);
  }
  return '';
}

function toSummary(item: RealSessionListItem): SessionSummary {
  const v = item.projections?.values;
  const title = v?.title?.trim();
  const stats = v?.sessionStats;
  const bits: string[] = [];
  if (stats?.turns) bits.push(`${stats.turns} 轮`);
  if (stats?.steps) bits.push(`${stats.steps} 步`);
  const preview = bits.length > 0 ? bits.join(' · ') : basename(v?.workingDirectory ?? item.cwd);
  return {
    id: item.sessionId,
    title: title && title.length > 0 ? title : '(未命名会话)',
    presetId: v?.agentPreset ?? 'standard',
    workspaceId: basename(v?.workingDirectory ?? item.cwd) || 'workspace',
    hostId: HOST_ID,
    status: item.running ? 'running' : 'idle',
    updatedAt: item.updatedAt,
    unread: 0,
    preview,
  };
}

export interface RealBridge {
  port: number;
  close(): Promise<void>;
}

export async function startRealBridge(options: RealBridgeOptions): Promise<RealBridge> {
  const client = new DshRealClient(options.baseUrl, options.token);
  await client.login();

  type PendingEvent = {
    eventId: string;
    agentId: string;
    sessionId: string;
    kind: 'approval' | 'question';
    /** 一次提问可能带多个问题，作答时必须每个都给一条 */
    questionIds?: string[];
    /** 待决卡片本体，重进会话时原样返回给客户端 */
    approval?: Approval;
  };
  /** 等待本客户端作答的 waterfall 事件，key 用 eventId（同时也是 Approval.id） */
  const pendingEvents = new Map<string, PendingEvent>();
  let eventClientId = '';
  let eventsDispose: (() => void) | null = null;

  /**
   * 把 $events 流里的 waterfall 帧翻成我们协议里的 approval.requested。
   * 只有这个通道能在"等待窗口内"作答；userQuestions/answer 只能补答超时后的。
   */
  function startEvents(): void {
    eventsDispose = client.openEvents((frame) => {
      const type = String(frame.type ?? '');
      if (type === 'ready') {
        eventClientId = String(frame.clientId ?? '');
        return;
      }
      if (type !== 'waterfall') return;

      const eventId = String(frame.eventId ?? '');
      const agentId = String(frame.agentId ?? '');
      const event = String(frame.event ?? '');
      const request = (frame.request ?? {}) as Record<string, unknown>;
      if (!eventId) return;

      if (event === 'user-questions/request') {
        const list = Array.isArray(request.questions) ? (request.questions as Array<Record<string, any>>) : [];
        const q = list[0] ?? {};
        const options = Array.isArray(q.options)
          ? (q.options as Array<Record<string, any>>)
              .map((o) => ({
                label: String(o.label ?? ''),
                description: typeof o.description === 'string' ? o.description : undefined,
              }))
              .filter((o) => o.label.length > 0)
          : [];
        const approval: Approval = {
          id: eventId,
          sessionId: agentId,
          runId: '',
          createdAt: Date.now(),
          kind: 'question',
          title: typeof q.header === 'string' && q.header.length > 0 ? q.header : '需要你选一下',
          summary: String(q.question ?? ''),
          risk: 'low',
          actions: [],
          options,
          multiSelect: q.multiSelect === true,
          questionId: String(q.id ?? ''),
          ...(q.intent && typeof q.intent === 'object'
            ? {
                intent: {
                  kind: String((q.intent as Record<string, unknown>).kind ?? ''),
                  approve: String((q.intent as Record<string, unknown>).approve ?? ''),
                },
              }
            : {}),
          ...(typeof q.detail === 'string' ? { detail: q.detail } : {}),
        };
        pendingEvents.set(eventId, {
          eventId,
          agentId,
          sessionId: agentId,
          kind: 'question',
          questionIds: list.map((item) => String(item.id ?? '')),
          approval,
        });
        broadcast('approval.requested', { approval });
        return;
      }

      if (event === 'approval/request') {
        // 实测字段：{ toolName, callId?, reason?: string, displayReason?: { zh?, en? } }
        const toolName = String(request.toolName ?? 'tool');
        const rawReason = typeof request.reason === 'string' ? request.reason : '';
        const display = (request.displayReason ?? {}) as Record<string, unknown>;
        const summary =
          (typeof display.zh === 'string' && display.zh) ||
          (typeof display.en === 'string' && display.en) ||
          rawReason ||
          '这个操作需要你确认';
        const approval: Approval = {
          id: eventId,
          sessionId: agentId,
          runId: '',
          createdAt: Date.now(),
          kind: 'approval',
          title: '要执行：' + toolName,
          command: rawReason || undefined,
          risk: 'medium',
          summary,
          actions: ['approve', 'reject'],
        };
        pendingEvents.set(eventId, {
          eventId,
          agentId,
          sessionId: agentId,
          kind: 'approval',
          approval,
        });
        broadcast('approval.requested', { approval });
      }
    });
  }

  /** 回答一个 waterfall 事件 */
  async function answerEvent(approvalId: string, outcome: { kind: 'result'; value?: unknown } | { kind: 'next' }): Promise<boolean> {
    const pending = pendingEvents.get(approvalId);
    if (!pending) return false;
    await client.submitEventResult({ clientId: eventClientId, eventId: pending.eventId, outcome });
    pendingEvents.delete(approvalId);
    broadcast('approval.resolved', { sessionId: pending.sessionId, approvalId });
    return true;
  }

  startEvents();

  /* ---------------- 账号：本机模式下的浏览器 OAuth ---------------- */

  let accountWatchDispose: (() => void) | null = null;

  /** 把宿主给的账号快照收窄成我们协议里的形状（脏数据直接丢掉） */
  function asAccountState(value: unknown): AccountState | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (v.status !== 'signed-out' && v.status !== 'credential-stored') return null;
    const rawAttempt = v.attempt;
    const attempt =
      rawAttempt && typeof rawAttempt === 'object'
        ? (() => {
            const a = rawAttempt as Record<string, unknown>;
            if (typeof a.id !== 'string' || typeof a.phase !== 'string') return null;
            return {
              id: a.id,
              phase: a.phase,
              ...(typeof a.authorizeUrl === 'string' ? { authorizeUrl: a.authorizeUrl } : {}),
              ...(typeof a.expiresAt === 'number' ? { expiresAt: a.expiresAt } : {}),
              ...(typeof a.errorCode === 'string' ? { errorCode: a.errorCode } : {}),
            } as AccountState['attempt'];
          })()
        : null;
    const links = (v.links ?? {}) as Record<string, unknown>;
    const rawUser = (v.user ?? v.profile) as Record<string, unknown> | undefined;
    const user = {
      ...(rawUser && typeof rawUser === 'object' && typeof rawUser.phone === 'string'
        ? { phone: rawUser.phone }
        : {}),
      ...(rawUser && typeof rawUser === 'object' && typeof rawUser.phoneNumber === 'string'
        ? { phoneNumber: rawUser.phoneNumber }
        : {}),
      ...(rawUser && typeof rawUser === 'object' && typeof rawUser.maskedPhone === 'string'
        ? { maskedPhone: rawUser.maskedPhone }
        : {}),
      ...(rawUser && typeof rawUser === 'object' && typeof rawUser.email === 'string'
        ? { email: rawUser.email }
        : {}),
      ...(rawUser && typeof rawUser === 'object' && typeof rawUser.name === 'string'
        ? { name: rawUser.name }
        : {}),
      ...(typeof v.phone === 'string' ? { phone: v.phone } : {}),
      ...(typeof v.phoneNumber === 'string' ? { phoneNumber: v.phoneNumber } : {}),
      ...(typeof v.maskedPhone === 'string' ? { maskedPhone: v.maskedPhone } : {}),
      ...(typeof v.email === 'string' ? { email: v.email } : {}),
    };
    return {
      status: v.status,
      attempt,
      links: {
        usageUrl: typeof links.usageUrl === 'string' ? links.usageUrl : 'https://platform.deepseek.com/usage',
        topUpUrl: typeof links.topUpUrl === 'string' ? links.topUpUrl : 'https://platform.deepseek.com/top_up',
      },
      ...(user && Object.keys(user).length > 0 ? { user } : {}),
    };
  }

  /**
   * 订阅宿主上的 `account/watch`。
   *
   * `authorizeUrl` 是 startSignIn 之后才生成的，HTTP 调用当场拿不到，
   * 只能从这个流里收——所以登录过程中界面必须看到它。
   */
  function startAccountWatch(): void {
    if (accountWatchDispose) return;
    accountWatchDispose = client.openStream('account/watch', {}, (value) => {
      const next = asAccountState(value);
      if (!next) return;
      emitAccount(next);
    });
  }

  /**
   * 登录回调必须落在"浏览器够得着"的 loopback 地址上。
   *
   * 本机模式：浏览器和引擎在同一台手机上，用引擎自己的地址就行。
   * 连电脑模式：浏览器在手机上、回调在电脑上，这条路走不通——
   * 那时登录本来也不该由手机发起（用宿主自己的界面登录，手机只读 status）。
   */
  function callbackOrigin(): string | null {
    let url: URL;
    try {
      url = new URL(options.baseUrl);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:') return null;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return `${url.protocol}//${url.hostname}:${url.port || '80'}`;
  }

  /** 账号 RPC 都要带客户端身份（宿主的平台请求头由它派生） */
  const accountClient = () => ({
    version: '0.1.0',
    locale: 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  });

  /** 同一条账号快照只推一次：流和显式广播会重，界面不该因此重渲染 */
  let lastAccountJson = '';
  function emitAccount(account: AccountState): void {
    const json = JSON.stringify(account);
    if (json === lastAccountJson) return;
    lastAccountJson = json;
    broadcast('account.updated', { account });
  }

  /** 老宿主没有账号方法时，把网关的 invocation-unavailable 翻成人话 */
  async function accountRpc<T>(method: string, args: unknown = {}): Promise<T> {
    try {
      return await client.rpc<T>(method, args);
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (message.includes('invocation-unavailable') || message.includes('404')) {
        throw Object.assign(new Error('这个宿主的版本还不支持账号登录'), {
          code: 'unsupported' satisfies ProtocolError['code'],
          hint: '先在上面填 API Key 用着；或者把宿主上的 dsh 升级到支持账号的版本。',
        });
      }
      throw err;
    }
  }

  /* ---------------- 模型提供商（llm-pi-ai） ---------------- */

  type SettingsNamespace = {
    ns: string;
    value?: Record<string, unknown>;
    user?: Record<string, unknown>;
    base?: Record<string, unknown>;
    revision?: number;
  };

  async function describeNamespace(ns: string): Promise<SettingsNamespace | undefined> {
    const d = await client.rpc<{ namespaces?: SettingsNamespace[] }>('settings/describe', {});
    return (d.namespaces ?? []).find((n) => n.ns === ns);
  }

  function normalizeModel(raw: unknown): ProviderModel | null {
    if (!raw || typeof raw !== 'object') return null;
    const m = raw as Record<string, unknown>;
    if (typeof m.id !== 'string' || m.id.length === 0) return null;
    return {
      id: m.id,
      ...(typeof m.name === 'string' ? { name: m.name } : {}),
      ...(typeof m.contextWindow === 'number' ? { contextWindow: m.contextWindow } : {}),
      ...(typeof m.maxTokens === 'number' ? { maxTokens: m.maxTokens } : {}),
    };
  }

  /** 和官方 UI 一致：路由 id → 凭据 ref */
  function keyRefFor(id: string): string {
    return id.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY';
  }

  /** 内置目录（llm/listConfigurableProviders 里挂在 llm-pi-ai 下的那些） */
  let catalogCache: CatalogProvider[] | null = null;
  async function catalogProviders(): Promise<CatalogProvider[]> {
    if (catalogCache) return catalogCache;
    const list = await client.rpc<Array<Record<string, unknown>>>('llm/listConfigurableProviders', {});
    catalogCache = list
      .filter((p) => p.settingsNs === 'llm-pi-ai' && typeof p.provider === 'string')
      .map((p) => {
        const auth = (p.nativeAuth ?? {}) as { env?: unknown };
        return {
          id: String(p.provider),
          displayName: typeof p.displayName === 'string' ? p.displayName : String(p.provider),
          ...(typeof p.defaultBaseURL === 'string' ? { defaultBaseURL: p.defaultBaseURL } : {}),
          ...(Array.isArray(auth.env) ? { env: auth.env.filter((e): e is string => typeof e === 'string') } : {}),
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    return catalogCache;
  }

  /** 读 llm-pi-ai 里已添加的提供商，补上目录归属、模型和 Key 状态 */
  async function providerRows(): Promise<ProviderRow[]> {
    const ns = await describeNamespace('llm-pi-ai');
    const providers = (ns?.value?.providers ?? {}) as Record<string, Record<string, unknown>>;
    const catalog = await catalogProviders().catch(() => [] as CatalogProvider[]);
    const catalogById = new Map(catalog.map((c) => [c.id, c]));

    // 目录型提供商的模型来自 modelCatalog（适配器给），自定义渠道的模型存在 settings 里
    const catalog2 = await client
      .rpc<{ groups?: Array<{ id?: string; models?: Array<Record<string, unknown>> }> }>('session/modelCatalog', {})
      .catch(() => ({ groups: [] }));
    const modelsByProvider = new Map<string, ProviderModel[]>();
    for (const group of catalog2.groups ?? []) {
      if (typeof group.id !== 'string') continue;
      modelsByProvider.set(
        group.id,
        (group.models ?? []).map(normalizeModel).filter((m): m is ProviderModel => m != null),
      );
    }

    const rows: ProviderRow[] = Object.entries(providers).map(([id, p]) => {
      const meta = catalogById.get(id);
      const stored = Array.isArray(p.models)
        ? p.models.map(normalizeModel).filter((m): m is ProviderModel => m != null)
        : [];
      return {
        id,
        displayName:
          typeof p.displayName === 'string' && p.displayName.length > 0
            ? p.displayName
            : (meta?.displayName ?? id),
        api: typeof p.api === 'string' ? p.api : 'openai-completions',
        baseURL:
          typeof p.baseURL === 'string' ? p.baseURL : (meta?.defaultBaseURL ?? ''),
        models: stored.length > 0 ? stored : (modelsByProvider.get(id) ?? []),
        ...(typeof p.apiKeyEnv === 'string' && p.apiKeyEnv.length > 0 ? { apiKeyEnv: p.apiKeyEnv } : {}),
        configured: p.apiKeyEnv == null,
        source: meta ? 'catalog' : 'custom',
      };
    });

    const refs = rows.map((r) => r.apiKeyEnv).filter((r): r is string => typeof r === 'string');
    if (refs.length > 0) {
      const status = await client
        .rpc<Record<string, { configured?: boolean }>>('credentials/describe', { refs })
        .catch(() => ({}) as Record<string, { configured?: boolean }>);
      for (const row of rows) {
        if (row.apiKeyEnv) row.configured = status[row.apiKeyEnv]?.configured === true;
      }
    }
    return rows;
  }

  const [presetList, sessionList] = await Promise.all([
    client.listAgentPresets().catch(() => ({ presets: [] as Array<{ id: string; isDefault?: boolean }> })),
    client.listSessions().catch(() => ({ items: [] as RealSessionListItem[] })),
  ]);

  console.log(
    `  已连上真 dsh：${sessionList.items.length} 个会话，${presetList.presets.length} 个宿主预设`,
  );

  const presets = presetList.presets.map((p) => presetFromId(p.id, p.isDefault));

  function capabilities(): Capabilities {
    // 桥和引擎都在手机里（baseUrl 是 loopback）时，别把宿主说成"桌面"
    const local = callbackOrigin() !== null;
    return {
      protocol: PROTOCOL_VERSION,
      host: {
        id: HOST_ID,
        kind: local ? 'phone' : 'desktop',
        name: local ? '本机 dsh' : '真 dsh（桌面）',
        platform: 'dsh-web',
        engineVersion: '0.2.1-rc.5',
      },
      events: ['engine.status', 'session.created', 'session.updated', 'account.updated'],
      // 桥实际实现了这些动作；switch_preset 不在内（真宿主没有会话内换预设）
      actions: ['approve', 'reject', 'steer', 'stop', 'create_session'],
      presets,
      workspaces: [],
      limits: { maxAttachmentMB: 20, maxFetchFileMB: 50 },
    };
  }

  /* ---------------- 实时流：把 assistant-stream 帧翻成我们的事件 ---------------- */

  let followDispose: (() => void) | null = null;
  let followSessionId: string | null = null;
  let liveTurn: Turn | null = null;
  let liveRunId = '';
  /** 每个 assistant-stream 步骤都从 block index 0 重新开始，id 必须带上步骤号才不撞车 */
  let liveStep = 0;
  /** 正在流式的回合按会话存一份，sessions.get 时补进快照，避免重进会话看到两份 */
  const liveTurns = new Map<string, Turn>();
  const blockIdByIndex = new Map<number, string>();
  /** 还没回答的 ask_user_question，按工具调用 id 存 */
  const pendingQuestions = new Map<string, Approval>();
  /** 每个待回答问题的 attachWait 流，回答后要关掉 */
  const waitStreams = new Map<string, () => void>();

  /**
   * 把 ask_user_question 的工具调用翻成一张"请选择"卡片。
   * 参数形状（实测）：
   *   { questions: [{ id, header?, question, options?: [{label, description?}], multi_select? }] }
   * 目前只取第一个问题——绝大多数场景就是一个问题。
   */
  function questionFromToolCall(sessionId: string, callId: string, argsJson: string): Approval | null {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argsJson) as Record<string, unknown>;
    } catch {
      return null;
    }
    const list = Array.isArray(args.questions) ? (args.questions as Array<Record<string, unknown>>) : [];
    const q = list[0];
    if (!q) return null;
    const options = Array.isArray(q.options)
      ? (q.options as Array<Record<string, unknown>>)
          .map((o) => ({ label: String(o.label ?? ''), description: typeof o.description === 'string' ? o.description : undefined }))
          .filter((o) => o.label.length > 0)
      : [];
    return {
      id: callId,
      sessionId,
      runId: liveRunId,
      createdAt: Date.now(),
      kind: 'question',
      title: typeof q.header === 'string' && q.header.length > 0 ? q.header : '需要你选一下',
      summary: String(q.question ?? ''),
      risk: 'low',
      actions: [],
      options,
      multiSelect: q.multi_select === true,
      questionId: String(q.id ?? ''),
    };
  }

  function startFollow(sessionId: string): void {
    const sameSession = followSessionId === sessionId;
    // 同一会话重开 follow 时保留 liveTurn/blockId 映射；否则中途重连后 delta 找不到 block
    followDispose?.();
    followDispose = null;
    followSessionId = sessionId;
    if (!sameSession) {
      liveTurn = null;
      liveStep = 0;
      blockIdByIndex.clear();
    } else if (!liveTurn) {
      liveTurn = liveTurns.get(sessionId) ?? null;
    }

    followDispose = client.follow(sessionId, (value) => {
      try {
        handleFollowValue(sessionId, value);
      } catch {
        /* 单帧出错不影响整条流 */
      }
    });
  }

  function handleFollowValue(sessionId: string, value: Record<string, unknown>): void {
    if (process.env.DSH_PALM_DEBUG) {
      const evType = (value as { event?: { type?: string } }).event?.type;
      console.error('[follow]', String(value.type), evType ?? '');
    }
    // 真引擎的事件（turn/end 之类）
    if (value.type === 'event') {
      const ev = (value as { event?: { type?: string; data?: Record<string, unknown> } }).event;
      if (ev?.type === 'session/title') {
        const nextTitle = typeof ev.data?.title === 'string' ? ev.data.title.trim() : '';
        if (nextTitle) {
          void client
            .listSessions()
            .then(({ items }) => {
              const found = items.find((s) => s.sessionId === sessionId);
              if (found) {
                const summary = toSummary(found);
                summary.title = nextTitle;
                broadcast('session.updated', { session: summary });
              }
            })
            .catch(() => undefined);
        }
        return;
      }
      if (ev?.type === 'tool/call') {
        const d = (ev.data ?? {}) as Record<string, unknown>;
        if (!liveTurn) {
          liveRunId = canonicalRunId(d.turn, crypto.randomUUID())!;
          liveTurn = {
            id: canonicalTurnId(liveRunId),
            runId: liveRunId,
            role: 'assistant',
            createdAt: Date.now(),
            blocks: [],
            status: 'streaming',
          };
          liveTurns.set(sessionId, liveTurn);
        }
        const name = String(d.name ?? 'tool');
        const args = summarizeToolArgs(d.arguments);
        liveTurn.blocks.push({
          kind: 'tool',
          id: `${liveRunId}:tool:${String(d.callId ?? crypto.randomUUID())}`,
          ...(typeof d.callId === 'string' ? { callId: d.callId } : {}),
          name,
          summary: args,
          state: 'running',
        });
        broadcast('block.appended', { sessionId, runId: liveRunId, turn: liveTurn });
        return;
      }
      if (ev?.type === 'tool/result') {
        const d = (ev.data ?? {}) as Record<string, unknown>;
        const msg = (d.message ?? {}) as Record<string, unknown>;
        const callId = String(msg.toolCallId ?? d.callId ?? '');
        const block = liveTurn?.blocks.find(
          (b): b is Extract<Block, { kind: 'tool' }> =>
            b.kind === 'tool' && b.id.endsWith(String(callId))
        );
        if (block && liveTurn) {
          block.state = msg.isError === true ? 'error' : 'done';
          const detail = JSON.stringify(msg.content ?? '').replace(/\\n/g, '\n');
          if (detail) block.detail = detail.slice(0, 200);
          broadcast('block.updated', {
            sessionId,
            runId: liveRunId,
            turnId: liveTurn.id,
            block,
          });
        }
        return;
      }
      if (ev?.type === 'turn/end') {
        // 真引擎的收尾原因：completed / stop / aborted（用户中断）/ stopped / error
        const reason = (ev.data?.reason ?? {}) as Record<string, unknown>;
        const kind = typeof reason.kind === 'string' ? reason.kind : '';
        const finalReason: 'done' | 'stopped' | 'error' =
          kind === 'completed' || kind === 'stop' || kind === ''
            ? 'done'
            : kind === 'aborted' || kind === 'stopped'
              ? 'stopped'
              : 'error';
        const failure = (reason.failure ?? {}) as Record<string, unknown>;
        const errMsg =
          typeof reason.message === 'string' && reason.message.trim()
            ? reason.message.trim()
            : typeof failure.message === 'string' && failure.message.trim()
              ? failure.message.trim()
              : '';

        if (!liveTurn && finalReason === 'error') {
          liveRunId = canonicalRunId(ev.data?.turn, crypto.randomUUID())!;
          liveTurn = {
            id: canonicalTurnId(liveRunId),
            runId: liveRunId,
            role: 'assistant',
            createdAt: Date.now(),
            blocks: errMsg
              ? [{ kind: 'text', id: `${liveRunId}:live:error`, text: `错误：${errMsg}` }]
              : [],
            status: 'error',
          };
        }

        let preview = '';
        if (liveTurn) {
          liveTurn.status = finalReason;
          if (finalReason === 'error' && errMsg && liveTurn.blocks.length === 0) {
            liveTurn.blocks.push({
              kind: 'text',
              id: `${liveRunId}:live:error`,
              text: `错误：${errMsg}`,
            });
          }
          liveTurn.meta = {
            steps: liveTurn.blocks.length,
            durationMs: Math.max(1, Date.now() - liveTurn.createdAt),
          };
          for (let i = liveTurn.blocks.length - 1; i >= 0; i -= 1) {
            const b = liveTurn.blocks[i];
            if (b && b.kind === 'text' && b.text.trim()) {
              preview = b.text.replace(/\s+/g, ' ').trim().slice(0, 120);
              break;
            }
          }
          broadcast('block.appended', { sessionId, runId: liveRunId, turn: liveTurn });
        }

        broadcast('run.finished', {
          sessionId,
          runId: liveRunId || 'run',
          reason: finalReason,
          usage: liveTurn?.usage,
          ...(errMsg ? { error: errMsg } : {}),
          ...(preview ? { preview } : {}),
        });
        liveTurns.delete(sessionId);
        liveTurn = null;
      }

      return;
    }

    if (value.type !== 'assistant-stream') return;
    const frame = (value as { frame?: Record<string, any> }).frame;
    if (!frame) return;

    if (frame.type === 'start') {
      liveRunId = canonicalRunId(frame.turn, String(frame.attemptId ?? crypto.randomUUID()))!;
      liveStep += 1;
      liveTurn = {
        id: canonicalTurnId(liveRunId),
        runId: liveRunId,
        role: 'assistant',
        createdAt: Date.now(),
        blocks: [],
        status: 'streaming',
      };
      blockIdByIndex.clear();
      liveTurns.set(sessionId, liveTurn);
      broadcast('run.started', { sessionId, runId: liveRunId, turnId: liveTurn.id });
      broadcast('block.appended', { sessionId, runId: liveRunId, turn: liveTurn });
      return;
    }

    if (frame.type !== 'chunk' || !liveTurn) return;
    const chunk = (frame.chunk ?? {}) as Record<string, any>;
    const index = typeof chunk.index === 'number' ? chunk.index : 0;

    if (chunk.type === 'block-start') {
      const kind = chunk.blockType === 'reasoning' ? 'thinking' : 'text';
      const id = liveBlockId(liveRunId, liveStep, index);
      blockIdByIndex.set(index, id);
      liveTurn.blocks.push({ kind, id, text: '' } as Block);
      broadcast('block.appended', { sessionId, runId: liveRunId, turn: liveTurn });
      return;
    }

    if (chunk.type === 'reasoning-delta' || chunk.type === 'text-delta') {
      const text = typeof chunk.text === 'string' ? chunk.text : '';
      if (!text) return;
      const blockId = blockIdByIndex.get(index);
      if (!blockId) return;
      const block = liveTurn.blocks.find((b) => b.id === blockId);
      if (block && (block.kind === 'text' || block.kind === 'thinking')) block.text += text;
      broadcast('block.delta', {
        sessionId,
        runId: liveRunId,
        turnId: liveTurn.id,
        blockId,
        op: 'append',
        text,
      });
      return;
    }

    if (chunk.type === 'block-end' && chunk.block) {
      const blockId = blockIdByIndex.get(index);
      const block = liveTurn.blocks.find((b) => b.id === blockId);
      if (block && (block.kind === 'text' || block.kind === 'thinking')) {
        const finalText = typeof chunk.block.text === 'string' ? chunk.block.text : '';
        if (finalText) block.text = finalText;
        broadcast('block.updated', { sessionId, runId: liveRunId, turnId: liveTurn.id, block });
      }
    }
  }

  /** 把用户刚发的话立刻推给客户端（真引擎的 user/message 不走 assistant-stream 那套） */
  function broadcastUserTurn(sessionId: string, text: string): void {
    const turn: Turn = {
      id: 'u-' + crypto.randomUUID(),
      role: 'user',
      createdAt: Date.now(),
      status: 'done',
      blocks: [{ kind: 'text', id: 'b-' + crypto.randomUUID(), text }],
    };
    broadcast('block.appended', { sessionId, runId: 'pending', turn });
  }

  /** 从会话记录里捞出"提了问但还没回答"的调用（重开会话时用） */
  function seedPendingQuestions(sessionId: string, records: RealRecord[]): void {
    const asked = new Map<string, string>(); // callId -> arguments
    const answered = new Set<string>();
    for (const rec of records) {
      const ev = rec?.event as { type?: string; data?: Record<string, unknown> } | undefined;
      if (!ev?.type || !ev.data) continue;
      if (ev.type === 'tool/call' && String(ev.data.name ?? '') === 'ask_user_question') {
        asked.set(String(ev.data.callId ?? ''), String(ev.data.arguments ?? ''));
      }
      if (ev.type === 'tool/result') {
        const msg = (ev.data.message ?? {}) as Record<string, unknown>;
        answered.add(String(msg.toolCallId ?? ev.data.toolCallId ?? ''));
      }
    }
    for (const [callId, argsJson] of asked) {
      if (answered.has(callId) || pendingQuestions.has(callId)) continue;
      const approval = questionFromToolCall(sessionId, callId, argsJson);
      if (approval) pendingQuestions.set(callId, approval);
    }
  }

  type HandlerContext = {
    /** 这次请求是不是从本机 loopback 发来的 */
    localClient: boolean;
  };
  type Handler<M extends Method> = (params: RequestParams[M], ctx: HandlerContext) => Promise<unknown>;
  const unsupported = (name: string): never => {
    throw Object.assign(new Error(`${name} 在真引擎桥上还没实现`), {
      code: 'unsupported' satisfies ProtocolError['code'],
    });
  };

  type RoutableCatalog = {
    routableProviders?: string[];
    groups?: Array<{
      id?: string;
      models?: Array<{ id?: string; reasoning?: { defaultEffort?: string } }>;
    }>;
  };

  /** dsh 的 default 可能指向不可路由的 provider（deepseek-official 需要 API Key），
   *  但账号登录后真正可路由的是 deepseek-account；这里选 catalog 里第一个可路由模型。 */
  async function pickRoutableModel(): Promise<{
    provider: string;
    model: string;
    reasoningEffort?: string;
  } | null> {
    try {
      const catalog = await client.rpc<RoutableCatalog>('session/modelCatalog', {});
      const routable = new Set(catalog.routableProviders ?? []);
      for (const group of catalog.groups ?? []) {
        if (typeof group.id !== 'string' || !routable.has(group.id)) continue;
        const item = group.models?.[0];
        if (!item || typeof item.id !== 'string') continue;
        return {
          provider: group.id,
          model: item.id,
          ...(typeof item.reasoning?.defaultEffort === 'string'
            ? { reasoningEffort: item.reasoning.defaultEffort }
            : {}),
        };
      }
    } catch {
      // 目录拿不到就不改模型，让 dsh 自己报原错误
    }
    return null;
  }

  /** 老会话可能已经存了 deepseek-official；发消息前纠正一次，否则会报 MISSING_CREDENTIAL。 */
  async function ensureRoutableModel(sessionId: string): Promise<void> {
    try {
      const catalog = await client.rpc<RoutableCatalog>('session/modelCatalog', {});
      const routable = new Set(catalog.routableProviders ?? []);
      const { items } = await client.listSessions();
      const item = items.find((s) => s.sessionId === sessionId);
      const current = (item as { projections?: { values?: { modelSelection?: { next?: { provider?: string } } } } } | undefined)
        ?.projections?.values?.modelSelection?.next;
      if (current?.provider && routable.has(current.provider)) return;
      const selection = await pickRoutableModel();
      if (!selection) return;
      await client.rpc('session/selectModel', {
        request: {
          sessionId,
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
        },
      });
    } catch {
      // 尽力而为；失败时保留原始报错
    }
  }

  const handlers: { [M in Method]: Handler<M> } = {
    'capabilities.get': async () => capabilities(),

    /**
     * 官方 Web 前端的入口 + token（M2.1）。
     * 只有「连桥的客户端在本机 loopback」且「上游 dsh 也在 loopback」才下发；
     * 远程配对进来的客户端拿不到 token，明确 unsupported。
     */
    'web.session': async (_params, ctx) => {
      if (!ctx.localClient) {
        throw new WebFrontendError(
          'unsupported',
          '官方 Web 入口只在本机提供：远程连接不接收 Web token',
          '请在手机 App（本机完整引擎）里打开实验室；远程宿主请直接在电脑浏览器访问。',
        );
      }
      return buildWebFrontendEndpoint(options.baseUrl, options.token);
    },

    'sessions.list': async () => {
      const { items } = await client.listSessions();
      const sessions = items
        .map(toSummary)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return { sessions };
    },

    'sessions.get': async ({ sessionId }) => {
      const { items } = await client.listSessions();
      const item = items.find((s) => s.sessionId === sessionId);
      if (!item) throw Object.assign(new Error('会话不存在'), { code: 'not_found' satisfies ProtocolError['code'] });

      const snap = await client.snapshot(sessionId);
      const records = (snap?.records ?? []) as RealRecord[];
      const proj = projectRecords(records, { finalizeUnfinished: !item.running });
      const live = liveTurns.get(sessionId);

      const detail: SessionDetail = {
        ...toSummary(item),
        turns: live ? mergeLiveTurn(proj.turns, live) : proj.turns,
        contract: { tools: [], net: 'allow' },
      };
      if (snap?.header?.agentPreset) detail.presetId = snap.header.agentPreset;
      if (proj.title) detail.title = proj.title;
      const currentPermission = item.projections?.values?.permissions?.currentValue;
      if (typeof currentPermission === 'string') detail.permission = currentPermission;
      const modelSel = item.projections?.values?.modelSelection;
      const chosen = modelSel?.next ?? modelSel?.lastUsed;
      if (chosen?.provider && chosen?.model) {
        detail.model = {
          provider: String(chosen.provider),
          model: String(chosen.model),
          ...(typeof chosen.reasoningEffort === 'string' ? { reasoningEffort: chosen.reasoningEffort } : {}),
        };
      }

      // 不再从历史日志重建 pending：pending 只认 live pendingEvents / Host open projection
      // seedPendingQuestions(sessionId, records);

      // 有未决审批/提问时，detail 也要是等待态，并把卡片块补进回合
      const pending = [
        ...pendingQuestions.values(),
        ...[...pendingEvents.values()].map((p) => p.approval).filter((a): a is Approval => Boolean(a)),
      ].filter((a) => a.sessionId === sessionId);
      if (pending.length > 0) {
        let turns = detail.turns.slice();
        for (const a of pending) {
          const block: Block = { kind: 'approval', id: 'ap-' + a.id, approvalId: a.id };
          let placed = false;
          for (let i = turns.length - 1; i >= 0; i--) {
            const turn = turns[i]!;
            if (turn.role !== 'assistant') continue;
            if (turn.blocks.some((b) => b.kind === 'approval' && b.approvalId === a.id)) {
              placed = true;
              break;
            }
            turns[i] = { ...turn, blocks: [...turn.blocks, block] };
            placed = true;
            break;
          }
          if (!placed) {
            turns.push({
              id: canonicalTurnId('approval:' + a.id),
              runId: 'approval:' + a.id,
              role: 'assistant',
              createdAt: Date.now(),
              blocks: [block],
              status: 'streaming',
            });
          }
        }
        detail.turns = turns;
        detail.status = 'waiting_approval';
      }

      // 打开（或切换）这个会话的实时流，之后的新回合会以事件形式推给客户端
      startFollow(sessionId);
      return { session: detail };
    },

    // 真引擎建会话：先拿默认工作区，再提交一个客户端生成的 sessionId
    'sessions.create': async ({ presetId, title }) => {
      const ws = await client.rpc<{ workspace: { workspaceId: string; title?: string } }>(
        'workspace/initializeDefault',
        {},
      );
      const sessionId = 'session-' + crypto.randomUUID();
      await client.rpc('session/create', {
        request: { workspaceId: ws.workspace.workspaceId, sessionId, agentPreset: presetId },
      });
      const selection = await pickRoutableModel();
      if (selection) {
        await client
          .rpc('session/selectModel', {
            request: {
              sessionId,
              provider: selection.provider,
              model: selection.model,
              ...(selection.reasoningEffort
                ? { reasoningEffort: selection.reasoningEffort }
                : {}),
            },
          })
          .catch(() => undefined);
      }
      const session: SessionSummary = {
        id: sessionId,
        title: title ?? '新会话',
        presetId,
        workspaceId: ws.workspace.title ?? ws.workspace.workspaceId,
        hostId: HOST_ID,
        status: 'idle',
        updatedAt: Date.now(),
        unread: 0,
        preview: '',
      };
      broadcast('session.created', { session });
      return { session };
    },

    'sessions.import': async () => {
      throw new Error('sessions.import 只在轻引擎可用');
    },

    // 真引擎的发消息：session/prompt。mode=queue 排队，steer 立刻插入当前回合。
    'sessions.send': async ({ sessionId, text, attachments, files }) => {
      startFollow(sessionId);
      await ensureRoutableModel(sessionId);
      const cleanText = text.trim();
      const attList = attachments ?? [];
      const fileList = files ?? [];
      // 附件由原生收件复制进 workspace/uploads，这里只把 /root/work 下的路径告诉模型，
      // 不再走 fileUploads/upload 的 base64（旧客户端的 receipts 继续兼容）。
      const promptText = promptWithProotFiles(cleanText, fileList);
      broadcastUserTurn(sessionId, userDisplayText(cleanText, text, attList.length + fileList.length));
      const parts: Array<Record<string, unknown>> = [
        { type: 'text', text: promptText.length > 0 ? promptText : '请查看并处理我上传的附件。' },
      ];
      for (const receiptId of attList) parts.push({ type: 'file', receiptId });
      await client.rpc('session/prompt', {
        request: {
          requestId: crypto.randomUUID(),
          sessionId,
          mode: 'queue',
          content: parts,
        },
      });
      return { accepted: true as const, runId: crypto.randomUUID() };
    },

    'sessions.steer': async ({ sessionId, text, attachments, files }) => {
      startFollow(sessionId);
      const cleanText = text.trim();
      const attList = attachments ?? [];
      const fileList = files ?? [];
      const promptText = promptWithProotFiles(cleanText, fileList);
      broadcastUserTurn(sessionId, userDisplayText(cleanText, text, attList.length + fileList.length));
      const parts: Array<Record<string, unknown>> = [
        { type: 'text', text: promptText.length > 0 ? promptText : '请查看并处理我上传的附件。' },
      ];
      for (const receiptId of attList) parts.push({ type: 'file', receiptId });
      await client.rpc('session/prompt', {
        request: {
          requestId: crypto.randomUUID(),
          sessionId,
          mode: 'steer',
          content: parts,
        },
      });
      return { accepted: true as const };
    },
    // 中断当前回合：session/cancel
    'sessions.stop': async ({ sessionId }) => {
      await client.rpc('session/cancel', { request: { sessionId } });
      return { accepted: true as const };
    },
    'sessions.setPreset': async () => unsupported('sessions.setPreset'),
    // 交接只从轻引擎发起；完整引擎侧没有可回退的历史。
    // TODO(1.4): 真宿主侧交接（跨设备）后置。
    'sessions.handoff': async () => unsupported('sessions.handoff'),

    'sessions.rename': async ({ sessionId, title }) => {
      const trimmed = title.trim();
      if (trimmed.length === 0) {
        throw Object.assign(new Error('标题不能为空'), { code: 'bad_request' satisfies ProtocolError['code'] });
      }
      await client.rpc('session/rename', { request: { sessionId, title: trimmed } });
      const { items } = await client.listSessions();
      const item = items.find((s) => s.sessionId === sessionId);
      if (!item) throw Object.assign(new Error('会话不存在'), { code: 'not_found' satisfies ProtocolError['code'] });
      const snap = await client.snapshot(sessionId);
      const proj = projectRecords((snap?.records ?? []) as RealRecord[], {
        finalizeUnfinished: !item.running,
      });
      const live = liveTurns.get(sessionId);
      return {
        session: {
          ...toSummary(item),
          turns: live ? mergeLiveTurn(proj.turns, live) : proj.turns,
          contract: { tools: [], net: 'allow' },
        },
      };
    },

    'sessions.pin': async ({ sessionId, pinned }) => {
      await client.rpc(pinned ? 'workspace/pinSession' : 'workspace/unpinSession', { sessionId });
      return { ok: true as const };
    },

    'sessions.archive': async ({ sessionId, archived }) => {
      await client.rpc(archived ? 'workspace/archiveSession' : 'workspace/unarchiveSession', {
        sessionId,
        ...(archived ? { stopActivity: true } : {}),
      });
      return { ok: true as const };
    },

    'sessions.delete': async () => unsupported('sessions.delete'),
    'sessions.search': async () => unsupported('sessions.search'),
    'shell.run': async () => unsupported('shell.run'),

    'workspaces.list': async () => {
      // workspace/follow 的第一帧是 baseline，里面就是工作区清单
      type WorkspaceView = { workspaceId?: string; path?: string; title?: string };
      const items = await new Promise<WorkspaceView[]>((resolve) => {
        let done = false;
        const finish = (list: WorkspaceView[]): void => {
          if (done) return;
          done = true;
          resolve(list);
        };
        const dispose = client.openStream('workspace/follow', {}, (value) => {
          const v = value as { type?: string; value?: { items?: WorkspaceView[] } };
          if (v.type === 'baseline') finish(v.value?.items ?? []);
        });
        setTimeout(() => {
          dispose();
          finish([]);
        }, 4000);
      });
      const workspaces: Workspace[] = items
        .map((item) => ({
          id: String(item.workspaceId ?? ''),
          name: String(item.title ?? item.path ?? ''),
          root: String(item.path ?? ''),
          presetIds: [],
        }))
        .filter((w) => w.id.length > 0);
      return { workspaces };
    },

    'workspaces.create': async ({ path }) => {
      const created = await client.rpc<{ workspace?: { workspaceId?: string; path?: string; title?: string } }>(
        'workspace/create',
        { request: { path } },
      );
      const w = created.workspace ?? {};
      const workspace: Workspace = {
        id: String(w.workspaceId ?? ''),
        name: String(w.title ?? w.path ?? path),
        root: String(w.path ?? path),
        presetIds: [],
      };
      return { workspace };
    },
    'attachments.upload': async ({ sessionId, data, name }) => {
      const cleanBase64 = data.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
      const value = await client.rpc<{ receiptId?: string; file?: { name?: string } }>('fileUploads/upload', {
        agentId: sessionId,
        request: { data: cleanBase64, ...(name ? { name } : {}) },
      });
      const receiptId = String(value.receiptId ?? '');
      if (!receiptId) throw Object.assign(new Error('宿主没有返回上传回执'), { code: 'internal' satisfies ProtocolError['code'] });
      return { receiptId, ...(value.file?.name ? { name: value.file.name } : name ? { name } : {}) };
    },

    'permissions.list': async () => {
      const catalog = await client.rpc<{
        options?: Array<{ value?: string; name?: string; description?: string }>;
        defaultPreset?: string;
      }>('permissionPresets/catalog', {});
      const options = (catalog.options ?? [])
        .map((o) => ({
          value: String(o.value ?? ''),
          name: String(o.name ?? o.value ?? ''),
          ...(typeof o.description === 'string' ? { description: o.description } : {}),
        }))
        .filter((o) => o.value.length > 0);
      return { options, default: catalog.defaultPreset };
    },

    'sessions.setPermission': async ({ sessionId, preset }) => {
      // 真引擎用 /permission 命令切换（沙箱模式 + 审批策略一起换，并且写进会话事件）
      await client.rpc('commands/execute', {
        agentId: sessionId,
        line: '/permission ' + preset,
        submittedAttachments: [],
      });
      const { items } = await client.listSessions();
      const item = items.find((s) => s.sessionId === sessionId);
      if (!item) throw Object.assign(new Error('会话不存在'), { code: 'not_found' satisfies ProtocolError['code'] });
      const snap = await client.snapshot(sessionId);
      const proj = projectRecords((snap?.records ?? []) as RealRecord[], {
        finalizeUnfinished: !item.running,
      });
      const live = liveTurns.get(sessionId);
      const detail: SessionDetail = {
        ...toSummary(item),
        turns: live ? mergeLiveTurn(proj.turns, live) : proj.turns,
        contract: { tools: [], net: 'allow' },
      };
      detail.permission = preset;
      return { session: detail };
    },

    'models.list': async () => {
      type Catalog = {
        default?: { provider?: string; model?: string; reasoningEffort?: string };
        groups?: Array<{
          id?: string;
          name?: string;
          models?: Array<{
            id?: string;
            name?: string;
            description?: string;
            reasoning?: { efforts?: Array<{ id?: string; name?: string; description?: string }>; defaultEffort?: string };
          }>;
        }>;
      };
      const catalog = await client.rpc<Catalog>('session/modelCatalog', {});
      const models: ModelOption[] = [];
      for (const group of catalog.groups ?? []) {
        for (const item of group.models ?? []) {
          models.push({
            provider: String(group.id ?? ''),
            providerName: String(group.name ?? group.id ?? ''),
            id: String(item.id ?? ''),
            name: String(item.name ?? item.id ?? ''),
            description: typeof item.description === 'string' ? item.description : undefined,
            efforts: (item.reasoning?.efforts ?? [])
              .map((e) => ({
                id: String(e.id ?? ''),
                name: String(e.name ?? e.id ?? ''),
                description: typeof e.description === 'string' ? e.description : undefined,
              }))
              .filter((e) => e.id.length > 0),
            defaultEffort: typeof item.reasoning?.defaultEffort === 'string' ? item.reasoning.defaultEffort : undefined,
          });
        }
      }
      const fallback = catalog.default;
      const fallbackRoutable =
        Boolean(fallback?.provider) && models.some((m) => m.provider === fallback?.provider);
      const first = models[0];
      const defaultChoice =
        fallback?.provider && fallback.model && fallbackRoutable
          ? { provider: fallback.provider, model: fallback.model, reasoningEffort: fallback.reasoningEffort }
          : first
            ? {
                provider: first.provider,
                model: first.id,
                ...(first.defaultEffort ? { reasoningEffort: first.defaultEffort } : {}),
              }
            : undefined;
      return { models, default: defaultChoice };
    },

    'sessions.setModel': async ({ sessionId, provider, model, reasoningEffort }) => {
      await client.rpc('session/selectModel', {
        request: { sessionId, provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) },
      });
      // 回一个刷新过的会话详情，界面直接换状态
      const { items } = await client.listSessions();
      const item = items.find((s) => s.sessionId === sessionId);
      if (!item) throw Object.assign(new Error('会话不存在'), { code: 'not_found' satisfies ProtocolError['code'] });
      const snap = await client.snapshot(sessionId);
      const proj = projectRecords((snap?.records ?? []) as RealRecord[], {
        finalizeUnfinished: !item.running,
      });
      const live = liveTurns.get(sessionId);
      const detail: SessionDetail = {
        ...toSummary(item),
        turns: live ? mergeLiveTurn(proj.turns, live) : proj.turns,
        contract: { tools: [], net: 'allow' },
      };
      detail.model = { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
      return { session: detail };
    },
    'approvals.list': async ({ sessionId }: { sessionId?: string }) => {
      const out: Approval[] = [];
      const seen = new Set<string>();
      const add = (a: Approval): void => {
        if (sessionId && a.sessionId !== sessionId) return;
        if (seen.has(a.id)) return;
        seen.add(a.id);
        out.push(a);
      };
      for (const a of pendingQuestions.values()) add(a);
      for (const p of pendingEvents.values()) if (p.approval) add(p.approval);
      return { approvals: out };
    },

    // 回答 ask_user_question：回执会被 steer 进 agent，成为一条 user 消息。
    //
    // 时序（实测）：真引擎的提问在「等待窗口内」只接受宿主进程内的 waterfall 处理器作答，
    // 远端客户端拿不到；窗口结束、工具返回 pending 之后，问题变成 continued，才能用
    // userQuestions/answer 补答。所以这里先乐观返回，真正的交付在后台重试。
    // 回答提问：优先走 $events 的 waterfall 通道（窗口内立即生效）。
    // 只有那张卡片已经不在了（比如过了很久才点）才退回 userQuestions/answer 补答。
    'questions.answer': async ({ sessionId, callId, answers }) => {
      pendingQuestions.delete(callId);
      // 一次提问可能带多个问题：缺的那些补一个空回答，否则引擎会 BAD_ANSWER 拒掉整批
      let eventId = callId;
      let pending = pendingEvents.get(callId);
      if (!pending) {
        // 恢复出来的卡片 id 可能是 callId，而 waterfall 池里是 eventId
        const qid = answers[0]?.id;
        for (const [id, p] of pendingEvents) {
          if (p.sessionId !== sessionId) continue;
          if (p.approval?.id === callId || (qid && p.approval?.questionId === qid)) {
            eventId = id;
            pending = p;
            break;
          }
        }
      }
      const allIds = pending?.questionIds ?? [];
      const complete = allIds.length > 1 ? allIds.map((id) => answers.find((a) => a.id === id) ?? { id, selected: [] as string[] }) : answers;
      const viaEvent = await answerEvent(eventId, { kind: 'result', value: { answers: complete } }).catch(() => false);
      if (viaEvent) return { accepted: true as const };

      await client.rpc<boolean>('userQuestions/answer', {
        agentId: sessionId,
        callId,
        answer: { answers },
      });
      pendingEvents.delete(eventId);
      broadcast('approval.resolved', { sessionId, approvalId: callId });
      if (eventId !== callId) broadcast('approval.resolved', { sessionId, approvalId: eventId });
      return { accepted: true as const };
    },

    // 审批：同样走 $events，真引擎只接受 'allowed-once' 这一种批准
    'approvals.resolve': async ({ approvalId, decision }) => {
      const viaEvent = await answerEvent(approvalId, {
        kind: 'result',
        value: decision === 'approve' ? 'allowed-once' : 'rejected',
      }).catch(() => false);
      if (!viaEvent) {
        throw Object.assign(new Error('这条审批已经失效'), { code: 'not_found' satisfies ProtocolError['code'] });
      }
      return { accepted: true as const };
    },
    'presets.list': async () => ({ presets }),

    'credentials.describe': async ({ refs }) => {
      const raw = await client.rpc<Record<string, { configured?: boolean; writable?: boolean }>>(
        'credentials/describe',
        { refs },
      );
      return {
        credentials: Object.fromEntries(
          Object.entries(raw).map(([k, v]) => [k, { configured: v.configured === true, writable: v.writable !== false }]),
        ),
      };
    },

    'credentials.set': async ({ ref, value }) => {
      // 真引擎拒绝空值（schema 要求 value 至少 1 个字符），清除走 unset
      if (value.trim().length === 0) {
        await client.rpc('credentials/unset', { ref });
        return { ok: true as const };
      }
      await client.rpc('credentials/set', { ref, value });
      return { ok: true as const };
    },

    'credentials.unset': async ({ ref }) => {
      await client.rpc('credentials/unset', { ref });
      return { ok: true as const };
    },

    'account.state': async () => {
      startAccountWatch();
      const account = asAccountState(await accountRpc('account/getState', {}));
      if (!account) throw Object.assign(new Error('宿主返回了无法识别的账号状态'), { code: 'internal' satisfies ProtocolError['code'] });
      return { account };
    },

    'account.signIn': async () => {
      const origin = callbackOrigin();
      if (!origin) {
        throw Object.assign(new Error('这个宿主不在这台设备上，没法从手机完成登录'), {
          code: 'unsupported' satisfies ProtocolError['code'],
          hint: '连电脑时请在那台电脑的 dsh 界面里登录；手机只显示登录状态。',
        });
      }
      startAccountWatch();
      // 实测：account/startSignIn 是真正的方法名（login / signIn / startLogin 都不存在）
      const account = asAccountState(
        await accountRpc('account/startSignIn', {
          client: accountClient(),
          callbackOrigin: origin,
          loginSource: 'web',
        }),
      );
      if (!account) throw Object.assign(new Error('宿主返回了无法识别的账号状态'), { code: 'internal' satisfies ProtocolError['code'] });
      emitAccount(account);
      return { account };
    },

    'account.cancelSignIn': async ({ attemptId }) => {
      const account = asAccountState(await accountRpc('account/cancelSignIn', { attemptId }));
      if (!account) throw Object.assign(new Error('宿主返回了无法识别的账号状态'), { code: 'internal' satisfies ProtocolError['code'] });
      emitAccount(account);
      return { account };
    },

    'providers.list': async () => ({ providers: await providerRows() }),

    'providers.catalog': async () => ({ providers: await catalogProviders() }),

    'providers.discover': async ({ baseURL, api, apiKey }) => {
      const raw = await client.rpc<unknown>('llm/discoverModels', {
        settingsNs: 'llm-pi-ai',
        request: { baseURL, api, ...(apiKey ? { apiKey } : {}) },
      });
      const list = Array.isArray(raw) ? raw : ((raw as { models?: unknown[] } | null)?.models ?? []);
      return {
        models: list.map(normalizeModel).filter((m): m is ProviderModel => m != null),
      };
    },

    'providers.save': async (params) => {
      const ns = await describeNamespace('llm-pi-ai');
      const providers = (ns?.value?.providers ?? {}) as Record<string, Record<string, unknown>>;
      const existing = providers[params.id];
      const keyRef =
        typeof existing?.apiKeyEnv === 'string' && existing.apiKeyEnv.length > 0
          ? existing.apiKeyEnv
          : keyRefFor(params.id);

      if (params.mode === 'catalog') {
        // 目录型：只记录 apiKeyEnv（可选改地址），协议和模型交给适配器
        const profile = {
          ...(params.apiKey.trim().length > 0
            ? { apiKeyEnv: keyRef }
            : existing?.apiKeyEnv
              ? { apiKeyEnv: existing.apiKeyEnv }
              : {}),
          ...(params.baseURL && params.baseURL.trim().length > 0 ? { baseURL: params.baseURL.trim() } : {}),
        };
        await client.rpc('settings/mutate', {
          ns: 'llm-pi-ai',
          ops: [{ op: 'set', path: ['providers', params.id], value: profile }],
        });
        if (params.apiKey.trim().length > 0) {
          await client.rpc('credentials/set', { ref: keyRef, value: params.apiKey.trim() });
        }
        return { providers: await providerRows() };
      }

      const profile = {
        ...(params.displayName && params.displayName.trim().length > 0
          ? { displayName: params.displayName.trim() }
          : {}),
        ...(params.apiKey && params.apiKey.trim().length > 0
          ? { apiKeyEnv: keyRef }
          : existing?.apiKeyEnv
            ? { apiKeyEnv: existing.apiKeyEnv }
            : {}),
        api: params.api,
        baseURL: params.baseURL.trim(),
        models: params.models.map((m) => ({ ...m })),
      };
      await client.rpc('settings/mutate', {
        ns: 'llm-pi-ai',
        ops: [{ op: 'set', path: ['providers', params.id], value: profile }],
      });
      if (params.apiKey && params.apiKey.trim().length > 0) {
        await client.rpc('credentials/set', { ref: keyRef, value: params.apiKey.trim() });
      }
      return { providers: await providerRows() };
    },

    'providers.remove': async ({ id }) => {
      const ns = await describeNamespace('llm-pi-ai');
      const existing = ((ns?.value?.providers ?? {}) as Record<string, Record<string, unknown>>)[id];
      const keyRef = typeof existing?.apiKeyEnv === 'string' && existing.apiKeyEnv.length > 0 ? existing.apiKeyEnv : keyRefFor(id);
      await client.rpc('credentials/unset', { ref: keyRef }).catch(() => undefined);
      await client.rpc('settings/mutate', {
        ns: 'llm-pi-ai',
        ops: [{ op: 'unset', path: ['providers', id] }],
      });
      return { providers: await providerRows() };
    },

    'fs.list': async () => unsupported('fs.list'),
    'fs.rename': async () => unsupported('fs.rename'),
    'fs.delete': async () => unsupported('fs.delete'),

    'account.signOut': async () => {
      const account = asAccountState(await accountRpc('account/signOut', { client: accountClient() }));
      if (!account) throw Object.assign(new Error('宿主返回了无法识别的账号状态'), { code: 'internal' satisfies ProtocolError['code'] });
      emitAccount(account);
      return { account };
    },
  };

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, bridge: 'real', host: HOST_ID }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h1>dsh-palm real bridge</h1><p>WS: <code>ws://&lt;host&gt;:${options.port ?? 0}/ws</code></p>`);
  });

  const wss = new WebSocketServer({ server: http, path: '/ws' });

  // 注意：只有配了配对码才启用设备密钥。否则 DSH_PALM_NO_PAIR=1 会形同虚设——
  // 设备存储一存在，下面的鉴权分支就会强制要求密钥。
  const deviceStore =
    options.devicesFile && (options.pairCode ?? '').length > 0 ? new DeviceStore(options.devicesFile) : null;

  wss.on('connection', (ws, req) => {
    // 鉴权顺序：
    //   1) ?key=<设备密钥> 命中 -> 直接放行（之后都不用再输配对码）
    //   2) ?pair=<配对码> 命中 -> 放行，并发一把新设备密钥给客户端存下来
    //   3) 两个都不对 -> 4001
    const url = new URL(req.url ?? '/ws', 'http://localhost');
    const expected = options.pairCode ?? '';
    let issuedKey: string | null = null;
    if (expected.length > 0 || deviceStore) {
      const key = url.searchParams.get('key') ?? '';
      const pair = url.searchParams.get('pair') ?? '';
      const knownDevice = key.length > 0 && deviceStore ? deviceStore.verify(key) : null;
      const pairOk = expected.length > 0 && pair === expected;
      if (!knownDevice && !pairOk) {
        ws.close(4001, '需要配对码');
        return;
      }
      if (!knownDevice && pairOk && deviceStore) issuedKey = deviceStore.issue().key;
    }

    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    if (issuedKey) {
      // 客户端收到后自己存起来，下次用 ?key= 连
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'event', event: 'device.paired', data: { key: issuedKey } }));
    }
    broadcast('engine.status', { state: 'ready' });

    ws.on('message', (raw) => {
      let msg: { type?: string; id?: string; method?: string; params?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type !== 'req' || !msg.id) return;
      const id = msg.id;
      const method = msg.method as Method;
      const send = (payload: unknown): void => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
      };

      if (!(method in handlers)) {
        send({
          type: 'res', v: PROTOCOL_VERSION, id, ok: false,
          error: { code: 'unsupported', message: `不支持的方法：${String(method)}` } satisfies ProtocolError,
        });
        return;
      }

      const handler = handlers[method] as (p: unknown, ctx: HandlerContext) => Promise<unknown>;
      handler(msg.params ?? {}, { localClient: isLoopbackAddress(req.socket.remoteAddress) })
        .then((result) => send({ type: 'res', v: PROTOCOL_VERSION, id, ok: true, result }))
        .catch((err: { code?: ProtocolError['code']; message?: string; hint?: string }) =>
          send({
            type: 'res', v: PROTOCOL_VERSION, id, ok: false,
            error: {
              code: err.code ?? 'internal',
              message: err.message ?? '内部错误',
              ...(typeof err.hint === 'string' ? { hint: err.hint } : {}),
            } satisfies ProtocolError,
          }),
        );
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port ?? 8788, '0.0.0.0', () => resolve());
  });

  const addr = http.address();
  const port = typeof addr === 'object' && addr ? addr.port : (options.port ?? 8788);

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        eventsDispose?.();
        accountWatchDispose?.();
        accountWatchDispose = null;
        followDispose?.();
        followDispose = null;
        for (const ws of clients) ws.close();
        wss.close();
        http.close(() => resolve());
      }),
  };
}
