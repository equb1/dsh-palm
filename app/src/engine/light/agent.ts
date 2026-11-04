/**
 * 轻引擎的 agent loop。
 *
 * 一次 `sessions.send` = 一次 run：模型流式回答 → 如果需要工具就执行（审批/提问
 * 在这里挂起）→ 把工具结果回灌 → 再问一次，直到没有工具调用或到了步数上限。
 *
 * 事件形状完全对齐 `app/src/protocol`：UI 不需要知道这是轻引擎。
 *
 * 插话（steer）的实现：中断当前这一步的模型调用（`run.step`），保留已经流出的
 * 文本，用户消息由 host 先写进历史；下一轮循环换一个新的 step controller 继续，
 * 整个 run 不结束 —— 所以 UI 上不会闪一下"已停止"。
 */
import type {
  ApprovalDecision,
  EventName,
  EventPayloads,
  RiskLevel,
  SessionStatus,
  Turn,
} from '../../protocol';
import { streamChat } from './provider';
import { newBlockId } from './sessionRepo';
import { checkToolCapability } from './capability';
import { permissionNote, TOOL_CONTEXT_HELP, toolsForPermission, toDisplayPath, toSandboxPath } from './tools';
import { errorKindOf, errorStatusOf } from '../../lib/errors';
import type {
  AgentTool,
  AskAnswer,
  AskQuestion,
  LightImageConfig,
  LightModelConfig,
  LightRun,
  StoredSession,
  ToolContext,
} from './types';
import type { SandboxFs } from '../fs/sandbox';
import type { ShellRunner } from '../shell/bash';

export interface RunSink {
  emit<K extends EventName>(event: K, data: EventPayloads[K]): void;
  requestApproval(input: {
    title: string;
    command: string;
    risk: RiskLevel;
    summary: string;
  }): Promise<ApprovalDecision>;
  askUser(question: AskQuestion): Promise<AskAnswer>;
  setStatus(status: SessionStatus): void;
  persist(): Promise<void>;
}

export interface AgentDeps {
  model: LightModelConfig;
  workspace: SandboxFs;
  bash: ShellRunner;
  /** 可选生图渠道，透传给工具上下文 */
  image?: LightImageConfig;
  maxSteps?: number;
  now?: () => number;
  /** 允许测试替换 */
  stream?: typeof streamChat;
  /** 诊断日志（真机 logcat 用；测试不传就不打） */
  log?: (message: string) => void;
}

export interface RunOutcome {
  reason: 'done' | 'stopped' | 'error' | 'capability_missing';
  error?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

interface TextBlock {
  kind: 'text' | 'thinking';
  id: string;
  text: string;
  /** 与 turn.blocks 里的是同一个对象，避免"事件里有、落盘里没有" */
  block: Extract<Turn['blocks'][number], { kind: 'text' | 'thinking' }>;
}

const MAX_HISTORY_CHARS = 180_000;
const MAX_STEPS = 8;

function cloneTurn(turn: Turn): Turn {
  return { ...turn, blocks: turn.blocks.map((block) => ({ ...block })) };
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function toolSummary(name: string, args: Record<string, unknown>): string {
  const path = typeof args.path === 'string' ? args.path : '';
  switch (name) {
    case 'bash': {
      const command = typeof args.command === 'string' ? (args.command.split('\n')[0] ?? '') : '';
      return clip(`$ ${command}`, 80);
    }
    case 'read_file':
      return `读取 ${path || '/'}`;
    case 'write_file':
      return `写入 ${path || '/'}`;
    case 'list_dir':
      return `列出 ${path || '/workspace'}`;
    case 'create_docx':
      return `生成 Word ${path || ''}`;
    case 'create_xlsx':
      return `生成 Excel ${path || ''}`;
    case 'read_docx':
      return `读取 Word ${path || ''}`;
    case 'read_xlsx':
      return `读取 Excel ${path || ''}`;
    case 'generate_image': {
      const prompt = typeof args.prompt === 'string' ? args.prompt : '';
      return clip(`生图：${prompt}`, 80);
    }
    case 'ask_user_question': {
      const list = Array.isArray(args.questions) ? (args.questions as Array<Record<string, unknown>>) : [];
      const question = list[0]?.question;
      return clip(typeof question === 'string' ? `提问：${question}` : '向用户提问', 80);
    }
    default:
      return name;
  }
}

export class Agent {
  private readonly deps: AgentDeps;
  private readonly stream: typeof streamChat;
  private readonly now: () => number;
  private readonly log?: (message: string) => void;

  constructor(deps: AgentDeps) {
    this.deps = deps;
    this.stream = deps.stream ?? streamChat;
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log;
  }

  private systemPrompt(session: StoredSession): string {
    return [
      '你是「锦囊」（dsh-palm）手机轻引擎里的助手。你运行在用户手机上的一个沙箱里，',
      '能读写一个真实的工作区 /workspace，并能执行受限的 bash 命令。',
      '',
      `工作区：${toDisplayPath('/')}`,
      '用户发来的文件在 /workspace/uploads，直接用路径读取，不要用 base64。',
      permissionNote(session.permission),
      '',
      TOOL_CONTEXT_HELP,
      '',
      '回答要求：中文；简洁、直接；需要动手就直接用工具做，不要只说「你可以……」；',
      '涉及文件时给出 /workspace 里的路径。',
    ].join('\n');
  }

  /** 历史太长就丢最老的消息（Hermes 内存有限） */
  private trimHistory(history: StoredSession['history']): StoredSession['history'] {
    let total = 0;
    for (const message of history) {
      total += (message.content ?? '').length + JSON.stringify(message.tool_calls ?? '').length;
    }
    if (total <= MAX_HISTORY_CHARS) return history;
    const keep: StoredSession['history'] = [];
    let running = 0;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const message = history[i] as StoredSession['history'][number];
      const size = (message.content ?? '').length;
      if (running + size > MAX_HISTORY_CHARS && keep.length >= 6) break;
      running += size;
      keep.unshift(message);
    }
    return keep;
  }

  async run(session: StoredSession, run: LightRun, sink: RunSink): Promise<RunOutcome> {
    const tools = toolsForPermission(session.permission);
    const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
    const maxSteps = this.deps.maxSteps ?? MAX_STEPS;
    // 会话里选过模型就用它（轻引擎只有一个渠道，这里只换模型名）
    const modelConfig: LightModelConfig = session.model?.model
      ? { ...this.deps.model, model: session.model.model }
      : this.deps.model;
    let usage: RunOutcome['usage'];

    try {
      for (let step = 0; step < maxSteps; step += 1) {
        if (run.abortKind === 'stop') {
          return this.finish(run, { reason: 'stopped' });
        }
        // steer 之后换一个新的 step controller；否则沿用当前的
        if (run.step.signal.aborted) run.step = new AbortController();
        run.abortKind = null;
        const signal = run.step.signal;

        /* ------------------------- 一个 assistant 回合 ------------------------- */
        const turn: Turn = {
          id: newBlockId('t'),
          runId: run.runId,
          role: 'assistant',
          createdAt: this.now(),
          blocks: [],
          status: 'streaming',
        };
        session.turns.push(turn);
        sink.emit('block.appended', { sessionId: session.id, runId: run.runId, turn: cloneTurn(turn) });

        const textBlocks = new Map<string, TextBlock>();
        const ensureTextBlock = (kind: 'text' | 'thinking'): TextBlock => {
          const existing = [...textBlocks.values()].find((block) => block.kind === kind);
          if (existing) return existing;
          const id = newBlockId(kind);
          const turnBlock =
            kind === 'text'
              ? ({ kind: 'text' as const, id, text: '' } as const)
              : ({ kind: 'thinking' as const, id, text: '' } as const);
          turn.blocks.push(turnBlock);
          const handle: TextBlock = { kind, id, text: '', block: turnBlock };
          textBlocks.set(id, handle);
          sink.emit('block.appended', { sessionId: session.id, runId: run.runId, turn: cloneTurn(turn) });
          return handle;
        };

        const messages = [
          { role: 'system' as const, content: this.systemPrompt(session) },
          ...this.trimHistory(session.history),
        ];

        let result;
        const streamStartedAt = this.now();
        let firstDeltaAt: number | null = null;
        let firstKind: 'content' | 'tool' = 'content';
        const markFirst = (kind: 'content' | 'tool'): void => {
          if (firstDeltaAt !== null) return;
          firstDeltaAt = this.now();
          firstKind = kind;
        };
        try {
          result = await this.stream(
            modelConfig,
            // 空闲超时：45s 没有新分片就当超时（transport 里重置）
            { messages, tools, signal, idleTimeoutMs: 45_000 },
            {
              onText: (delta) => {
                markFirst('content');
                const block = ensureTextBlock('text');
                block.text += delta;
                block.block.text += delta;
                sink.emit('block.delta', {
                  sessionId: session.id,
                  runId: run.runId,
                  turnId: turn.id,
                  blockId: block.id,
                  op: 'append',
                  text: delta,
                });
              },
              onThinking: (delta) => {
                markFirst('content');
                const block = ensureTextBlock('thinking');
                block.text += delta;
                block.block.text += delta;
                sink.emit('block.delta', {
                  sessionId: session.id,
                  runId: run.runId,
                  turnId: turn.id,
                  blockId: block.id,
                  op: 'append',
                  text: delta,
                });
              },
              // 只出工具调用、没有正文的回合也要有 ttft
              onToolCallDelta: () => markFirst('tool'),
            },
          );
        } catch (error) {
          if (signal.aborted) {
            turn.status = 'stopped';
            sink.emit('block.appended', { sessionId: session.id, runId: run.runId, turn: cloneTurn(turn) });
            if (run.abortKind === 'steer' || run.abortKind === null) {
              // steer：用户消息已经在历史里，回到循环顶部重新问模型
              continue;
            }
            return this.finish(run, { reason: 'stopped' });
          }
          throw error;
        }

        if (result.usage) {
          usage = {
            inputTokens: (usage?.inputTokens ?? 0) + (result.usage.inputTokens ?? 0),
            outputTokens: (usage?.outputTokens ?? 0) + (result.usage.outputTokens ?? 0),
          };
        }
        // 一次模型调用只打一行：TTFT（首个非空分片，含 tool_calls）+ 总流时长 + 用量
        const streamMs = this.now() - streamStartedAt;
        const ttftMs = firstDeltaAt === null ? -1 : firstDeltaAt - streamStartedAt;
        this.log?.(
          `ttft=${ttftMs}ms stream=${streamMs}ms model=${modelConfig.model} step=${step + 1} ` +
            `first=${firstKind} tools=${result.toolCalls.length} ` +
            `usage=in:${result.usage?.inputTokens ?? 0},out:${result.usage?.outputTokens ?? 0} ` +
            `run=${run.runId}`,
        );

        const toolCalls = result.toolCalls;
        if (result.text.length > 0 || toolCalls.length > 0) {
          session.history.push({
            role: 'assistant',
            content: result.text.length > 0 ? result.text : null,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          });
        }

        if (signal.aborted) {
          turn.status = 'stopped';
          sink.emit('block.appended', { sessionId: session.id, runId: run.runId, turn: cloneTurn(turn) });
          if (run.abortKind === 'stop') return this.finish(run, { reason: 'stopped' });
          continue;
        }

        if (toolCalls.length === 0) {
          turn.status = 'done';
          turn.meta = { steps: step + 1 };
          sink.emit('block.appended', { sessionId: session.id, runId: run.runId, turn: cloneTurn(turn) });
          return this.finish(run, { reason: 'done', ...(usage ? { usage } : {}) });
        }

        /* ----------------------------- 工具调用 ----------------------------- */
        for (const call of toolCalls) {
          if (signal.aborted) break;

          let args: Record<string, unknown> = {};
          let parseError: string | null = null;
          try {
            const parsed = JSON.parse(call.function.arguments || '{}') as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
            else parseError = '工具参数不是对象';
          } catch (error) {
            parseError = `工具参数不是合法 JSON：${error instanceof Error ? error.message : String(error)}`;
          }

          const tool = toolMap.get(call.function.name);

          /* ------------------- 能力门：执行前检查，缺能力就停 ------------------- */
          let capabilitySize: number | undefined;
          if (!parseError && tool?.name === 'read_file') {
            try {
              const stat = await this.deps.workspace.stat(toSandboxPath(args.path));
              capabilitySize = stat.size;
            } catch {
              /* stat 失败交给工具自己报错；这里只负责 >10MB 的提前拦截 */
            }
          }
          // read-only 下工具本来就不暴露：维持原来的「没有这个工具」错误，
          // 不把权限问题说成能力缺失（与 1.2 的行为保持一致）。
          const unknownUnderReadOnly = session.permission === 'read-only' && !tool;
          const capability =
            parseError || unknownUnderReadOnly
              ? null
              : checkToolCapability({
                  name: call.function.name,
                  args,
                  known: Boolean(tool),
                  ...(capabilitySize != null ? { size: capabilitySize } : {}),
                });

          if (capability && !capability.ok) {
            const capabilityBlock: Extract<Turn['blocks'][number], { kind: 'capability' }> = {
              kind: 'capability',
              id: `cap_${call.id}`,
              code: 'capability_missing',
              tool: capability.tool,
              summary: capability.summary,
              reason: capability.reason,
              missing: capability.missing,
              ...(capability.command ? { command: capability.command } : {}),
              status: 'pending',
              callId: call.id,
            };
            turn.blocks.push(capabilityBlock);
            sink.emit('block.appended', { sessionId: session.id, runId: run.runId, turn: cloneTurn(turn) });

            // 从当前调用起（含）都不执行；每个 tool_call 都要有结果，历史里不能悬空。
            // 已执行的工具保持原样，绝不重放。
            const startIndex = toolCalls.indexOf(call);
            for (const pendingCall of toolCalls.slice(Math.max(startIndex, 0))) {
              session.history.push({
                role: 'tool',
                tool_call_id: pendingCall.id,
                name: pendingCall.function.name,
                content: '[CAPABILITY_MISSING] not executed',
              });
            }

            turn.status = 'done';
            turn.meta = { steps: step + 1 };
            sink.emit('block.appended', { sessionId: session.id, runId: run.runId, turn: cloneTurn(turn) });
            await sink.persist();
            sink.emit('capability.missing', {
              sessionId: session.id,
              runId: run.runId,
              turnId: turn.id,
              callId: call.id,
              tool: capability.tool,
              missing: capability.missing,
              reason: capability.reason,
              ...(capability.command ? { command: capability.command } : {}),
              block: capabilityBlock,
            });
            return this.finish(run, { reason: 'capability_missing', ...(usage ? { usage } : {}) });
          }

          const block = {
            kind: 'tool' as const,
            id: newBlockId('tool'),
            name: call.function.name,
            summary: toolSummary(call.function.name, args),
            state: 'running' as const,
          };
          turn.blocks.push(block);
          sink.emit('block.appended', { sessionId: session.id, runId: run.runId, turn: cloneTurn(turn) });

          const updateBlock = (state: 'running' | 'done' | 'error', detail?: string): void => {
            const next = { ...block, state, ...(detail ? { detail: clip(detail, 200) } : {}) };
            const index = turn.blocks.findIndex((candidate) => candidate.id === block.id);
            if (index >= 0) turn.blocks[index] = next;
            sink.emit('block.updated', {
              sessionId: session.id,
              runId: run.runId,
              turnId: turn.id,
              block: next,
            });
          };

          let output: string;
          if (parseError) {
            output = `[错误] ${parseError}`;
          } else if (!tool) {
            output = `[错误] 没有这个工具：${call.function.name}`;
          } else {
            output = await this.executeTool(tool, args, session, run, sink);
          }

          const failed = output.startsWith('[错误]') || output.startsWith('[已拒绝]');
          updateBlock(failed ? 'error' : 'done', output);
          session.history.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: output,
          });
        }

        turn.status = 'done';
        turn.meta = { steps: step + 1 };
        sink.emit('block.appended', { sessionId: session.id, runId: run.runId, turn: cloneTurn(turn) });
        await sink.persist();

        if (signal.aborted) {
          if (run.abortKind === 'stop') return this.finish(run, { reason: 'stopped' });
          // steer：回到顶部，历史里已经有用户的新消息
          continue;
        }
      }

      return this.finish(run, {
        reason: 'error',
        error: `超过最大步数（${maxSteps}），已停止`,
        ...(usage ? { usage } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (run.step.signal.aborted) return this.finish(run, { reason: 'stopped' });
      this.logError(run, error);
      return this.finish(run, { reason: 'error', error: message });
    }
  }

  /** 失败只打一行，带上分类/状态码，真机上能直接 grep */
  private logError(run: LightRun, error: unknown): void {
    if (!this.log) return;
    const kind = errorKindOf(error) ?? 'server';
    const status = errorStatusOf(error) ?? 0;
    const message = (error instanceof Error ? error.message : String(error))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    this.log(`error kind=${kind} status=${status} run=${run.runId} message=${message}`);
  }

  private async executeTool(
    tool: AgentTool,
    args: Record<string, unknown>,
    session: StoredSession,
    run: LightRun,
    sink: RunSink,
  ): Promise<string> {
    if (tool.needsApproval && session.permission === 'workspace-write') {
      const descriptor = tool.describeApproval?.(args) ?? {
        title: `执行 ${tool.name}`,
        command: tool.name,
        risk: 'medium' as const,
        summary: '',
      };
      const decision = await sink.requestApproval(descriptor);
      if (decision !== 'approve') {
        return '[已拒绝] 用户拒绝了这次操作，不要重试同一个操作。';
      }
    }
    if (run.step.signal.aborted) return '[错误] 已取消';

    const ctx: ToolContext = {
      fs: this.deps.workspace,
      bash: this.deps.bash,
      permission: session.permission,
      signal: run.step.signal,
      ...(this.deps.image ? { image: this.deps.image } : {}),
      requestApproval: async (input) => {
        const decision = await sink.requestApproval(input);
        return decision === 'approve' ? 'approve' : 'reject';
      },
      askUser: (question) => sink.askUser(question),
    };

    try {
      return await tool.execute(args, ctx);
    } catch (error) {
      return `[错误] ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private finish(run: LightRun, outcome: RunOutcome): RunOutcome {
    run.finished = true;
    this.log?.(`run ${run.runId} ${outcome.reason}${outcome.error ? `: ${outcome.error}` : ''}`);
    return outcome;
  }
}

/** 供 host 构造 user 回合时复用 */
export function userTurnFromText(text: string, now: () => number = () => Date.now()): Turn {
  return {
    id: newBlockId('u'),
    role: 'user',
    createdAt: now(),
    status: 'done',
    blocks: [{ kind: 'text', id: newBlockId('txt'), text }],
  };
}
