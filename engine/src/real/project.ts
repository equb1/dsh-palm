/**
 * 真 dsh 的事件流 → 我们的 Turn/Block 投影。
 *
 * 依据：docs/10-dsh-api.md 第五节（从会话日志读出来的真实形状）。
 * 真引擎没有"消息列表"，只有事件；这里把事件折成界面能渲染的回合。
 */
import type { Block, Turn } from '../../../app/src/protocol';
import { canonicalRunId, canonicalTurnId } from '../../../app/src/protocol/turns';

export interface RealEventData {
  turn?: number;
  step?: number;
  data?: unknown;
  [k: string]: unknown;
}

export interface RealEvent {
  type?: string;
  seq?: number;
  time?: number;
  data?: Record<string, unknown>;
}

export interface RealRecord {
  type?: string;
  event?: RealEvent;
}

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  toolName?: string;
  toolCallId?: string;
  callId?: string;
  arguments?: unknown;
  input?: unknown;
  args?: unknown;
  function?: { name?: string; arguments?: unknown };
  attachment?: { name?: string };
  [k: string]: unknown;
}

/** 一条 assistant message.content 里能投影出来的块（含源数组下标） */
export interface ContentEntry {
  /** 在源 content 数组里的下标；assistant-stream 的 chunk.index 用的是同一套编号 */
  index: number;
  kind: 'text' | 'thinking' | 'tool';
  text?: string;
  name?: string;
  callId?: string;
  summary?: string;
}

type TextLikeBlock = Extract<Block, { kind: 'text' | 'thinking' }>;
type TextContentEntry = Omit<ContentEntry, 'kind'> & { kind: 'text' | 'thinking' };

/* ------------------------------------------------------------------ */

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

/** 从工具参数里挑一个能当"一行摘要"的值 */
function summarizeArgs(raw: unknown): string {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return summarizeArgs(parsed);
    } catch {
      return clip(raw, 60);
    }
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const key of ['command', 'cmd', 'path', 'file_path', 'filePath', 'query', 'url', 'text', 'prompt']) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) return clip(v, 60);
    }
    const first = Object.values(o).find((v) => typeof v === 'string' && v.trim());
    if (typeof first === 'string') return clip(first, 60);
  }
  return '';
}

const TOOL_CALL_TYPES = new Set([
  'tool-call',
  'tool_call',
  'toolCall',
  'tool-use',
  'tool_use',
  'function-call',
  'function_call',
]);

function toolCallOfBlock(block: ContentBlock): { callId: string; name: string; args: unknown } | null {
  const type = str(block.type);
  if (!TOOL_CALL_TYPES.has(type)) return null;
  const fn = (block.function ?? {}) as { name?: unknown; arguments?: unknown };
  return {
    callId: str(block.toolCallId) || str(block.callId) || str(block.id),
    name: str(block.name) || str(block.toolName) || str(fn.name) || 'tool',
    args: block.arguments ?? block.input ?? block.args ?? fn.arguments,
  };
}

/**
 * 把 message.content 统一成可投影的块。
 *
 * 非流式的 assistant/message 和流式 block-start/chunk 共用这套下标：
 * 流式时 content index 就是 chunk.index，可据此用最终文本覆盖流式拼出来的文本，
 * 不会再多出一份。tool-call 块也在这里识别，后续按 callId 去重。
 */
export function readContent(content: unknown): ContentEntry[] {
  if (typeof content === 'string') {
    return content ? [{ index: 0, kind: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const out: ContentEntry[] = [];
  content.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const block = raw as ContentBlock;
    const type = str(block.type);
    if (type === 'text') {
      const text = str(block.text);
      if (text) out.push({ index, kind: 'text', text });
      return;
    }
    if (type === 'reasoning' || type === 'thinking') {
      const text = str(block.text) || str(block.thinking);
      if (text) out.push({ index, kind: 'thinking', text });
      return;
    }
    if (type === 'image') {
      const label = block.attachment?.name ? `[图片: ${block.attachment.name}]` : '[图片]';
      out.push({ index, kind: 'text', text: label });
      return;
    }
    if (type === 'file') {
      const label = block.attachment?.name ? `[附件: ${block.attachment.name}]` : '[附件]';
      out.push({ index, kind: 'text', text: label });
      return;
    }
    const tool = toolCallOfBlock(block);
    if (tool) {
      out.push({
        index,
        kind: 'tool',
        name: tool.name,
        callId: tool.callId,
        summary: summarizeArgs(tool.args),
      });
    }
  });
  return out;
}

/** 工具结果 content 可能是字符串、文本块数组或单个对象 */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((raw) => {
        if (typeof raw === 'string') return raw;
        if (!raw || typeof raw !== 'object') return '';
        const block = raw as Record<string, unknown>;
        return str(block.text) || str(block.content);
      })
      .filter((line) => line.length > 0)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    const block = content as Record<string, unknown>;
    return str(block.text) || str(block.content);
  }
  return '';
}

/** 真引擎的 usage 是每个 assistant 步骤一份；也兼容 OpenAI 风格字段名 */
export function usageFrom(value: unknown): Turn['usage'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const u = value as Record<string, unknown>;
  const inputTokens = num(u.inputTokens) ?? num(u.promptTokens) ?? num(u.prompt_tokens);
  const outputTokens = num(u.outputTokens) ?? num(u.completionTokens) ?? num(u.completion_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}

/** 一个回合里多个 assistant 步骤的 usage 累加，避免只用最后一步 */
export function addUsage(turn: Turn, usage: Turn['usage'] | undefined): void {
  if (!usage) return;
  const prev = turn.usage ?? {};
  const inputTokens =
    usage.inputTokens !== undefined ? (prev.inputTokens ?? 0) + usage.inputTokens : prev.inputTokens;
  const outputTokens =
    usage.outputTokens !== undefined ? (prev.outputTokens ?? 0) + usage.outputTokens : prev.outputTokens;
  turn.usage = {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}

export interface AssistantMessageInfo {
  turn: number;
  step: number;
  message: Record<string, unknown>;
  runId?: string;
  usage?: Turn['usage'];
  /** 用于快照/实时流去重：优先 message id，其次事件 seq，最后内容指纹 */
  key: string;
}

/** 非流式 assistant/message 的统一读法（兼容 message 直接铺在 data 上的旧形状） */
export function assistantMessageInfo(
  ev: RealEvent | undefined,
  data: Record<string, unknown>,
): AssistantMessageInfo | null {
  const raw = data.message;
  const message =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : data;
  if (!Object.prototype.hasOwnProperty.call(message, 'content') && message.role !== 'assistant') {
    return null;
  }
  const turn = typeof data.turn === 'number' ? data.turn : -1;
  const step = typeof data.step === 'number' ? data.step : -1;
  const id = str(message.id);
  const seq = typeof ev?.seq === 'number' ? ev.seq : undefined;
  const key = id
    ? `msg:${turn}:${step}:${id}`
    : seq !== undefined
      ? `seq:${seq}`
      : `raw:${turn}:${step}:${typeof ev?.time === 'number' ? ev.time : ''}:${JSON.stringify(
          message.content ?? '',
        )}`;
  return {
    turn,
    step,
    message,
    runId: canonicalRunId(turn >= 0 ? turn : undefined),
    usage: usageFrom(data.usage) ?? usageFrom(message.usage),
    key,
  };
}

export interface MergeAssistantContentOptions {
  /** 新文本/思考块 id（按源 content 下标生成） */
  textBlockId: (index: number) => string;
  toolBlockId?: (index: number, callId: string) => string;
  /** 实时流式块：content index 与流式 chunk index 相同，最终文本直接覆盖 */
  streamBlockIds?: ReadonlyMap<number, string>;
  /** 重连后映射丢失时的兜底；只应在当前步骤的块里查找 */
  findTextBlock?: (
    entry: TextContentEntry,
    index: number,
  ) => TextLikeBlock | undefined;
  markDone?: boolean;
}

export interface MergeAssistantContentResult {
  appended: Block[];
  updated: Block[];
}

/**
 * 把一条 assistant message 合并进已有回合。
 *
 * - 文本/思考：同一下标的流式块用最终文本覆盖；没有就补一块。
 * - 工具调用：按 callId 去重，tool/call 事件先到也不会多一张卡片。
 * - 空 content：不产生块，也不覆盖已有流式块。
 */
export function mergeAssistantContent(
  turn: Turn,
  content: unknown,
  options: MergeAssistantContentOptions,
): MergeAssistantContentResult {
  const appended: Block[] = [];
  const updated: Block[] = [];

  for (const entry of readContent(content)) {
    if (entry.kind === 'tool') {
      const callId = entry.callId ?? '';
      const existing = callId
        ? turn.blocks.find(
            (b): b is Extract<Block, { kind: 'tool' }> =>
              b.kind === 'tool' && b.callId === callId,
          )
        : undefined;
      if (existing) {
        let changed = false;
        if ((!existing.name || existing.name === 'tool') && entry.name && entry.name !== existing.name) {
          existing.name = entry.name;
          changed = true;
        }
        if (!existing.summary && entry.summary) {
          existing.summary = entry.summary;
          changed = true;
        }
        if (changed) updated.push(existing);
        continue;
      }
      const block: Extract<Block, { kind: 'tool' }> = {
        kind: 'tool',
        id:
          options.toolBlockId?.(entry.index, callId) ??
          options.textBlockId(entry.index),
        ...(callId ? { callId } : {}),
        name: entry.name ?? 'tool',
        summary: entry.summary ?? '',
        state: 'running',
      };
      turn.blocks.push(block);
      appended.push(block);
      continue;
    }

    const textEntry = entry as TextContentEntry;
    let existing = options.findTextBlock?.(textEntry, entry.index);
    if (!existing) {
      const streamId = options.streamBlockIds?.get(entry.index);
      if (streamId) {
        existing = turn.blocks.find(
          (b): b is TextLikeBlock =>
            (b.kind === 'text' || b.kind === 'thinking') && b.id === streamId,
        );
      }
    }
    if (existing) {
      let changed = false;
      if (entry.text && existing.text !== entry.text) {
        existing.text = entry.text;
        changed = true;
      }
      if (options.markDone && !existing.done) {
        existing.done = true;
        changed = true;
      }
      if (changed) updated.push(existing);
      continue;
    }

    const block = {
      kind: entry.kind,
      id: options.textBlockId(entry.index),
      text: entry.text ?? '',
      ...(options.markDone ? { done: true } : {}),
    } as Block;
    turn.blocks.push(block);
    appended.push(block);
  }

  return { appended, updated };
}

function blockFromEntry(entry: ContentEntry, id: string): Block {
  if (entry.kind === 'tool') {
    return {
      kind: 'tool',
      id,
      ...(entry.callId ? { callId: entry.callId } : {}),
      name: entry.name ?? 'tool',
      summary: entry.summary ?? '',
      state: 'running',
    };
  }
  return { kind: entry.kind, id, text: entry.text ?? '' } as Block;
}

function contentToBlocks(content: unknown, idPrefix: string, offset = 0): Block[] {
  return readContent(content).map((entry) =>
    blockFromEntry(entry, `${idPrefix}:b${offset + entry.index}`),
  );
}

/* ------------------------------------------------------------------ */

export interface Projection {
  turns: Turn[];
  title: string | null;
  model: string | null;
}

/**
 * 把记录折成回合。
 *
 * 规则：
 *  - user/message       → 新开一个用户回合
 *  - assistant/message  → 追加到当前 assistant 回合（同 turn 号就合并）
 *  - tool/call          → 追加一个 running 的工具块
 *  - tool/result        → 按 callId 回填工具块状态与详情
 *  - turn/end           → 收尾
 */
export interface ProjectOptions {
  /**
   * 没有 turn/end 的 assistant 回合是否按完成处理。
   * sessions.get 对仍在运行的会话要传 false，否则当前 live 回合会被错误标成 done。
   */
  finalizeUnfinished?: boolean;
}

export function projectRecords(records: RealRecord[], options: ProjectOptions = {}): Projection {
  const turns: Turn[] = [];
  let title: string | null = null;
  let model: string | null = null;
  let blockSeq = 0;

  let current: Turn | null = null;
  let currentTurnNo = -1;

  const toolIndex = new Map<string, Extract<Block, { kind: 'tool' }>>();
  const seenAssistant = new Set<string>();

  const newTurn = (role: 'user' | 'assistant', createdAt: number, id?: string, runId?: string): Turn => {
    const turn: Turn = {
      id:
        role === 'assistant' && runId
          ? canonicalTurnId(runId)
          : id ?? `${role}-${turns.length + 1}`,
      ...(runId ? { runId } : {}),
      role,
      createdAt,
      blocks: [],
      status: role === 'assistant' ? 'streaming' : 'done',
    };
    turns.push(turn);
    return turn;
  };

  for (const rec of records) {
    const ev = rec?.event;
    if (!ev?.type) continue;
    const d = (ev.data ?? {}) as Record<string, any>;
    const time = typeof ev.time === 'number' ? ev.time : Date.now();

    switch (ev.type) {
      case 'user/message': {
        // 真引擎会把「运行上下文 / 技能提醒 / 时间快照」也记成 user/message，
        // 用 source.kind 区分：只有 user（和审批回答）才是人类说的话。
        const src = (d.source ?? {}) as { kind?: string };
        const kind = typeof src.kind === 'string' ? src.kind : 'user';
        if (kind !== 'user' && kind !== 'user-approval') break;

        current = newTurn('user', time, typeof d.id === 'string' ? d.id : undefined);
        currentTurnNo = -1;
        const userId = current.id;
        current.blocks = contentToBlocks(d.content, userId);
        current.status = 'done';
        break;
      }

      case 'assistant/message': {
        const info = assistantMessageInfo(ev, d);
        if (!info || seenAssistant.has(info.key)) break;
        seenAssistant.add(info.key);

        const turnNo = info.turn;
        const runId = info.runId;
        const sameTurn =
          current?.role === 'assistant' &&
          ((runId !== undefined && current.runId === runId) ||
            (turnNo >= 0 && currentTurnNo === turnNo) ||
            (currentTurnNo < 0 && (runId === undefined || current.runId === undefined)));

        if (!sameTurn) {
          const entries = readContent(info.message.content);
          if (entries.length === 0 && !info.usage) break;
          current = newTurn(
            'assistant',
            time,
            typeof info.message.id === 'string' ? info.message.id : undefined,
            runId,
          );
          currentTurnNo = turnNo;
        } else if (current) {
          if (runId && !current.runId) current.runId = runId;
          if (currentTurnNo < 0) currentTurnNo = turnNo;
        }
        if (!current) break;

        const blockPrefix = current.runId ?? current.id;
        const offset = current.blocks.length;
        const merged = mergeAssistantContent(current, info.message.content, {
          textBlockId: (index) => `${blockPrefix}:b${offset + index}`,
          toolBlockId: (index, callId) =>
            `${blockPrefix}:tool-${callId || offset + index}`,
        });
        for (const block of merged.appended) {
          if (block.kind === 'tool' && block.callId) toolIndex.set(block.callId, block);
        }
        addUsage(current, info.usage);
        const src = (info.message.source ?? {}) as Record<string, unknown>;
        if (typeof src.model === 'string') model = src.model;
        break;
      }

      case 'tool/call': {
        const turnNo = typeof d.turn === 'number' ? d.turn : -1;
        const runId = canonicalRunId(turnNo >= 0 ? turnNo : undefined);
        if (current?.role !== 'assistant') {
          current = newTurn('assistant', time, undefined, runId);
          currentTurnNo = turnNo;
        } else if (runId) {
          if (!current.runId) current.runId = runId;
          if (currentTurnNo < 0) currentTurnNo = turnNo;
        }
        blockSeq += 1;
        const callName = str(d.name) || 'tool';
        const callId = typeof d.callId === 'string' ? d.callId : '';

        const existing = callId ? toolIndex.get(callId) : undefined;
        if (existing) {
          if ((!existing.name || existing.name === 'tool') && callName) existing.name = callName;
          if (!existing.summary) existing.summary = summarizeArgs(d.arguments);
          break;
        }

        // ask_user_question 不是普通工具行，它要渲染成一张"请选择"卡片
        if (callName === 'ask_user_question' && callId) {
          const block: Extract<Block, { kind: 'approval' }> = {
            kind: 'approval',
            id: `${current.runId ?? current.id}:ask-${blockSeq}`,
            approvalId: callId,
          };
          current.blocks.push(block);
          break;
        }

        const block: Extract<Block, { kind: 'tool' }> = {
          kind: 'tool',
          id: `${current.runId ?? current.id}:tool-${callId || blockSeq}`,
          ...(callId ? { callId } : {}),
          name: callName,
          summary: summarizeArgs(d.arguments),
          state: 'running',
        };
        current.blocks.push(block);
        if (callId) toolIndex.set(callId, block);
        break;
      }

      case 'tool/result': {
        const msg = (d.message ?? {}) as Record<string, any>;
        const callId = str(msg.toolCallId) || str(d.callId);
        const block =
          (callId ? toolIndex.get(callId) : undefined) ??
          (callId && current?.role === 'assistant'
            ? current.blocks.find(
                (b): b is Extract<Block, { kind: 'tool' }> =>
                  b.kind === 'tool' && b.callId === callId,
              )
            : undefined);
        if (block) {
          block.state = msg.isError === true ? 'error' : 'done';
          const text = contentText(msg.content);
          if (text) block.detail = clip(text, 200);
          if (callId) toolIndex.set(callId, block);
        }
        break;
      }

      case 'turn/end': {
        const reason = (d.reason ?? {}) as Record<string, unknown>;
        const kind = str(reason.kind);
        // 真引擎的取值：completed | stop | aborted（用户中断）| stopped | error
        const status: Turn['status'] =
          kind === 'completed' || kind === 'stop'
            ? 'done'
            : kind === 'stopped' || kind === 'aborted'
              ? 'stopped'
              : 'error';
        const failure = (reason.failure ?? {}) as Record<string, unknown>;
        const errMsg = str(reason.message) || str(failure.message);

        const runId = canonicalRunId(d.turn, current?.runId);
        let target: Turn | undefined;
        if (runId) {
          for (let i = turns.length - 1; i >= 0; i -= 1) {
            const turn = turns[i]!;
            if (turn.role === 'assistant' && turn.runId === runId) {
              target = turn;
              break;
            }
          }
        }
        if (!target && current?.role === 'assistant') {
          target = current;
        }
        if (!target && status === 'error') {
          const last = turns[turns.length - 1];
          const repeated = last?.role === 'assistant' && last.status === 'error';
          if (!repeated) target = newTurn('assistant', time, undefined, runId);
        }
        if (target) {
          target.status = status;
          if (status === 'error' && errMsg && target.blocks.length === 0) {
            target.blocks.push({ kind: 'text', id: `err-${turns.length}`, text: `错误：${errMsg}` });
          }
          target.meta = { steps: target.blocks.length };
          addUsage(target, usageFrom(d.usage));
        }
        if (target === current) {
          current = null;
          currentTurnNo = -1;
        }
        break;
      }

      case 'session/title': {
        const t = str(d.title).trim();
        if (t) title = t;
        break;
      }

      case 'model/selection': {
        const m = str(d.model);
        if (m) model = m;
        break;
      }

      default:
        break;
    }
  }

  // 历史记录缺 turn/end 时默认按完成处理；活跃会话必须保留 streaming。
  if (options.finalizeUnfinished !== false) {
    for (const t of turns) {
      if (t.role === 'assistant' && t.status === 'streaming') {
        t.status = 'done';
      }
    }
  }

  return { turns, title, model };
}

/** 从记录里取最新标题（projection 里可能没有） */
export function titleFromRecords(records: RealRecord[]): string | null {
  let title: string | null = null;
  for (const rec of records) {
    if (rec?.event?.type === 'session/title') {
      const t = str((rec.event.data as Record<string, unknown> | undefined)?.title).trim();
      if (t) title = t;
    }
  }
  return title;
}
