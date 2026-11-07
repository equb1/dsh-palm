/**
 * 真引擎桥：对外说「我们的协议」，对内调真 dsh 的 HTTP/WS。
 *
 * 这一层就是 docs/02-architecture.md 里的"桥接层"——
 * UI 永远只连这里，dsh 换版本时改的是桥，不是界面。
 */
import { createServer } from 'node:http';
import { mkdir, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
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
import {
  addUsage,
  assistantMessageInfo,
  contentText,
  mergeAssistantContent,
  projectRecords,
  readContent,
  usageFrom,
  type RealRecord,
} from './project';
import { promptWithProotFiles, PROOT_WORKSPACE_ROOT } from './promptParts';
import { deleteWorkspace, listWorkspace, renameWorkspace } from './workspaceFs';
import { readSessionLogBuffer } from './logReader';
import { buildSessionSearchText, matchSessionText } from './sessionSearch';
import {
  deleteSessionDir,
  findSessionDir,
  latestSessionLog,
  projectKey,
  readSessionLogFile,
  resolveDshHome,
  sessionDirFor,
} from './sessionFs';
import { makeNodeBackend } from '../../../app/src/engine/fs/nodeBackend';
import { createWorkspaceMount } from '../../../app/src/engine/fs/mount';
import { ShellRunner as ShellRunnerClass } from '../../../app/src/engine/shell/bash';
import { canonicalRunId, canonicalTurnId, liveBlockId, mergeLiveTurn } from '../../../app/src/protocol/turns';
import {
  buildWebFrontendEndpoint,
  isLoopbackAddress,
  WebFrontendError,
} from '../../../app/src/lib/webFrontend';
import { DeviceStore } from './devices';
import { loadBridgeIdentity } from './identity';
import { advertiseBridge, type BridgeAdvertiser } from './discovery';

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
  /** 工作区真实路径；默认 proot 的 /root/work，测试可传临时目录 */
  workspaceRoot?: string;
  /** dsh 数据目录；默认 $DSH_HOME 或 ~/.dsh，测试可传临时目录 */
  dshHome?: string;
  /** 宿主身份文件；默认跟设备密钥同目录，测试可传临时文件 */
  identityFile?: string;
  /** 覆盖广播名称；默认 os.hostname() */
  hostName?: string;
  /** 关掉 mDNS（测试/受限网络） */
  advertise?: boolean;
  /** 宿主形态；HostService 会传 phone，桌面默认 desktop */
  hostKind?: 'phone' | 'desktop';
}

const HOST_ID = 'host-real-dsh';

interface WorkspaceView {
  workspaceId?: string;
  path?: string;
  title?: string;
  sessionIds?: string[];
  createdAt?: number;
  updatedAt?: number;
}

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

function toSummary(
  item: RealSessionListItem,
  workspaceId?: string,
  pinned = false,
  hostId = HOST_ID,
): SessionSummary {
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
    workspaceId: workspaceId || basename(v?.workingDirectory ?? item.cwd) || 'workspace',
    hostId,
    status: item.running ? 'running' : 'idle',
    updatedAt: item.updatedAt,
    unread: 0,
    preview,
    ...(pinned ? { pinned: true } : {}),
  };
}

export interface RealBridge {
  port: number;
  close(): Promise<void>;
}

export async function startRealBridge(options: RealBridgeOptions): Promise<RealBridge> {
  const workspaceRoot = options.workspaceRoot ?? PROOT_WORKSPACE_ROOT;
  const dshHome = resolveDshHome(options.dshHome);
  const identity = loadBridgeIdentity(options.identityFile, options.hostName);
  const hostId = identity.hostId;
  const hostKind = options.hostKind ?? (process.env.DSH_PALM_HOST_KIND === 'phone' ? 'phone' : 'desktop');
  const client = new DshRealClient(options.baseUrl, options.token);
  await client.login();

  /** 已经删掉、但上游内存里可能还留着的会话：列表/详情/搜索都过滤掉 */
  const tombstones = new Set<string>();
  /** workspace/follow 的最新快照；列表和建会话都要用它做 session → workspace 映射 */
  let workspaceViews: WorkspaceView[] = [];
  let workspaceList: Workspace[] = [];
  let pinnedSessions = new Set<string>();
  let archivedSessions = new Set<string>();
  /** 默认会话 cwd；文件页/终端用它当根，避免停在 /root/work 这层容器 */
  let sessionCwd = '';
  let workspaceFetch: Promise<WorkspaceView[]> | null = null;

  function rebuildWorkspaceIndex(views: WorkspaceView[]): void {
    workspaceViews = views;
    const byIdByPath = new Map<string, string>();
    const bySession = new Map<string, string>();
    for (const view of views) {
      const id = String(view.workspaceId ?? '');
      const path = String(view.path ?? '');
      if (!id) continue;
      if (path) byIdByPath.set(path, id);
      for (const sessionId of view.sessionIds ?? []) {
        if (typeof sessionId === 'string' && sessionId) bySession.set(sessionId, id);
      }
    }
    workspaceIdByPath = byIdByPath;
    workspaceIdBySession = bySession;
  }

  let workspaceIdByPath = new Map<string, string>();
  let workspaceIdBySession = new Map<string, string>();

  /** 工作区快照的 sessionIds 又会变；映射每次刷新都重建 */
  async function fetchWorkspaceViews(): Promise<WorkspaceView[]> {
    if (workspaceFetch) return workspaceFetch;
    workspaceFetch = new Promise<WorkspaceView[]>((resolve) => {
      let done = false;
      let dispose: (() => void) | null = null;
      const finish = (list: WorkspaceView[]): void => {
        if (done) return;
        done = true;
        if (dispose) dispose();
        resolve(list);
      };
      dispose = client.openStream('workspace/follow', {}, (value) => {
        const v = value as {
          type?: string;
          value?: {
            items?: WorkspaceView[];
            archivedSessionIds?: string[];
            pinnedSessionIds?: string[];
          };
        };
        if (v.type !== 'baseline') return;
        archivedSessions = new Set((v.value?.archivedSessionIds ?? []).filter((id): id is string => typeof id === 'string'));
        pinnedSessions = new Set((v.value?.pinnedSessionIds ?? []).filter((id): id is string => typeof id === 'string'));
        finish(v.value?.items ?? []);
      });
      setTimeout(() => {
        dispose?.();
        finish([]);
      }, 4_000);
    }).finally(() => {
      workspaceFetch = null;
    });
    return workspaceFetch;
  }

  async function refreshWorkspaces(): Promise<WorkspaceView[]> {
    const views = await fetchWorkspaceViews().catch(() => [] as WorkspaceView[]);
    if (views.length > 0) rebuildWorkspaceIndex(views);
    workspaceList = views
      .map((view) => ({
        id: String(view.workspaceId ?? ''),
        name: String(view.title ?? view.path ?? ''),
        root: String(view.path ?? ''),
        presetIds: [],
      }))
      .filter((workspace) => workspace.id.length > 0);
    return views;
  }

  function sessionWorkingDir(item: RealSessionListItem): string {
    return item.projections?.values?.workingDirectory ?? item.cwd ?? '';
  }

  function rememberSessionCwd(item: RealSessionListItem): void {
    const cwd = sessionWorkingDir(item);
    if (!sessionCwd && cwd) sessionCwd = cwd;
  }

  /** 文件页/终端的根：优先会话真实 cwd，而不是 /root/work 这层“项目容器” */
  function activeWorkspaceRoot(): string {
    if (sessionCwd) return sessionCwd;
    const first = workspaceViews.find((view) => typeof view.path === 'string' && view.path.length > 0);
    return first?.path ?? workspaceRoot;
  }

  function workspaceIdFor(item: RealSessionListItem): string {
    const mapped = workspaceIdBySession.get(item.sessionId);
    if (mapped) return mapped;
    const cwd = item.projections?.values?.workingDirectory ?? item.cwd;
    if (cwd) {
      const byPath = workspaceIdByPath.get(cwd);
      if (byPath) return byPath;
    }
    return basename(cwd) || 'workspace';
  }

  await refreshWorkspaces().catch(() => undefined);

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
  async function answerEvent(
    approvalId: string,
    outcome: { kind: 'result'; value?: unknown } | { kind: 'next' },
    resolution?: { decision: 'approve' | 'reject'; by?: string; selected?: string[]; custom?: string },
  ): Promise<boolean> {
    const pending = pendingEvents.get(approvalId);
    if (!pending) return false;
    await client.submitEventResult({ clientId: eventClientId, eventId: pending.eventId, outcome });
    pendingEvents.delete(approvalId);
    broadcast('approval.resolved', {
      sessionId: pending.sessionId,
      approvalId,
      decision: resolution?.decision ?? 'approve',
      by: resolution?.by ?? 'user',
      ...(resolution?.selected ? { selected: resolution.selected } : {}),
      ...(resolution?.custom ? { custom: resolution.custom } : {}),
      at: Date.now(),
    });
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

  /**
   * 浏览器 OAuth 的本地回调中继。
   *
   * 上游 dsh 的 /oauth/callback 只接受 code+state；用户拒绝授权时浏览器会
   * 带 error=access_denied 回来，上游直接 400 并让 attempt 等到 600s 超时。
   * 桥起一个自己的 loopback 端口：成功时把 query 原样转给上游，失败时立刻
   * 调 account/cancelSignIn，让 App 的 1s 轮询马上看到 cancelled。
   */
  let signInRelay: { origin: string; close: () => Promise<void> } | null = null;

  async function signInCallbackOrigin(): Promise<string> {
    const upstreamOrigin = callbackOrigin();
    if (!upstreamOrigin) {
      throw Object.assign(new Error('这个宿主不在这台设备上，没法从手机完成登录'), {
        code: 'unsupported' satisfies ProtocolError['code'],
        hint: '连电脑时请在那台电脑的 dsh 界面里登录；手机只显示登录状态。',
      });
    }
    if (signInRelay) return signInRelay.origin;

    const relay = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method !== 'GET' || url.pathname !== '/oauth/callback') {
        res.writeHead(404, { 'cache-control': 'no-store' }).end();
        return;
      }
      const error = url.searchParams.get('error');
      if (error) {
        // 不把 error_description 反射进 HTML；只给一个固定的人话页面。
        void (async () => {
          try {
            const state = await accountRpc<{ attempt?: { id?: string } }>('account/getState', {});
            const attemptId = state?.attempt?.id;
            if (attemptId) await accountRpc('account/cancelSignIn', { attemptId });
          } catch {
            /* 取消失败也让浏览器看到固定页面；App 侧仍会走超时兜底 */
          }
        })();
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(
          '<!doctype html><meta charset="utf-8"><title>已取消授权</title>'
            + '<body style="font:16px system-ui;padding:32px">已取消授权，请回到锦囊重新登录。</body>',
        );
        return;
      }

      // 成功：保持 query 原样转发；上游只校验 code/state，不校验 Host。
      const target = new URL('/oauth/callback', upstreamOrigin);
      target.search = url.search;
      void fetch(target, { redirect: 'manual' })
        .then(async (upstream) => {
          const body = Buffer.from(await upstream.arrayBuffer());
          const headers: Record<string, string> = {};
          upstream.headers.forEach((value, key) => {
            if (key === 'content-length' || key === 'transfer-encoding') return;
            headers[key] = value;
          });
          res.writeHead(upstream.status, headers);
          res.end(body);
        })
        .catch(() => {
          if (!res.headersSent) res.writeHead(502, { 'cache-control': 'no-store' });
          res.end('登录回调转发失败，请回到锦囊重试。');
        });
    });

    await new Promise<void>((resolve, reject) => {
      relay.once('error', reject);
      relay.listen(0, '127.0.0.1', () => resolve());
    });
    const address = relay.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    signInRelay = {
      origin: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((resolve) => relay.close(() => resolve())),
    };
    return signInRelay.origin;
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

  for (const item of sessionList.items) rememberSessionCwd(item);
  console.log(
    `  已连上真 dsh：${sessionList.items.length} 个会话，${presetList.presets.length} 个宿主预设`
      + (sessionCwd ? `，工作区 ${sessionCwd}` : ''),
  );

  const presets = presetList.presets.map((p) => presetFromId(p.id, p.isDefault));

  function capabilities(): Capabilities {
    // 桥和引擎都在手机里（baseUrl 是 loopback）时，别把宿主说成"桌面"
    const local = callbackOrigin() !== null;
    return {
      protocol: PROTOCOL_VERSION,
      host: {
        id: hostId,
        kind: hostKind,
        name: identity.name,
        platform: 'dsh-web',
        engineVersion: '0.2.1-rc.5',
        fingerprint: identity.fingerprint,
      },
      events: ['engine.status', 'session.created', 'session.updated', 'account.updated'],
      // 桥实际实现了这些动作；switch_preset 不在内（真宿主没有会话内换预设）
      actions: ['approve', 'reject', 'steer', 'stop', 'create_session'],
      presets,
      workspaces: workspaceList,
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
  /** 当前流式步骤在宿主里的真实 step 号；assistant/message 的 content index 按它对齐 */
  let liveStepNo = 0;
  /** 正在流式的回合按会话存一份，sessions.get 时补进快照，避免重进会话看到两份 */
  const liveTurns = new Map<string, Turn>();
  const blockIdsBySession = new Map<string, Map<number, string>>();
  const blockIdByIndex = new Map<number, string>();

  function getSessionBlockIds(sid: string): Map<number, string> {
    let map = blockIdsBySession.get(sid);
    if (!map) {
      map = new Map<number, string>();
      blockIdsBySession.set(sid, map);
    }
    return map;
  }
  /** 非流式 assistant/message 可能与流式帧/重连快照重复，按事件指纹去重 */
  const seenAssistant = new Set<string>();
  /** 已收尾的 run，防止迟到的 turn/end 或 assistant/message 把回合重新拉起来 */
  const finishedRuns = new Map<string, Set<string>>();
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
    // 换会话或重开 follow 时保留 liveTurn 与对应会话的 blockId 映射；切走再切回不会丢流式状态
    followDispose?.();
    followDispose = null;
    followSessionId = sessionId;
    liveTurn = liveTurns.get(sessionId) ?? null;
    liveRunId = liveTurn?.runId ?? '';
    const blockIds = getSessionBlockIds(sessionId);
    blockIdByIndex.clear();
    for (const [idx, bId] of blockIds.entries()) {
      blockIdByIndex.set(idx, bId);
    }
    if (!sameSession && !liveTurn) {
      liveStep = 0;
      liveStepNo = 0;
    }

    followDispose = client.follow(sessionId, (value) => {
      try {
        handleFollowValue(sessionId, value);
      } catch {
        /* 单帧出错不影响整条流 */
      }
    });
  }

  function markRunFinished(sessionId: string, runId: string): void {
    if (!runId) return;
    const set = finishedRuns.get(sessionId) ?? new Set<string>();
    set.add(runId);
    finishedRuns.set(sessionId, set);
  }

  function wasRunFinished(sessionId: string, runId: string): boolean {
    return finishedRuns.get(sessionId)?.has(runId) ?? false;
  }

  function reviveRun(sessionId: string, runId: string): void {
    finishedRuns.get(sessionId)?.delete(runId);
  }

  function pruneEmptyLiveBlocks(turn: Turn): void {
    turn.blocks = turn.blocks.filter((block) => {
      if (block.kind !== 'text' && block.kind !== 'thinking') return true;
      return block.text.trim().length > 0 || block.done === true;
    });
  }

  function beginLiveTurn(
    sessionId: string,
    runId: string,
    createdAt: number,
    usage?: Turn['usage'],
  ): Turn {
    liveRunId = runId;
    liveTurn = {
      id: canonicalTurnId(runId),
      runId,
      role: 'assistant',
      createdAt,
      blocks: [],
      status: 'streaming',
      ...(usage ? { usage } : {}),
    };
    liveTurns.set(sessionId, liveTurn);
    reviveRun(sessionId, runId);
    broadcast('run.started', { sessionId, runId, turnId: liveTurn.id });
    return liveTurn;
  }

  function finishLiveTurn(
    sessionId: string,
    runIdHint: string | undefined,
    finalReason: 'done' | 'stopped' | 'error',
    errMsg = '',
    usage?: Turn['usage'],
  ): void {
    const turn = liveTurn;
    if (turn) addUsage(turn, usage);
    const runId = turn?.runId ?? runIdHint ?? liveRunId;
    if (runId) markRunFinished(sessionId, runId);

    if (!turn) {
      broadcast('run.finished', {
        sessionId,
        runId: runId || 'run',
        reason: finalReason,
        ...(usage ? { usage } : {}),
        ...(errMsg ? { error: errMsg } : {}),
      });
    } else {
      turn.status = finalReason;
      if (finalReason === 'error' && errMsg && turn.blocks.length === 0) {
        turn.blocks.push({
          kind: 'text',
          id: `${runId || 'run'}:live:error`,
          text: `错误：${errMsg}`,
        });
      }
      pruneEmptyLiveBlocks(turn);
      turn.meta = {
        steps: turn.blocks.length,
        durationMs: Math.max(1, Date.now() - turn.createdAt),
      };
      let preview = '';
      for (let i = turn.blocks.length - 1; i >= 0; i -= 1) {
        const block = turn.blocks[i];
        if (block && block.kind === 'text' && block.text.trim()) {
          preview = block.text.replace(/\s+/g, ' ').trim().slice(0, 120);
          break;
        }
      }
      broadcast('block.appended', { sessionId, runId: runId || 'run', turn });
      broadcast('run.finished', {
        sessionId,
        runId: runId || 'run',
        reason: finalReason,
        usage: turn.usage ?? usage,
        ...(errMsg ? { error: errMsg } : {}),
        ...(preview ? { preview } : {}),
      });
    }

    liveTurns.delete(sessionId);
    blockIdsBySession.delete(sessionId);
    liveTurn = null;
    liveRunId = '';
    liveStepNo = 0;
    blockIdByIndex.clear();
  }

  /**
   * 非流式 assistant/message：真引擎不保证每次都走 assistant-stream 增量。
   * 最终 message.content 是权威全文，用它覆盖同一步骤的流式块；工具调用按 callId 去重。
   */
  function handleAssistantMessage(
    sessionId: string,
    ev: { type?: string; seq?: number; time?: number },
    d: Record<string, unknown>,
  ): void {
    const info = assistantMessageInfo(ev, d);
    if (!info) return;
    const key = `${sessionId}:${info.key}`;
    if (seenAssistant.has(key)) return;

    const hintedRunId = info.runId ?? liveTurn?.runId ?? liveRunId;
    if (hintedRunId && !liveTurn && wasRunFinished(sessionId, hintedRunId)) return;
    seenAssistant.add(key);

    const entries = readContent(info.message.content);
    if (!liveTurn && entries.length === 0 && !info.usage) return;

    if (!liveTurn) {
      const runId = info.runId ?? canonicalRunId(info.turn, crypto.randomUUID())!;
      beginLiveTurn(sessionId, runId, Date.now(), info.usage);
      liveStepNo = info.step;
      blockIdByIndex.clear();
    } else if (info.runId && liveTurn.runId && info.runId !== liveTurn.runId) {
      finishLiveTurn(sessionId, liveTurn.runId, 'done');
      beginLiveTurn(sessionId, info.runId, Date.now(), info.usage);
      liveStepNo = info.step;
      blockIdByIndex.clear();
    } else {
      if (info.runId && !liveTurn.runId) {
        liveTurn.runId = info.runId;
        liveTurn.id = canonicalTurnId(info.runId);
        liveRunId = info.runId;
      }
      liveRunId = liveTurn.runId ?? liveRunId;
      if (info.step >= 0 && info.step !== liveStepNo) {
        liveStepNo = info.step;
        blockIdByIndex.clear();
      }
      addUsage(liveTurn, info.usage);
    }

    const turn = liveTurn;
    if (!turn) return;
    const runId = turn.runId ?? liveRunId;
    const sameStep = info.step < 0 || info.step === liveStepNo;
    const streamBlockIds = sameStep ? blockIdByIndex : undefined;
    const streamPrefix = sameStep ? `${runId}:live:${liveStep}:` : '';
    const messagePrefix = `${runId}:msg:${info.step}:`;

    const merged = mergeAssistantContent(turn, info.message.content, {
      textBlockId: (index) => `${runId}:msg:${info.step}:b${index}`,
      toolBlockId: (index, callId) =>
        callId ? `${runId}:tool:${callId}` : `${runId}:tool:msg:${info.step}:${index}`,
      streamBlockIds,
      findTextBlock: (entry, index) => {
        const streamId = streamBlockIds?.get(index);
        if (streamId) {
          const found = turn.blocks.find((b) => b.id === streamId);
          if (found && (found.kind === 'text' || found.kind === 'thinking')) return found;
        }
        const sameMessageBlock = turn.blocks.find(
          (b): b is Extract<Block, { kind: 'text' | 'thinking' }> =>
            (b.kind === 'text' || b.kind === 'thinking') &&
            b.kind === entry.kind &&
            b.id === `${messagePrefix}b${index}`,
        );
        if (sameMessageBlock) return sameMessageBlock;
        if (!streamPrefix) return undefined;
        for (let i = turn.blocks.length - 1; i >= 0; i -= 1) {
          const block = turn.blocks[i]!;
          if (block.kind !== entry.kind) continue;
          if (!block.id.startsWith(streamPrefix) && !block.id.startsWith(messagePrefix)) continue;
          if (!block.text || block.text === entry.text) return block;
          if (block.text.length >= 20 && entry.text?.startsWith(block.text)) return block;
        }
        return undefined;
      },
      markDone: true,
    });

    broadcast('block.appended', { sessionId, runId, turn });
    for (const block of merged.updated) {
      broadcast('block.updated', { sessionId, runId, turnId: turn.id, block });
    }
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
                const summary = toSummary(found, undefined, false, hostId);
                summary.title = nextTitle;
                broadcast('session.updated', { session: summary });
              }
            })
            .catch(() => undefined);
        }
        return;
      }
      if (ev?.type === 'assistant/message') {
        handleAssistantMessage(sessionId, ev, (ev.data ?? {}) as Record<string, unknown>);
        return;
      }
      if (ev?.type === 'tool/call') {
        const d = (ev.data ?? {}) as Record<string, unknown>;
        const runId = canonicalRunId(d.turn);
        if (!liveTurn) {
          beginLiveTurn(
            sessionId,
            runId ?? canonicalRunId(d.turn, crypto.randomUUID())!,
            Date.now(),
          );
        } else if (runId && liveTurn.runId && runId !== liveTurn.runId) {
          finishLiveTurn(sessionId, liveTurn.runId, 'done');
          beginLiveTurn(sessionId, runId, Date.now());
        }
        const turn = liveTurn!;
        liveRunId = turn.runId ?? liveRunId;
        const name = String(d.name ?? 'tool');
        const args = summarizeToolArgs(d.arguments);
        const callId = typeof d.callId === 'string' ? d.callId : '';
        const existing = callId
          ? turn.blocks.find(
              (b): b is Extract<Block, { kind: 'tool' }> =>
                b.kind === 'tool' && b.callId === callId,
            )
          : undefined;
        if (existing) {
          if ((!existing.name || existing.name === 'tool') && name) existing.name = name;
          if (!existing.summary) existing.summary = args;
          broadcast('block.updated', {
            sessionId,
            runId: liveRunId,
            turnId: turn.id,
            block: existing,
          });
          return;
        }
        turn.blocks.push({
          kind: 'tool',
          id: `${liveRunId}:tool:${callId || crypto.randomUUID()}`,
          ...(callId ? { callId } : {}),
          name,
          summary: args,
          state: 'running',
        });
        broadcast('block.appended', { sessionId, runId: liveRunId, turn });
        return;
      }
      if (ev?.type === 'tool/result') {
        const d = (ev.data ?? {}) as Record<string, unknown>;
        const msg = (d.message ?? {}) as Record<string, unknown>;
        const callId = String(msg.toolCallId ?? d.callId ?? '');
        const turn = liveTurn;
        if (!turn || !callId) return;
        const text = contentText(msg.content);
        let block = turn.blocks.find(
          (b): b is Extract<Block, { kind: 'tool' }> =>
            b.kind === 'tool' && b.callId === callId,
        );
        const appended = !block;
        if (!block) {
          block = {
            kind: 'tool',
            id: `${liveRunId}:tool:${callId}`,
            callId,
            name: String(msg.name ?? d.name ?? 'tool'),
            summary: '',
            state: 'running',
          };
          turn.blocks.push(block);
        }
        block.state = msg.isError === true ? 'error' : 'done';
        if (text) block.detail = text.slice(0, 200);
        if (appended) {
          broadcast('block.appended', { sessionId, runId: liveRunId, turn });
        } else {
          broadcast('block.updated', {
            sessionId,
            runId: liveRunId,
            turnId: turn.id,
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
        const runIdHint = canonicalRunId(ev.data?.turn, liveTurn?.runId ?? liveRunId);
        const usage = usageFrom(ev.data?.usage);

        if (runIdHint && !liveTurn && wasRunFinished(sessionId, runIdHint)) return;
        if (liveTurn && runIdHint && liveTurn.runId && liveTurn.runId !== runIdHint) {
          // 旧回合的 turn/end 迟到：只补 run.finished，不误收当前回合
          markRunFinished(sessionId, runIdHint);
          broadcast('run.finished', {
            sessionId,
            runId: runIdHint,
            reason: finalReason,
            ...(errMsg ? { error: errMsg } : {}),
          });
          return;
        }
        if (!liveTurn && finalReason === 'error') {
          const runId = runIdHint ?? canonicalRunId(ev.data?.turn, crypto.randomUUID())!;
          liveRunId = runId;
          liveTurn = {
            id: canonicalTurnId(runId),
            runId,
            role: 'assistant',
            createdAt: Date.now(),
            blocks: errMsg
              ? [{ kind: 'text', id: `${runId}:live:error`, text: `错误：${errMsg}` }]
              : [],
            status: 'error',
          };
          liveTurns.set(sessionId, liveTurn);
        }
        finishLiveTurn(sessionId, runIdHint, finalReason, errMsg, usage);
        return;
      }

      return;
    }

    if (value.type !== 'assistant-stream') return;
    const frame = (value as { frame?: Record<string, any> }).frame;
    if (!frame) return;

    if (frame.type === 'start') {
      const runId = canonicalRunId(frame.turn, String(frame.attemptId ?? crypto.randomUUID()))!;
      liveStep += 1;
      liveStepNo = typeof frame.step === 'number' ? frame.step : liveStep;
      const previous = liveTurn && liveTurn.runId === runId ? liveTurn : null;
      liveRunId = runId;
      liveTurn = {
        id: canonicalTurnId(runId),
        runId,
        role: 'assistant',
        createdAt: previous?.createdAt ?? Date.now(),
        blocks: [],
        status: 'streaming',
        ...(previous?.usage ? { usage: previous.usage } : {}),
      };
      blockIdByIndex.clear();
      getSessionBlockIds(sessionId).clear();
      liveTurns.set(sessionId, liveTurn);
      reviveRun(sessionId, runId);
      broadcast('run.started', { sessionId, runId: liveRunId, turnId: liveTurn.id });
      broadcast('block.appended', { sessionId, runId: liveRunId, turn: liveTurn });
      return;
    }

    if (frame.type !== 'chunk') return;
    if (!liveTurn) {
      liveTurn = liveTurns.get(sessionId) ?? null;
      if (!liveTurn) {
        liveTurn = beginLiveTurn(
          sessionId,
          liveRunId || canonicalRunId(undefined, crypto.randomUUID())!,
          Date.now(),
        );
      }
    }
    const chunk = (frame.chunk ?? {}) as Record<string, any>;
    const index = typeof chunk.index === 'number' ? chunk.index : 0;

    if (chunk.type === 'block-start') {
      const kind = chunk.blockType === 'reasoning' ? 'thinking' : 'text';
      const id = liveBlockId(liveRunId || 'run', liveStep, index);
      blockIdByIndex.set(index, id);
      getSessionBlockIds(sessionId).set(index, id);
      liveTurn.blocks.push({ kind, id, text: '' } as Block);
      broadcast('block.appended', { sessionId, runId: liveRunId, turn: liveTurn });
      return;
    }

    if (chunk.type === 'reasoning-delta' || chunk.type === 'text-delta') {
      const text = typeof chunk.text === 'string' ? chunk.text : '';
      if (!text) return;
      let blockId = blockIdByIndex.get(index) ?? getSessionBlockIds(sessionId).get(index);
      if (!blockId) {
        const kind = chunk.type === 'reasoning-delta' ? 'thinking' : 'text';
        blockId = liveBlockId(liveRunId || 'run', liveStep, index);
        blockIdByIndex.set(index, blockId);
        getSessionBlockIds(sessionId).set(index, blockId);
        liveTurn.blocks.push({ kind, id: blockId, text: '' } as Block);
        broadcast('block.appended', { sessionId, runId: liveRunId, turn: liveTurn });
      }
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
      const blockId = blockIdByIndex.get(index) ?? getSessionBlockIds(sessionId).get(index);
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
      for (const item of items) rememberSessionCwd(item);
      const sessions = items
        .filter((item) => !tombstones.has(item.sessionId) && !archivedSessions.has(item.sessionId))
        .map((item) => toSummary(item, workspaceIdFor(item), pinnedSessions.has(item.sessionId), hostId))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return { sessions };
    },

    'sessions.get': async ({ sessionId }) => {
      const { items } = await client.listSessions();
      const item = items.find((s) => s.sessionId === sessionId);
      if (!item || tombstones.has(sessionId)) {
        throw Object.assign(new Error('会话不存在'), { code: 'not_found' satisfies ProtocolError['code'] });
      }

      const snap = await client.snapshot(sessionId);
      const records = (snap?.records ?? []) as RealRecord[];
      const proj = projectRecords(records, { finalizeUnfinished: !item.running });
      if (!item.running) {
        liveTurns.delete(sessionId);
        blockIdsBySession.delete(sessionId);
      }
      const live = item.running ? liveTurns.get(sessionId) : undefined;

      const detail: SessionDetail = {
        ...toSummary(item, workspaceIdFor(item), pinnedSessions.has(sessionId), hostId),
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
          const block: Block = {
            kind: 'approval',
            id: 'ap-' + a.id,
            approvalId: a.id,
            snapshot: a,
          };
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

    // 真引擎建会话：工作区由客户端指定；没给才回退到默认工作区
    'sessions.create': async ({ presetId, title, workspaceId: requestedWorkspaceId }) => {
      let selectedWorkspaceId = String(requestedWorkspaceId ?? '').trim();
      let workspaceTitle = '';
      if (!selectedWorkspaceId) {
        const ws = await client.rpc<{ workspace: { workspaceId: string; title?: string } }>(
          'workspace/initializeDefault',
          {},
        );
        selectedWorkspaceId = ws.workspace.workspaceId;
        workspaceTitle = ws.workspace.title ?? '';
      } else {
        const known = workspaceViews.find((view) => view.workspaceId === selectedWorkspaceId);
        workspaceTitle = known?.title ?? known?.path ?? '';
      }
      const sessionId = 'session-' + crypto.randomUUID();
      await client.rpc('session/create', {
        request: { workspaceId: selectedWorkspaceId, sessionId, agentPreset: presetId },
      });
      workspaceIdBySession.set(sessionId, selectedWorkspaceId);
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
        workspaceId: selectedWorkspaceId,
        hostId,
        status: 'idle',
        updatedAt: Date.now(),
        unread: 0,
        preview: workspaceTitle,
      };
      broadcast('session.created', { session });
      return { session };
    },

    'sessions.import': async () => {
      // M2.2：真 dsh 没有公开的事件导入 API，不能假装原生回放。
      // App 只能把结构化 replay 渲染进 seed 文本后走 sessions.send。
      throw Object.assign(new Error('完整引擎不支持原生事件导入'), {
        code: 'unsupported' satisfies ProtocolError['code'],
        hint: '交接包已降级为 seed 文本；需要原生回放请等真宿主提供导入接口',
      });
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
          ...toSummary(item, workspaceIdFor(item), pinnedSessions.has(sessionId), hostId),
          turns: live ? mergeLiveTurn(proj.turns, live) : proj.turns,
          contract: { tools: [], net: 'allow' },
        },
      };
    },

    'sessions.pin': async ({ sessionId, pinned }) => {
      await client.rpc(pinned ? 'workspace/pinSession' : 'workspace/unpinSession', { sessionId });
      if (pinned) pinnedSessions.add(sessionId);
      else pinnedSessions.delete(sessionId);
      const { items } = await client.listSessions();
      const item = items.find((s) => s.sessionId === sessionId);
      if (item) {
        broadcast('session.updated', {
          session: toSummary(item, workspaceIdFor(item), pinnedSessions.has(sessionId), hostId),
        });
      }
      return { ok: true as const };
    },

    'sessions.archive': async ({ sessionId, archived }) => {
      await client.rpc(archived ? 'workspace/archiveSession' : 'workspace/unarchiveSession', {
        sessionId,
        ...(archived ? { stopActivity: true } : {}),
      });
      if (archived) archivedSessions.add(sessionId);
      else archivedSessions.delete(sessionId);
      return { ok: true as const };
    },

    'sessions.delete': async ({ sessionId }) => {
      const { items } = await client.listSessions();
      const item = items.find((s) => s.sessionId === sessionId);
      if (!item) {
        throw Object.assign(new Error('会话不存在'), { code: 'not_found' satisfies ProtocolError['code'] });
      }
      const pending = [...pendingEvents.values()].some((event) => event.sessionId === sessionId)
        || [...pendingQuestions.values()].some((question) => question.sessionId === sessionId);
      if (item.running || pending) {
        throw Object.assign(new Error('这个会话正在运行，先停止再删除'), {
          code: 'bad_request' satisfies ProtocolError['code'],
        });
      }

      const cwd = item.projections?.values?.workingDirectory ?? item.cwd ?? '';
      const dir = (await sessionDirFor(dshHome, cwd, sessionId)) ?? (await findSessionDir(dshHome, sessionId));
      if (dir) await deleteSessionDir(dir);

      // 上游没有 delete API：用 tombstone 立刻从列表/详情/搜索里隐藏；
      // 目录删掉后即使宿主内存里还留着会话，也不会再被写回。
      tombstones.add(sessionId);
      workspaceIdBySession.delete(sessionId);
      pinnedSessions.delete(sessionId);
      archivedSessions.delete(sessionId);
      liveTurns.delete(sessionId);
      finishedRuns.delete(sessionId);
      if (followSessionId === sessionId) {
        followDispose?.();
        followDispose = null;
        followSessionId = null;
        liveTurn = null;
      }
      for (const [id, event] of pendingEvents) {
        if (event.sessionId === sessionId) pendingEvents.delete(id);
      }
      for (const [id, question] of pendingQuestions) {
        if (question.sessionId === sessionId) pendingQuestions.delete(id);
      }
      return { ok: true as const };
    },

    'sessions.search': async ({ query, limit }) => {
      const q = query.trim().toLowerCase();
      if (!q) {
        throw Object.assign(new Error('搜索词不能为空'), { code: 'bad_request' satisfies ProtocolError['code'] });
      }
      if (q.length > 100) {
        throw Object.assign(new Error('搜索词太长'), { code: 'bad_request' satisfies ProtocolError['code'] });
      }
      const max = Math.min(Math.max(Math.trunc(limit ?? 20), 1), 50);
      const { items } = await client.listSessions();
      const results: Array<{
        sessionId: string;
        title: string;
        snippet: string;
        updatedAt: number;
        matches: number;
      }> = [];

      for (const item of items) {
        if (tombstones.has(item.sessionId)) continue;
        const cwd = item.projections?.values?.workingDirectory ?? item.cwd ?? '';
        const dir =
          (await sessionDirFor(dshHome, cwd, item.sessionId)) ?? (await findSessionDir(dshHome, item.sessionId));
        if (!dir) continue;
        const log = await latestSessionLog(dir).catch(() => null);
        if (!log) continue;
        let records: RealRecord[];
        try {
          records = readSessionLogBuffer(await readSessionLogFile(log.path));
        } catch {
          continue;
        }
        const projected = projectRecords(records, { finalizeUnfinished: !item.running });
        const summary = toSummary(item, workspaceIdFor(item), pinnedSessions.has(item.sessionId), hostId);
        const text = buildSessionSearchText(
          [summary.title, projected.title ?? ''].filter(Boolean).join('\n'),
          projected.turns,
        );
        const match = matchSessionText(text, q);
        if (!match) continue;
        results.push({
          sessionId: item.sessionId,
          title: summary.title,
          snippet: match.snippet,
          updatedAt: item.updatedAt,
          matches: match.matches,
        });
      }
      results.sort((a, b) => b.updatedAt - a.updatedAt);
      return { results: results.slice(0, max) };
    },

    'sessions.rewind': async ({ sessionId, turnId }) => {
      const result = (await handlers['sessions.get']({ sessionId }, {} as HandlerContext)) as {
        session: SessionDetail;
      };
      const session = result.session;
      const turnIndex = session.turns.findIndex((t: Turn) => t.id === turnId);
      if (turnIndex >= 0) {
        session.turns = session.turns.slice(0, turnIndex);
      }
      return { session };
    },

    'shell.run': async ({ command }) => {
      const text = String(command ?? '');
      if (!text.trim()) {
        throw Object.assign(new Error('命令不能为空'), { code: 'bad_request' satisfies ProtocolError['code'] });
      }
      if (text.length > 2_000) {
        throw Object.assign(new Error('命令太长（最多 2000 字）'), {
          code: 'bad_request' satisfies ProtocolError['code'],
        });
      }
      const mount = await createWorkspaceMount({
        backend: makeNodeBackend(activeWorkspaceRoot()),
        readOnly: true,
      });
      const runner = new ShellRunnerClass({
        fs: mount.fs,
        cwd: '/workspace',
        timeoutMs: 15_000,
        maxOutputChars: 20_000,
        beforeRun: () => mount.workspace.refreshIndex(),
      });
      const result = await runner.run(text);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        ms: result.ms,
        timedOut: result.timedOut,
        truncated: result.truncated,
      };
    },

    'workspaces.list': async () => {
      await refreshWorkspaces();
      return { workspaces: workspaceList };
    },

    'workspaces.create': async ({ path }) => {
      const raw = String(path ?? '').trim();
      if (!raw) {
        throw Object.assign(new Error('工作区名称不能为空'), { code: 'bad_request' satisfies ProtocolError['code'] });
      }
      const rootPath = resolve(workspaceRoot);
      const absolute = raw.startsWith('/') ? resolve(raw) : resolve(rootPath, raw);
      try {
        await stat(absolute);
      } catch {
        // 手机上的新工作区只允许落在 /root/work 下；其他路径必须是已存在的目录。
        if (absolute !== rootPath && !absolute.startsWith(rootPath + sep)) {
          throw Object.assign(new Error('新工作区路径必须在工作区根目录下'), {
            code: 'bad_request' satisfies ProtocolError['code'],
          });
        }
        await mkdir(absolute, { recursive: true });
      }
      const created = await client.rpc<{ workspace?: WorkspaceView }>(
        'workspace/create',
        { request: { path: absolute } },
      );
      const view = created.workspace ?? {};
      const workspace: Workspace = {
        id: String(view.workspaceId ?? ''),
        name: String(view.title ?? view.path ?? absolute),
        root: String(view.path ?? absolute),
        presetIds: [],
      };
      if (workspace.id) {
        workspaceViews = [...workspaceViews.filter((item) => item.workspaceId !== workspace.id), view];
        rebuildWorkspaceIndex(workspaceViews);
        workspaceIdByPath.set(workspace.root, workspace.id);
        workspaceList = [...workspaceList.filter((item) => item.id !== workspace.id), workspace];
      }
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
        ...toSummary(item, undefined, false, hostId),
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
        ...toSummary(item, undefined, false, hostId),
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
      const first = answers[0];
      const resolution = {
        decision: 'approve' as const,
        by: 'user',
        ...(Array.isArray(first?.selected) ? { selected: first.selected } : {}),
        ...(first?.custom ? { custom: first.custom } : {}),
      };
      const viaEvent = await answerEvent(
        eventId,
        { kind: 'result', value: { answers: complete } },
        resolution,
      ).catch(() => false);
      if (viaEvent) return { accepted: true as const };

      await client.rpc<boolean>('userQuestions/answer', {
        agentId: sessionId,
        callId,
        answer: { answers },
      });
      pendingEvents.delete(eventId);
      broadcast('approval.resolved', { sessionId, approvalId: callId, ...resolution, at: Date.now() });
      if (eventId !== callId) {
        broadcast('approval.resolved', { sessionId, approvalId: eventId, ...resolution, at: Date.now() });
      }
      return { accepted: true as const };
    },

    // 审批：同样走 $events，真引擎只接受 'allowed-once' 这一种批准
    'approvals.resolve': async ({ approvalId, decision }) => {
      const viaEvent = await answerEvent(
        approvalId,
        {
          kind: 'result',
          value: decision === 'approve' ? 'allowed-once' : 'rejected',
        },
        { decision, by: 'user' },
      ).catch(() => false);
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
      const origin = await signInCallbackOrigin();
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

    'fs.list': async ({ path }: { path?: string }) => listWorkspace(activeWorkspaceRoot(), path),
    'fs.rename': async ({ path, to }: { path: string; to: string }) => {
      await renameWorkspace(activeWorkspaceRoot(), path, to);
      return { ok: true as const };
    },
    'fs.delete': async ({ path }: { path: string }) => {
      await deleteWorkspace(activeWorkspaceRoot(), path);
      return { ok: true as const };
    },

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
      res.end(JSON.stringify({ ok: true, bridge: 'real', host: hostId, name: identity.name }));
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
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'event',
          event: 'device.paired',
          data: { key: issuedKey, hostId },
        }));
      }
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

  let advertiser: BridgeAdvertiser | null = null;
  if (options.advertise !== false) {
    advertiser = advertiseBridge({
      port,
      hostId,
      name: identity.name,
      kind: hostKind,
      fingerprint: identity.fingerprint,
    });
  }

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        advertiser?.close();
        advertiser = null;
        eventsDispose?.();
        accountWatchDispose?.();
        accountWatchDispose = null;
        followDispose?.();
        followDispose = null;
        void signInRelay?.close();
        signInRelay = null;
        for (const ws of clients) ws.close();
        wss.close();
        http.close(() => resolve());
      }),
  };
}
