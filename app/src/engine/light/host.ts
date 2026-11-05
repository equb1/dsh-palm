/**
 * 轻引擎的「宿主」：实现 app 协议里的方法，事件也按协议推。
 *
 * 这一层是 UI 与 agent 之间的缝：UI 只看到 Capabilities / Session / Approval，
 * 所以轻引擎和真引擎可以互换（`LocalEngineClient` 把这里的 onEvent/request
 * 包装成和 `EngineClient` 一样的接口）。
 *
 * 不实现的东西要显式拒绝（带 hint），不要假装成功：
 * 账号登录、插件、回执式附件上传、多工作区 —— 这些是 M2/M3 的事。
 * （1.3 起附件由 App 原生收件落进 /workspace/uploads，只用 files 传路径。）
 */
import { EngineProtocolError } from '../../lib/client';
import { AttachmentPathError, promptWithFiles } from '../../lib/attachments/prompt';
import { listProviderModels } from './catalog';
import {
  PROTOCOL_VERSION,
  type Approval,
  type ApprovalDecision,
  type Capabilities,
  type CapabilityContract,
  type EngineEvent,
  type EventName,
  type EventPayloads,
  type FileRef,
  type HandoffBlockedCall,
  type Method,
  type ModelOption,
  type PermissionOption,
  type Preset,
  type RequestParams,
  type RequestResults,
  type SessionDetail,
  type SessionStatus,
  type SessionSummary,
  type Workspace,
} from '../../protocol';
import { Agent, userTurnFromText, type RunOutcome, type RunSink } from './agent';
import { SessionRepo, newRunId, newSessionId } from './sessionRepo';
import { buildHandoff } from '../../lib/handoff';
import { toolsForPermission } from './tools';
import type {
  AskAnswer,
  AskQuestion,
  LightImageConfig,
  LightModelConfig,
  LightPendingApproval,
  LightPendingQuestion,
  LightRun,
  StoredSession,
  PermissionPreset,
} from './types';
import { streamChat } from './provider';
import { WORKSPACE_MOUNT } from '../fs/mount';
import type { SandboxFs } from '../fs/sandbox';
import type { ShellRunner } from '../shell/bash';

export const LIGHT_HOST_ID = 'light-local';
export const LIGHT_WORKSPACE_ID = 'local';

const PRESETS: Preset[] = [
  {
    id: 'light',
    name: '轻引擎',
    glyph: '✦',
    tagline: '手机默认：秒开，能读写 /workspace、生成文档',
    version: '0.1.0',
    builtin: true,
    contract: {
      tools: [
        'bash',
        'read_file',
        'write_file',
        'list_dir',
        'create_docx',
        'create_xlsx',
        'read_docx',
        'read_xlsx',
        'generate_image',
        'ask_user_question',
      ],
      fs: [{ path: WORKSPACE_MOUNT, mode: 'rw' }],
      net: 'allow',
    },
    modelPolicy: { prefer: 'cheap' },
  },
  {
    id: 'reader',
    name: '只读',
    glyph: '◌',
    tagline: '只查资料，不改工作区',
    version: '0.1.0',
    builtin: true,
    contract: {
      tools: ['read_file', 'list_dir', 'read_docx', 'read_xlsx', 'ask_user_question'],
      fs: [{ path: WORKSPACE_MOUNT, mode: 'ro' }],
      net: 'allow',
    },
    modelPolicy: { prefer: 'cheap' },
  },
];

const PERMISSIONS: PermissionOption[] = [
  { value: 'read-only', name: '只读', description: '不能执行命令、不能写文件' },
  { value: 'workspace-write', name: '工作区（推荐）', description: '命令和写入每次都要你批准' },
  { value: 'danger-full-access', name: '完整', description: '不再逐次批准；仍只能访问 /workspace' },
];

const APPROVAL_TIMEOUT = 5 * 60_000;
const QUESTION_TIMEOUT = 10 * 60_000;

export interface LightHostOptions {
  workspace: SandboxFs;
  shell: ShellRunner;
  dataFs: SandboxFs;
  model: LightModelConfig;
  /** 可选生图渠道 */
  image?: LightImageConfig;
  hostName?: string;
  maxSteps?: number;
  approvalTimeoutMs?: number;
  questionTimeoutMs?: number;
  now?: () => number;
  onWarn?: (message: string) => void;
  /** 诊断日志：真机上报 ttft / run 结束，测试不传 */
  onLog?: (message: string) => void;
  /** 测试注入假模型 */
  stream?: typeof streamChat;
}

type Listener = (event: EngineEvent) => void;

export class LightHost {
  private readonly options: LightHostOptions;
  private readonly repo: SessionRepo;
  private readonly agent: Agent;
  private readonly now: () => number;
  private readonly sessions = new Map<string, StoredSession>();
  private readonly runs = new Map<string, LightRun>();
  private readonly statuses = new Map<string, SessionStatus>();
  private readonly approvals = new Map<string, LightPendingApproval>();
  private readonly questions = new Map<string, LightPendingQuestion>();
  private readonly listeners = new Set<Listener>();
  private readonly caps: Capabilities;
  private readonly workspace: Workspace;
  private readyPromise: Promise<void> | null = null;
  private catalogCache: { at: number; models: ModelOption[] } | null = null;
  private seq = 0;
  private closed = false;

  constructor(options: LightHostOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.repo = new SessionRepo(options.dataFs, '/sessions', options.onWarn);
    this.agent = new Agent({
      model: options.model,
      workspace: options.workspace,
      bash: options.shell,
      ...(options.image ? { image: options.image } : {}),
      ...(options.maxSteps ? { maxSteps: options.maxSteps } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.stream ? { stream: options.stream } : {}),
      ...(options.onLog ? { log: options.onLog } : {}),
    });
    this.workspace = {
      id: LIGHT_WORKSPACE_ID,
      name: '本机工作区',
      root: WORKSPACE_MOUNT,
      presetIds: PRESETS.map((preset) => preset.id),
    };
    this.caps = {
      protocol: PROTOCOL_VERSION,
      host: {
        id: LIGHT_HOST_ID,
        kind: 'phone',
        name: options.hostName ?? '锦囊轻引擎',
        platform: 'hermes',
        engineVersion: '0.1.0-light',
      },
      events: [
        'engine.status',
        'session.created',
        'session.updated',
        'run.started',
        'block.appended',
        'block.delta',
        'block.updated',
        'run.finished',
        'approval.requested',
        'approval.resolved',
        'capability.missing',
      ],
      actions: ['approve', 'reject', 'steer', 'stop', 'switch_preset', 'create_session'],
      presets: PRESETS,
      workspaces: [this.workspace],
      limits: { maxAttachmentMB: 0, maxFetchFileMB: 0 },
    };
  }

  /* --------------------------- 生命周期 --------------------------- */

  ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        const stored = await this.repo.list();
        for (const session of stored) this.sessions.set(session.id, session);
      })();
    }
    return this.readyPromise;
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    for (const run of this.runs.values()) {
      run.abortKind = 'stop';
      run.step.abort();
    }
    this.runs.clear();
    for (const pending of this.approvals.values()) pending.resolve('reject');
    this.approvals.clear();
    for (const pending of this.questions.values()) {
      pending.resolve({ id: pending.approval.questionId ?? '', selected: [], custom: '引擎已关闭' });
    }
    this.questions.clear();
    this.listeners.clear();
  }

  get capabilities(): Capabilities {
    return this.caps;
  }

  private emit<K extends EventName>(event: K, data: EventPayloads[K]): void {
    if (this.closed) return;
    this.seq += 1;
    const message = { type: 'event' as const, v: PROTOCOL_VERSION, event, seq: this.seq, data } as EngineEvent<K>;
    for (const listener of [...this.listeners]) {
      try {
        listener(message as EngineEvent);
      } catch (error) {
        this.options.onWarn?.(`事件监听器报错：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /* --------------------------- 请求 --------------------------- */

  async request<M extends Method>(method: M, params: RequestParams[M]): Promise<RequestResults[M]> {
    await this.ready();
    const handler = (this.handlers as Record<string, (input: unknown) => Promise<unknown>>)[method];
    if (!handler) {
      throw new EngineProtocolError({
        code: 'unsupported',
        message: `轻引擎还没有实现 ${method}`,
        hint: '这一步属于完整引擎（proot）或 M2 之后的能力',
      });
    }
    try {
      return (await handler.call(this, params)) as RequestResults[M];
    } catch (error) {
      if (error instanceof EngineProtocolError) throw error;
      throw new EngineProtocolError({
        code: 'internal',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private get handlers(): Record<string, (params: never) => Promise<unknown>> {
    return {
      'capabilities.get': async () => this.caps,
      'sessions.list': async () => ({
        sessions: [...this.sessions.values()]
          .filter((session) => !session.archived)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((session) => this.summary(session)),
      }),
      'sessions.get': async ({ sessionId }: { sessionId: string }) => ({
        session: this.detail(this.requireSession(sessionId)),
      }),
      'sessions.create': async ({
        presetId,
        title,
      }: {
        presetId: string;
        workspaceId?: string;
        title?: string;
      }) => {
        const preset = PRESETS.find((candidate) => candidate.id === presetId) ?? PRESETS[0]!;
        const session: StoredSession = {
          id: newSessionId(),
          title: title?.trim() || '新会话',
          presetId: preset.id,
          workspaceId: LIGHT_WORKSPACE_ID,
          createdAt: this.now(),
          updatedAt: this.now(),
          pinned: false,
          archived: false,
          permission: preset.id === 'reader' ? 'read-only' : 'workspace-write',
          model: this.modelChoice(),
          turns: [],
          history: [],
        };
        this.sessions.set(session.id, session);
        await this.repo.save(session);
        this.emit('session.created', { session: this.summary(session) });
        return { session: this.summary(session) };
      },
      'sessions.import': async ({
        presetId,
        title,
        text,
      }: {
        presetId?: string;
        title?: string;
        text: string;
        workspaceId?: string;
      }) => {
        const body = text.trim();
        if (!body) throw new EngineProtocolError({ code: 'bad_request', message: '交接 seed 为空' });
        const preset = PRESETS.find((candidate) => candidate.id === presetId) ?? PRESETS[0]!;
        const session: StoredSession = {
          id: newSessionId(),
          title: title?.trim() || '继续的会话',
          presetId: preset.id,
          workspaceId: LIGHT_WORKSPACE_ID,
          createdAt: this.now(),
          updatedAt: this.now(),
          pinned: false,
          archived: false,
          permission: preset.id === 'reader' ? 'read-only' : 'workspace-write',
          model: this.modelChoice(),
          turns: [],
          history: [],
        };
        this.sessions.set(session.id, session);
        this.appendUserMessage(session, body);
        await this.repo.save(session);
        return { session: this.summary(session) };
      },
      'sessions.send': async ({
        sessionId,
        text,
        attachments,
        files,
      }: {
        sessionId: string;
        text: string;
        attachments?: string[];
        files?: FileRef[];
      }) => {
        const session = this.requireSession(sessionId);
        if (attachments && attachments.length > 0) {
          throw new EngineProtocolError({
            code: 'unsupported',
            message: '轻引擎不收回执式附件',
            hint: '附件已由 App 收件到 /workspace/uploads，请用 files 传路径引用',
          });
        }
        if (this.runs.has(sessionId)) {
          throw new EngineProtocolError({
            code: 'busy',
            message: '这个会话正在运行',
            hint: '想中途补充要求，直接发消息（会走插话）',
          });
        }
        const body = this.textWithFiles(text, files);
        if (!body) throw new EngineProtocolError({ code: 'bad_request', message: '消息为空' });
        this.appendUserMessage(session, body);
        await this.save(session);
        const runId = this.startRun(session);
        return { accepted: true as const, runId };
      },
      'sessions.steer': async ({
        sessionId,
        text,
        attachments,
        files,
      }: {
        sessionId: string;
        text: string;
        attachments?: string[];
        files?: FileRef[];
      }) => {
        const session = this.requireSession(sessionId);
        if (attachments && attachments.length > 0) {
          throw new EngineProtocolError({
            code: 'unsupported',
            message: '轻引擎不收回执式附件',
            hint: '附件已由 App 收件到 /workspace/uploads，请用 files 传路径引用',
          });
        }
        const body = this.textWithFiles(text, files);
        if (!body) throw new EngineProtocolError({ code: 'bad_request', message: '消息为空' });
        this.appendUserMessage(session, body);
        await this.save(session);
        const run = this.runs.get(sessionId);
        if (run) {
          run.abortKind = 'steer';
          run.step.abort();
        } else {
          this.startRun(session);
        }
        return { accepted: true as const };
      },
      /**
       * 轻引擎专用交接包：只从 StoredSession.history 里抽，
       * 保证工具参数/结果原样带走（不重新跑一遍）。
       */
      'sessions.handoff': async ({
        sessionId,
        reason,
        userText,
        assistantText,
        missing,
        blockedCallIds,
        files,
        recentTurns,
      }: {
        sessionId: string;
        reason?: string;
        userText?: string;
        assistantText?: string;
        missing?: string[];
        blockedCallIds?: string[];
        files?: FileRef[];
        recentTurns?: number;
      }) => {
        const session = this.requireSession(sessionId);
        const wanted = new Set(blockedCallIds ?? []);
        const blocked: HandoffBlockedCall[] = [];
        if (wanted.size > 0) {
          for (const message of session.history) {
            for (const call of message.tool_calls ?? []) {
              if (!wanted.has(call.id)) continue;
              let args: Record<string, unknown> = {};
              try {
                const parsed = JSON.parse(call.function.arguments || '{}') as unknown;
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                  args = parsed as Record<string, unknown>;
                }
              } catch {
                /* 参数损坏就带空对象，至少保留调用 id/name */
              }
              blocked.push({ callId: call.id, name: call.function.name, args });
            }
          }
        }
        return buildHandoff({
          conversationId: session.id,
          reason: reason?.trim() || 'capability_missing',
          from: { engine: 'light', sessionId: session.id, hostId: LIGHT_HOST_ID },
          presetId: session.presetId,
          presetForTarget: session.presetId,
          permission: { source: session.permission, target: session.permission, escalated: false },
          model: { source: session.model ?? this.modelChoice(), matched: true },
          channel: {
            baseURL: this.options.model.baseURL,
            model: this.options.model.model,
            apiKeyRef: 'light-engine',
          },
          history: session.history,
          turns: session.turns,
          ...(userText ? { userText } : {}),
          ...(assistantText ? { assistantText } : {}),
          ...(files && files.length > 0 ? { files } : {}),
          ...(blocked.length > 0 ? { blocked } : {}),
          ...(missing && missing.length > 0 ? { missing } : {}),
          ...(recentTurns ? { limit: recentTurns } : {}),
        });
      },
      'sessions.stop': async ({ sessionId }: { sessionId: string }) => {
        const run = this.runs.get(sessionId);
        if (run) {
          run.abortKind = 'stop';
          run.step.abort();
          this.rejectPending(sessionId, 'stop');
        }
        return { accepted: true as const };
      },
      'sessions.setPreset': async ({ sessionId, presetId }: { sessionId: string; presetId: string }) => {
        const session = this.requireSession(sessionId);
        const preset = PRESETS.find((candidate) => candidate.id === presetId);
        if (!preset) throw new EngineProtocolError({ code: 'not_found', message: `没有这个预设：${presetId}` });
        session.presetId = preset.id;
        session.permission = preset.id === 'reader' ? 'read-only' : session.permission === 'read-only' ? 'workspace-write' : session.permission;
        await this.save(session);
        return { session: this.detail(session) };
      },
      'sessions.setPermission': async ({ sessionId, preset }: { sessionId: string; preset: string }) => {
        const session = this.requireSession(sessionId);
        if (!PERMISSIONS.some((option) => option.value === preset)) {
          throw new EngineProtocolError({ code: 'bad_request', message: `未知权限：${preset}` });
        }
        session.permission = preset as PermissionPreset;
        await this.save(session);
        return { session: this.detail(session) };
      },
      'sessions.setModel': async ({
        sessionId,
        provider,
        model,
      }: {
        sessionId: string;
        provider: string;
        model: string;
      }) => {
        const session = this.requireSession(sessionId);
        session.model = { provider, model };
        await this.save(session);
        return { session: this.detail(session) };
      },
      'sessions.rename': async ({ sessionId, title }: { sessionId: string; title: string }) => {
        const session = this.requireSession(sessionId);
        const trimmed = title.trim();
        if (!trimmed) throw new EngineProtocolError({ code: 'bad_request', message: '标题为空' });
        session.title = trimmed.slice(0, 60);
        await this.save(session);
        return { session: this.detail(session) };
      },
      'sessions.pin': async ({ sessionId, pinned }: { sessionId: string; pinned: boolean }) => {
        const session = this.requireSession(sessionId);
        session.pinned = pinned;
        await this.save(session);
        return { ok: true as const };
      },
      'sessions.archive': async ({ sessionId, archived }: { sessionId: string; archived: boolean }) => {
        const session = this.requireSession(sessionId);
        session.archived = archived;
        await this.save(session);
        return { ok: true as const };
      },
      'sessions.delete': async ({ sessionId }: { sessionId: string }) => {
        const session = this.requireSession(sessionId);
        if (this.runs.has(session.id)) {
          throw new EngineProtocolError({
            code: 'bad_request',
            message: '这个会话正在运行，先停止再删除',
          });
        }
        this.sessions.delete(session.id);
        this.statuses.delete(session.id);
        await this.repo.remove(session.id);
        return { ok: true as const };
      },
      'models.list': async () => {
        const currentModel: ModelOption = {
          provider: this.providerId(),
          providerName: this.options.model.providerName ?? '轻引擎',
          id: this.options.model.model,
          name: this.options.model.model,
          description: '轻引擎当前使用的模型',
        };
        const catalog = await this.modelCatalog();
        const models = catalog.length > 0 ? catalog.slice() : [currentModel];
        // 旧配置的 deepseek-chat 不在账号目录里，仍然让用户能选回当前值
        if (!models.some((item) => item.id === currentModel.id)) models.unshift(currentModel);
        return { models, default: this.modelChoice() };
      },
      'permissions.list': async () => ({ options: PERMISSIONS, default: 'workspace-write' }),
      'presets.list': async () => ({ presets: PRESETS }),
      'workspaces.list': async () => ({ workspaces: [this.workspace] }),
      'workspaces.create': async () => {
        throw new EngineProtocolError({
          code: 'unsupported',
          message: '轻引擎只有一个固定工作区',
          hint: '工作区目录是 App 私有目录里的 <filesDir>/workspace；多工作区在 M2 做',
        });
      },
      'fs.list': async ({ path }: { path?: string }) => {
        const raw = (path ?? '/').trim() || '/';
        const target = raw.startsWith('/')
          ? raw.replace(/\/+$/, '') || '/'
          : `/${raw.replace(/\/+$/, '')}`;
        try {
          const stat = await this.options.workspace.stat(target);
          if (!stat.isDirectory) {
            throw new EngineProtocolError({ code: 'bad_request', message: '这不是目录' });
          }
          const items = await this.options.workspace.readdirWithFileTypes(target);
          const entries: Array<{ name: string; kind: 'file' | 'dir'; size: number; mtime: number }> = [];
          for (const item of items.slice(0, 500)) {
            const child = target === '/' ? `/${item.name}` : `${target}/${item.name}`;
            let size = 0;
            let mtime = 0;
            try {
              const info = await this.options.workspace.stat(child);
              size = info.size;
              mtime = info.mtime.getTime();
            } catch {
              // 单个子项 stat 失败（刚删除/没权限）不该让整页失败
            }
            entries.push({
              name: item.name,
              kind: item.isDirectory ? 'dir' : 'file',
              size,
              mtime,
            });
          }
          entries.sort((a, b) =>
            a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
          );
          return { path: target, entries };
        } catch (error) {
          if (error instanceof EngineProtocolError) throw error;
          throw new EngineProtocolError({
            code: 'bad_request',
            message: `读不了这个目录：${error instanceof Error ? error.message : String(error)}`,
          });
        }
      },
      'approvals.list': async ({ sessionId }: { sessionId?: string }) => ({
        approvals: [...this.approvals.values()]
          .map((pending) => pending.approval)
          .filter((approval) => !sessionId || approval.sessionId === sessionId),
      }),
      'approvals.resolve': async ({ approvalId, decision }: { approvalId: string; decision: ApprovalDecision }) => {
        const pending = this.approvals.get(approvalId);
        if (!pending) {
          throw new EngineProtocolError({ code: 'not_found', message: '这个审批已经处理过了' });
        }
        this.approvals.delete(approvalId);
        if (pending.timer) clearTimeout(pending.timer);
        this.emit('approval.resolved', { approvalId, decision, by: 'user' });
        pending.resolve(decision);
        this.resumeStatus(pending.approval.sessionId);
        return { accepted: true as const };
      },
      'questions.answer': async ({
        sessionId,
        callId,
        answers,
      }: {
        sessionId: string;
        callId: string;
        answers: Array<{ id: string; selected: string[]; custom?: string }>;
      }) => {
        const pending = this.questions.get(callId);
        if (!pending) {
          throw new EngineProtocolError({ code: 'not_found', message: '这个问题已经回答或过期了' });
        }
        this.questions.delete(callId);
        if (pending.timer) clearTimeout(pending.timer);
        const answer = answers[0] ?? { id: pending.approval.questionId ?? '', selected: [] };
        this.emit('approval.resolved', { approvalId: callId, decision: 'approve', by: 'user' });
        pending.resolve({
          id: answer.id,
          selected: Array.isArray(answer.selected) ? answer.selected : [],
          ...(answer.custom ? { custom: answer.custom } : {}),
        });
        this.resumeStatus(sessionId);
        return { accepted: true as const };
      },
      'attachments.upload': async () => {
        throw new EngineProtocolError({
          code: 'unsupported',
          message: '附件已落在 /workspace/uploads，直接给路径',
          hint: '轻引擎不再接收 base64 附件；用 sessions.send 的 files 字段传路径引用',
        });
      },
      'credentials.describe': async ({ refs }: { refs: string[] }) => ({
        credentials: Object.fromEntries(refs.map((ref) => [ref, { configured: false, writable: false }])),
      }),
      'credentials.set': async () => {
        throw new EngineProtocolError({
          code: 'unsupported',
          message: '轻引擎的模型 Key 在「设置 → M1 实验室」里配置',
          hint: '它只存在本机 SecureStore，不经过宿主',
        });
      },
      'credentials.unset': async () => ({ ok: true as const }),
      'account.state': async () => ({
        account: {
          status: 'signed-out' as const,
          attempt: null,
          links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' },
        },
      }),
      'account.signIn': async () => {
        throw new EngineProtocolError({
          code: 'unsupported',
          message: '轻引擎不接账号登录',
          hint: '用「M1 实验室」里的 Base URL / API Key；账号登录走完整引擎',
        });
      },
      'account.cancelSignIn': async () => ({ account: { status: 'signed-out' as const, attempt: null, links: { usageUrl: '', topUpUrl: '' } } }),
      'account.signOut': async () => ({ account: { status: 'signed-out' as const, attempt: null, links: { usageUrl: '', topUpUrl: '' } } }),
      'providers.list': async () => ({
        providers: [
          {
            id: this.providerId(),
            displayName: this.options.model.providerName ?? '轻引擎模型',
            api: 'openai-completions' as const,
            baseURL: this.options.model.baseURL,
            models: [{ id: this.options.model.model, name: this.options.model.model }],
            configured:
              this.options.model.apiKey.length > 0 || Boolean(this.options.model.authToken),
            source: 'custom' as const,
          },
        ],
      }),
      'providers.catalog': async () => ({ providers: [] }),
      'providers.discover': async ({
        baseURL,
        api,
        apiKey,
      }: {
        baseURL: string;
        api: string;
        apiKey?: string;
      }) => {
        if (api !== 'openai-completions') {
          throw new EngineProtocolError({
            code: 'unsupported',
            message: '轻引擎只支持 OpenAI 兼容协议',
            hint: 'Anthropic / OpenAI Responses 渠道请切完整引擎配置',
          });
        }
        const base = baseURL.trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(base)) {
          throw new EngineProtocolError({
            code: 'bad_request',
            message: 'Base URL 要以 http:// 或 https:// 开头',
          });
        }
        const current = this.options.model;
        const sameBase = base === current.baseURL.trim().replace(/\/+$/, '');
        const key = apiKey?.trim();
        const catalog = await listProviderModels({
          baseURL: base,
          ...(key
            ? { apiKey: key }
            : sameBase && current.apiKey
              ? { apiKey: current.apiKey }
              : sameBase && current.authToken
                ? { authToken: current.authToken }
                : {}),
        });
        if (catalog.length === 0) {
          throw new EngineProtocolError({
            code: 'bad_request',
            message: '服务商没有返回模型',
            hint: '检查 Base URL / API Key 是否有效，或换一个 OpenAI 兼容地址',
          });
        }
        return { models: catalog };
      },
      'providers.save': async () => {
        throw new EngineProtocolError({
          code: 'unsupported',
          message: '轻引擎的模型渠道在设置页的「模型提供商」卡片里保存',
          hint: '宿主侧的 providers.save 不是轻引擎的入口',
        });
      },
      'providers.remove': async () => {
        throw new EngineProtocolError({ code: 'unsupported', message: '轻引擎没有可删除的提供商' });
      },
    };
  }

  /* --------------------------- 运行 --------------------------- */

  private startRun(session: StoredSession): string {
    const runId = newRunId();
    const run: LightRun = {
      sessionId: session.id,
      runId,
      step: new AbortController(),
      abortKind: null,
      finished: false,
    };
    this.runs.set(session.id, run);
    this.statuses.set(session.id, 'running');
    // turnId 要等 agent 建完回合才知道；协议里这个字段 UI 不用
    this.emit('run.started', { sessionId: session.id, runId, turnId: '' });
    this.emit('session.updated', { session: this.summary(session) });
    void this.executeRun(session, run);
    return runId;
  }

  private async executeRun(session: StoredSession, run: LightRun): Promise<void> {
    const sink: RunSink = {
      emit: (event, data) => this.emit(event, data),
      requestApproval: (input) => this.requestApproval(session, run, input),
      askUser: (question) => this.askQuestion(session, run, question),
      setStatus: (status) => {
        this.statuses.set(session.id, status);
        this.emit('session.updated', { session: this.summary(session) });
      },
      persist: async () => {
        await this.save(session);
      },
    };

    let outcome: RunOutcome;
    try {
      outcome = await this.agent.run(session, run, sink);
    } catch (error) {
      outcome = { reason: 'error', error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.runs.delete(session.id);
      this.statuses.delete(session.id);
    }

    await this.save(session).catch((error: unknown) => {
      this.options.onWarn?.(`保存会话失败：${error instanceof Error ? error.message : String(error)}`);
    });
    this.emit('run.finished', {
      sessionId: session.id,
      runId: run.runId,
      reason: outcome.reason === 'error' ? 'error' : outcome.reason,
      ...(outcome.usage ? { usage: outcome.usage } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    });
  }

  private requestApproval(
    session: StoredSession,
    _run: LightRun,
    input: { title: string; command: string; risk: Approval['risk']; summary: string },
  ): Promise<ApprovalDecision> {
    const id = `ap_${this.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const approval: Approval = {
      id,
      sessionId: session.id,
      runId: _run.runId,
      createdAt: this.now(),
      kind: 'approval',
      title: input.title,
      ...(input.command ? { command: input.command } : {}),
      risk: input.risk,
      summary: input.summary,
      actions: ['approve', 'reject'],
    };

    return new Promise<ApprovalDecision>((resolve) => {
      const timeout = this.options.approvalTimeoutMs ?? APPROVAL_TIMEOUT;
      const timer = setTimeout(() => {
        this.approvals.delete(id);
        this.emit('approval.resolved', { approvalId: id, decision: 'reject', by: 'timeout' });
        resolve('reject');
      }, timeout);
      this.approvals.set(id, {
        approval,
        timer,
        resolve: (decision) => {
          clearTimeout(timer);
          resolve(decision);
        },
      });
      this.statuses.set(session.id, 'waiting_approval');
      this.emit('approval.requested', { approval });
      this.emit('session.updated', { session: this.summary(session) });
    });
  }

  private askQuestion(
    session: StoredSession,
    run: LightRun,
    question: AskQuestion,
  ): Promise<AskAnswer> {
    const callId = `q_${this.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const questionId = question.id ?? callId;
    const approval: Approval = {
      id: callId,
      sessionId: session.id,
      runId: run.runId,
      createdAt: this.now(),
      kind: 'question',
      title: question.header ?? '需要你选一下',
      ...(question.question ? { command: question.question } : {}),
      risk: 'low',
      summary: question.multiSelect ? '可以多选；也可以直接输入你自己的答案。' : '点一个选项，或直接输入你自己的答案；也可以跳过。',
      actions: ['approve', 'reject'],
      ...(question.options ? { options: question.options } : {}),
      ...(question.multiSelect ? { multiSelect: true } : {}),
      questionId,
    };

    return new Promise<AskAnswer>((resolve) => {
      const timeout = this.options.questionTimeoutMs ?? QUESTION_TIMEOUT;
      const timer = setTimeout(() => {
        this.questions.delete(callId);
        this.emit('approval.resolved', { approvalId: callId, decision: 'reject', by: 'timeout' });
        resolve({ id: questionId, selected: [], custom: '（用户没有回答，已超时）' });
      }, timeout);
      this.questions.set(callId, {
        approval,
        timer,
        resolve: (answer) => {
          clearTimeout(timer);
          resolve(answer);
        },
      });
      this.statuses.set(session.id, 'waiting_approval');
      this.emit('approval.requested', { approval });
      this.emit('session.updated', { session: this.summary(session) });
    });
  }

  /** stop 时把挂着的审批/提问一起收掉，别让 agent 留在 await 里 */
  private rejectPending(sessionId: string, reason: 'stop'): void {    for (const [id, pending] of [...this.approvals]) {
      if (pending.approval.sessionId !== sessionId) continue;
      this.approvals.delete(id);
      if (pending.timer) clearTimeout(pending.timer);
      this.emit('approval.resolved', { approvalId: id, decision: 'reject', by: reason });
      pending.resolve('reject');
    }
    for (const [id, pending] of [...this.questions]) {
      if (pending.approval.sessionId !== sessionId) continue;
      this.questions.delete(id);
      if (pending.timer) clearTimeout(pending.timer);
      this.emit('approval.resolved', { approvalId: id, decision: 'reject', by: reason });
      pending.resolve({ id: pending.approval.questionId ?? '', selected: [], custom: '（已停止）' });
    }
  }

  /** 审批/提问结束后回到 running；run 已经结束就清掉状态，别让会话永远显示"运行中" */
  private resumeStatus(sessionId: string): void {
    if (this.runs.has(sessionId)) this.statuses.set(sessionId, 'running');
    else this.statuses.delete(sessionId);
    const session = this.sessions.get(sessionId);
    if (session) this.emit('session.updated', { session: this.summary(session) });
  }

  /* --------------------------- 状态映射 --------------------------- */

  private requireSession(id: string): StoredSession {
    const session = this.sessions.get(id);
    if (!session) throw new EngineProtocolError({ code: 'not_found', message: `没有这个会话：${id}` });
    return session;
  }

  private providerId(): string {
    return (this.options.model.providerName ?? 'light').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'light';
  }

  /**
   * 账号模式拉一次 `/models` 并缓存 5 分钟；普通 API Key 渠道返回空数组，
   * 调用方回退到当前模型。网络/解析失败也返回空，不阻塞会话。
   */
  private async modelCatalog(): Promise<ModelOption[]> {
    const config = this.options.model;
    if (!config.authToken) return [];
    const now = this.now();
    if (this.catalogCache && now - this.catalogCache.at < 5 * 60_000) return this.catalogCache.models;
    const catalog = await listProviderModels({
      baseURL: config.baseURL,
      authToken: config.authToken,
    });
    const models: ModelOption[] = catalog.map((item) => ({
      provider: this.providerId(),
      providerName: config.providerName ?? 'DeepSeek 账号',
      id: item.id,
      name: item.name ?? item.id,
      description: 'DeepSeek 账号模型目录',
    }));
    this.catalogCache = { at: now, models };
    return models;
  }

  private modelChoice(): { provider: string; model: string } {
    return { provider: this.providerId(), model: this.options.model.model };
  }

  /**
   * 附件只给路径：`/workspace/<relPath>`。
   * 路径不合法（不在 uploads、带 `..`）统一转成 bad_request，绝不拼进工作区外。
   */
  private textWithFiles(text: string, files?: FileRef[]): string {
    try {
      return promptWithFiles(text, files, WORKSPACE_MOUNT).trim();
    } catch (error) {
      if (error instanceof AttachmentPathError) {
        throw new EngineProtocolError({
          code: 'bad_request',
          message: error.message,
          hint: '附件应由 App 收件管线放进 /workspace/uploads，不能带 ../ 之类的路径',
        });
      }
      throw error;
    }
  }

  private appendUserMessage(session: StoredSession, text: string): void {
    session.history.push({ role: 'user', content: text });
    const turn = userTurnFromText(text, this.now);
    session.turns.push(turn);
    if (session.title === '新会话' || session.title.length === 0) {
      session.title = text.length > 18 ? `${text.slice(0, 18)}…` : text;
    }
    session.updatedAt = this.now();
    this.emit('block.appended', { sessionId: session.id, runId: '', turn });
    this.emit('session.updated', { session: this.summary(session) });
  }

  private async save(session: StoredSession): Promise<void> {
    session.updatedAt = this.now();
    await this.repo.save(session);
    this.emit('session.updated', { session: this.summary(session) });
  }

  private statusOf(session: StoredSession): SessionStatus {
    return this.statuses.get(session.id) ?? 'idle';
  }

  private previewOf(session: StoredSession): string {
    for (let i = session.turns.length - 1; i >= 0; i -= 1) {
      const turn = session.turns[i];
      if (!turn) continue;
      for (const block of turn.blocks) {
        if (block.kind === 'text' && block.text.trim()) return block.text.trim().slice(0, 60);
      }
    }
    return '';
  }

  private summary(session: StoredSession): SessionSummary {
    const status = this.statusOf(session);
    return {
      id: session.id,
      title: session.title,
      presetId: session.presetId,
      workspaceId: session.workspaceId,
      hostId: LIGHT_HOST_ID,
      status,
      updatedAt: session.updatedAt,
      unread: 0,
      preview: this.previewOf(session),
      ...(status === 'running' ? { runningSince: session.updatedAt } : {}),
    };
  }

  private contractOf(session: StoredSession): CapabilityContract {
    const preset = PRESETS.find((candidate) => candidate.id === session.presetId) ?? PRESETS[0]!;
    if (session.permission === 'read-only') {
      return {
        tools: toolsForPermission('read-only').map((tool) => tool.name),
        fs: [{ path: WORKSPACE_MOUNT, mode: 'ro' }],
        net: 'allow',
      };
    }
    return preset.contract;
  }

  private detail(session: StoredSession): SessionDetail {
    return {
      ...this.summary(session),
      turns: session.turns.map((turn) => ({ ...turn, blocks: turn.blocks.map((block) => ({ ...block })) })),
      ...(session.model ? { model: session.model } : {}),
      permission: session.permission,
      contract: this.contractOf(session),
    };
  }
}
