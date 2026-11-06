/**
 * Handoff v1 的纯函数部分（Node 可测，不碰 react-native / 网络）。
 *
 * 一次交接只做三件事：
 *  1. 从轻引擎历史里抽出摘要、最近 8 条、已完成步骤、文件引用、未执行调用；
 *  2. 生成确定性的 handoffId / seedMarker，失败重试也不会变；
 *  3. 把「轻引擎原始回合 + 完整引擎新回合」拼成一条逻辑会话（丢掉 seed 用户消息）。
 *
 * 真正的副作用（启 proot、建会话、发 seed、回滚）在 store.ts。
 */
import { HANDOFF_REPLAY_SCHEMA } from '../protocol';
import type {
  Block,
  FileRef,
  HandoffBlockedCall,
  HandoffCompletedStep,
  HandoffRecentTurn,
  HandoffReplay,
  HandoffReplayBlock,
  HandoffReplayTurn,
  HandoffV1,
  ModelChoice,
  SessionDetail,
  Turn,
} from '../protocol';

/** 轻引擎历史消息的结构（和 light/types.ts 的 ChatMessage 兼容） */
export interface HandoffHistoryMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

export type ConversationSide = 'light' | 'full';

/**
 * 一条逻辑会话对应两个物理会话。
 *
 * `id` / `activeSide` 是 UI 唯一的入口：列表、发送、审批都只认逻辑 id；
 * `lightSessionId` 与 `fullSessionId` 只在 store 内部用。
 */
export interface ConversationLink {
  id: string;
  lightSessionId: string;
  fullSessionId?: string;
  title: string;
  presetId: string;
  activeSide: ConversationSide;
  status: 'pending' | 'active' | 'failed';
  handoffId: string;
  seedMarker: string;
  seedTurnId?: string;
  /**
   * M2.2：反向交接（完整 → 轻）会把完整历史重建成轻引擎回合。
   * 这类逻辑会话以轻引擎回合为唯一正文，避免 mergeDetail 再把完整侧追加一遍。
   */
  handoffDirection?: 'light_to_full' | 'full_to_light';
  lastError?: string;
  updatedAt: number;
}

/** v2 = v1 + 结构化 replay；v1 包仍然可以读取和导入。 */
export const HANDOFF_VERSION = 2 as const;
export const HANDOFF_VERSION_V1 = 1 as const;
export const HANDOFF_RECENT_TURNS = 8;
export const HANDOFF_SUMMARY_ASK_MAX = 500;
/** 回放最多保留多少轮（防止会话无限增长） */
export const HANDOFF_REPLAY_MAX_TURNS = 64;
export const HANDOFF_REPLAY_MAX_BLOCKS = 600;
const REPLAY_TEXT_MAX = 4_000;
const REPLAY_TOOL_ARGS_MAX = 8_000;
const REPLAY_TOOL_DETAIL_MAX = 4_000;
const REPLAY_SEED_MAX_CHARS = 24_000;

const SEED_MARKER_PREFIX = '[dsh-handoff:';

/** FNV-1a 32 位；同一输入永远得到同一串，用来做确定性 id */
export function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function seedMarkerFor(handoffId: string): string {
  return `${SEED_MARKER_PREFIX}${handoffId}]`;
}

export function buildHandoffId(input: {
  conversationId: string;
  reason: string;
  blocked: HandoffBlockedCall[];
  userText: string;
}): string {
  const blockedKey = input.blocked
    .map((call) => `${call.callId}:${call.name}:${JSON.stringify(call.args)}`)
    .join('|');
  return `h_${stableHash(`${input.conversationId}|${input.reason}|${input.userText}|${blockedKey}`)}`;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function toolCallName(history: HandoffHistoryMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of history) {
    for (const call of message.tool_calls ?? []) names.set(call.id, call.function.name);
  }
  return names;
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function briefTool(name: string, args: Record<string, unknown>): string {
  const path = typeof args.path === 'string' ? args.path : '';
  switch (name) {
    case 'bash': {
      const command = typeof args.command === 'string' ? (args.command.split('\n')[0] ?? '') : '';
      return clip(`执行命令：${command}`, 120);
    }
    case 'read_file':
      return clip(`读取 ${path || '/'}`, 120);
    case 'write_file':
      return clip(`写入 ${path || '/'}`, 120);
    case 'list_dir':
      return clip(`列出 ${path || '/'}`, 120);
    case 'create_docx':
      return clip(`生成 Word ${path}`, 120);
    case 'create_xlsx':
      return clip(`生成 Excel ${path}`, 120);
    case 'read_docx':
      return clip(`读取 Word ${path}`, 120);
    case 'read_xlsx':
      return clip(`读取 Excel ${path}`, 120);
    case 'generate_image':
      return clip(`生图：${typeof args.prompt === 'string' ? args.prompt : ''}`, 120);
    default:
      return name;
  }
}

/** 历史里的 tool 消息 = 已执行完的调用；没有结果的调用不算 completed。 */
export function completedStepsFromHistory(history: HandoffHistoryMessage[]): HandoffCompletedStep[] {
  const names = toolCallName(history);
  const argsById = new Map<string, Record<string, unknown>>();
  for (const message of history) {
    for (const call of message.tool_calls ?? []) {
      argsById.set(call.id, parseArgs(call.function.arguments));
    }
  }
  const steps: HandoffCompletedStep[] = [];
  const seen = new Set<string>();
  for (const message of history) {
    if (message.role !== 'tool' || !message.tool_call_id || seen.has(message.tool_call_id)) continue;
    // 能力门补的占位结果不算已完成（否则交接会以为这步跑过了）
    if (message.content?.includes('[CAPABILITY_MISSING]')) continue;
    seen.add(message.tool_call_id);
    const name = message.name ?? names.get(message.tool_call_id) ?? 'tool';
    const summary =
      message.content && message.content.trim()
        ? clip(message.content, 140)
        : briefTool(name, argsById.get(message.tool_call_id) ?? {});
    steps.push({ callId: message.tool_call_id, name, summary });
  }
  return steps;
}

/**
 * 截取最近 N 条消息（含工具调用与结果）。
 * 从中间切断时丢掉开头孤立的 tool 结果，避免 seed 里出现"没有调用的结果"。
 */
export function truncateTurns(
  history: HandoffHistoryMessage[],
  limit: number = HANDOFF_RECENT_TURNS,
): HandoffRecentTurn[] {
  const messages = history.filter((message) => message.role !== 'system').slice(-Math.max(1, limit));
  while (messages.length > 0 && messages[0]?.role === 'tool') messages.shift();
  return messages.map((message) => ({
    // filter 已经排除了 system；这里用断言让 TS 收窄联合类型
    role: message.role as 'user' | 'assistant' | 'tool',
    ...(message.content ? { content: message.content } : {}),
    ...(message.tool_calls && message.tool_calls.length > 0
      ? {
          toolCalls: message.tool_calls.map((call) => ({
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          })),
        }
      : {}),
    ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}),
    ...(message.name ? { name: message.name } : {}),
  }));
}

/** 从历史文本里捞工作区文件路径（`/workspace/a`、`/root/work/a`、`uploads/a`） */
function pathsInText(text: string): string[] {
  const found: string[] = [];
  const pattern = /(?:\/workspace\/|\/root\/work\/|(?:^|[\s"'`(]))((?:uploads\/)?[^\s"'`),;]+)/gu;
  for (const match of text.matchAll(pattern)) {
    const value = match[1];
    if (value && /\.(docx|xlsx|pptx|pdf|txt|md|json|csv|zip|png|jpe?g)$/i.test(value)) {
      found.push(value);
    }
  }
  return found;
}

/** Handoff.fileRefs：附件与工作区文件，去重后最多 12 个 */
export function collectFileRefs(
  history: HandoffHistoryMessage[],
  extra: FileRef[] = [],
): FileRef[] {
  const refs = new Map<string, FileRef>();
  const add = (ref: FileRef): void => {
    if (!ref.relPath || refs.has(ref.relPath)) return;
    refs.set(ref.relPath, ref);
  };
  for (const ref of extra) add(ref);
  const scan = (value: string): void => {
    const rel = value.replace(/^\/root\/work\//, '').replace(/^\/workspace\//, '');
    if (!rel || rel.startsWith('/') || rel.includes('..')) return;
    add({ path: value, relPath: rel, name: rel.split('/').pop() ?? rel });
  };
  for (const message of history) {
    if (message.content) {
      for (const path of pathsInText(message.content)) scan(path);
    }
    for (const call of message.tool_calls ?? []) {
      const args = parseArgs(call.function.arguments);
      if (typeof args.path === 'string') scan(args.path);
      if (typeof args.command === 'string') {
        for (const path of pathsInText(args.command)) scan(path);
      }
    }
  }
  return [...refs.values()].slice(0, 12);
}

/** 摘要里提到的文件路径（不要求是 uploads） */
export function touchedFilePaths(history: HandoffHistoryMessage[], limit = 8): string[] {
  const paths = new Set<string>();
  for (const message of history) {
    if (message.content) {
      for (const path of pathsInText(message.content)) paths.add(path.replace(/^\/root\/work\//, '').replace(/^\/workspace\//, ''));
    }
    for (const call of message.tool_calls ?? []) {
      const args = parseArgs(call.function.arguments);
      if (typeof args.path === 'string' && args.path.trim()) {
        paths.add(args.path.replace(/^\/root\/work\//, '').replace(/^\/workspace\//, ''));
      }
    }
  }
  return [...paths].slice(0, limit);
}

export function lastUserMessage(history: HandoffHistoryMessage[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message?.role === 'user' && message.content?.trim()) return message.content.trim();
  }
  return '';
}

export function lastAssistantMessage(history: HandoffHistoryMessage[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message?.role === 'assistant' && message.content?.trim()) return message.content.trim();
  }
  return '';
}

/** 摘要：最后一问（≤500 字）+ 已完成工具 + 涉及文件 */
export function buildExtractiveSummary(
  userText: string,
  completed: HandoffCompletedStep[],
  files: string[],
): string {
  const lines: string[] = [`用户请求：${clip(userText || '（没有记录到用户请求）', HANDOFF_SUMMARY_ASK_MAX)}`];
  const names = [...new Set(completed.map((step) => step.name))];
  if (names.length > 0) lines.push(`已完成工具：${names.slice(0, 12).join('、')}`);
  if (files.length > 0) lines.push(`涉及文件：${files.slice(0, 8).join('、')}`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * M2.2 结构化回放（turn / block / tool 事件）
 * ------------------------------------------------------------------ */

function take(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function safeArgs(value: unknown): string {
  if (typeof value === 'string') return take(value, REPLAY_TOOL_ARGS_MAX);
  try {
    return take(JSON.stringify(value ?? {}), REPLAY_TOOL_ARGS_MAX);
  } catch {
    return '{}';
  }
}

function failedToolResult(content: string | null | undefined): boolean {
  return Boolean(content && /^\[(错误|已拒绝)\]/.test(content.trim()));
}

function argsByCallId(
  history: HandoffHistoryMessage[],
): Map<string, { name: string; arguments: string }> {
  const map = new Map<string, { name: string; arguments: string }>();
  for (const message of history) {
    for (const call of message.tool_calls ?? []) {
      map.set(call.id, { name: call.function.name, arguments: safeArgs(call.function.arguments) });
    }
  }
  return map;
}

function statsOf(turns: HandoffReplayTurn[], truncated: boolean): HandoffReplay['stats'] {
  let blocks = 0;
  let tools = 0;
  for (const turn of turns) {
    blocks += turn.blocks.length;
    tools += turn.blocks.filter((block) => block.kind === 'tool').length;
  }
  return { turns: turns.length, blocks, tools, truncated };
}

/** 轻引擎 turns（最保真）→ 结构化回放：保留思考卡片、工具卡片、工具结果。 */
export function buildReplayFromTurns(
  turns: Turn[],
  history: HandoffHistoryMessage[] = [],
): HandoffReplay {
  const calls = argsByCallId(history);
  const unsupported = new Set<string>();
  const replayTurns: HandoffReplayTurn[] = [];

  for (const turn of turns) {
    const blocks: HandoffReplayBlock[] = [];
    for (const block of turn.blocks) {
      if (block.kind === 'text') {
        if (block.text.trim()) {
          blocks.push({ kind: 'text', id: block.id, text: take(block.text, REPLAY_TEXT_MAX) });
        }
        continue;
      }
      if (block.kind === 'thinking') {
        if (block.text.trim()) {
          blocks.push({ kind: 'thinking', id: block.id, text: take(block.text, REPLAY_TEXT_MAX) });
        }
        continue;
      }
      if (block.kind === 'tool') {
        const callId = block.callId ?? block.id;
        const call = calls.get(callId);
        blocks.push({
          kind: 'tool',
          id: block.id,
          callId,
          name: block.name,
          arguments: call?.arguments ?? '{}',
          summary: take(block.summary || briefTool(block.name, parseArgs(call?.arguments)), 500),
          state: block.state,
          ...(block.detail ? { detail: take(block.detail, REPLAY_TOOL_DETAIL_MAX) } : {}),
        });
        continue;
      }
      // approval / capability / image 没有跨引擎的等价事件，明确标记为 unsupported
      unsupported.add(`block:${block.kind}`);
    }
    if (blocks.length > 0) {
      replayTurns.push({
        id: turn.id,
        role: turn.role,
        createdAt: turn.createdAt,
        status: turn.status,
        blocks,
      });
    }
  }

  const truncated = replayTurns.length > HANDOFF_REPLAY_MAX_TURNS;
  const kept = truncated ? replayTurns.slice(-HANDOFF_REPLAY_MAX_TURNS) : replayTurns;
  return {
    schema: HANDOFF_REPLAY_SCHEMA,
    source: 'light-turns',
    turns: kept,
    stats: statsOf(kept, truncated),
    unsupported: [...unsupported],
  };
}

/** 只有历史消息时（例如完整 → 轻）从 user/assistant/tool 重建事件序列。 */
export function buildReplayFromHistory(history: HandoffHistoryMessage[]): HandoffReplay {
  const turns: HandoffReplayTurn[] = [];
  const pending = new Map<string, Extract<HandoffReplayBlock, { kind: 'tool' }>>();
  let index = 0;
  let truncated = false;

  const pushTurn = (role: 'user' | 'assistant', blocks: HandoffReplayBlock[]): void => {
    if (blocks.length === 0) return;
    turns.push({
      id: `history_${index}`,
      role,
      createdAt: index,
      status: 'done',
      blocks,
    });
    index += 1;
  };

  for (const message of history) {
    if (message.role === 'system') continue;
    if (message.role === 'user') {
      if (message.content?.trim()) {
        pushTurn('user', [{ kind: 'text', id: `hu_${index}`, text: take(message.content, REPLAY_TEXT_MAX) }]);
      }
      continue;
    }
    if (message.role === 'assistant') {
      const blocks: HandoffReplayBlock[] = [];
      if (message.content?.trim()) {
        blocks.push({ kind: 'text', id: `ha_${index}_t`, text: take(message.content, REPLAY_TEXT_MAX) });
      }
      for (const call of message.tool_calls ?? []) {
        const args = safeArgs(call.function.arguments);
        const block: Extract<HandoffReplayBlock, { kind: 'tool' }> = {
          kind: 'tool',
          id: `ha_${index}_${call.id}`,
          callId: call.id,
          name: call.function.name,
          arguments: args,
          summary: briefTool(call.function.name, parseArgs(call.function.arguments)),
          state: 'running',
        };
        pending.set(call.id, block);
        blocks.push(block);
      }
      pushTurn('assistant', blocks);
      continue;
    }
    // tool 结果：按 callId 回填到对应的工具块，保持调用/结果一一对应。
    const callId = message.tool_call_id ?? '';
    const target = callId ? pending.get(callId) : undefined;
    if (target) {
      target.state = failedToolResult(message.content) ? 'error' : 'done';
      if (message.content) target.detail = take(message.content, REPLAY_TOOL_DETAIL_MAX);
      pending.delete(callId);
      continue;
    }
    // 孤立结果（历史被截断/旧数据）：保留成一个单独的工具块，不丢掉信息。
    const name = message.name ?? 'tool';
    pushTurn('assistant', [
      {
        kind: 'tool',
        id: `orphan_${index}_${callId || 'tool'}`,
        callId: callId || `orphan_${index}`,
        name,
        arguments: '{}',
        summary: name,
        state: failedToolResult(message.content) ? 'error' : 'done',
        ...(message.content ? { detail: take(message.content, REPLAY_TOOL_DETAIL_MAX) } : {}),
      },
    ]);
  }

  if (turns.length > HANDOFF_REPLAY_MAX_TURNS) {
    turns.splice(0, turns.length - HANDOFF_REPLAY_MAX_TURNS);
    truncated = true;
  }
  // 被截断/没有结果时，running 工具会误导接收侧；统一降级为 done 并保留 summary。
  for (const turn of turns) {
    for (const block of turn.blocks) {
      if (block.kind === 'tool' && block.state === 'running') block.state = 'done';
    }
  }
  return {
    schema: HANDOFF_REPLAY_SCHEMA,
    source: 'history',
    turns,
    stats: statsOf(turns, truncated),
    unsupported: [],
  };
}

function buildReplay(input: {
  history: HandoffHistoryMessage[];
  turns?: Turn[];
}): HandoffReplay {
  const fromTurns = input.turns && input.turns.length > 0
    ? buildReplayFromTurns(input.turns, input.history)
    : null;
  if (fromTurns && fromTurns.turns.length > 0) return fromTurns;
  return buildReplayFromHistory(input.history);
}

/**
 * 解析/校验外部传进来的 replay。
 * 不合法返回 null；未知 block 会丢弃并计入 unsupported，调用方可以明确降级或拒绝。
 */
export function parseHandoffReplay(value: unknown): HandoffReplay | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.schema !== HANDOFF_REPLAY_SCHEMA || !Array.isArray(raw.turns)) return null;

  const unsupported = new Set<string>(
    Array.isArray(raw.unsupported)
      ? raw.unsupported.filter((item): item is string => typeof item === 'string')
      : [],
  );
  let dropped = false;
  const sourceTurns = raw.turns as unknown[];
  const slice = sourceTurns.slice(-HANDOFF_REPLAY_MAX_TURNS);
  if (slice.length < sourceTurns.length) dropped = true;
  const turns: HandoffReplayTurn[] = [];

  for (let i = 0; i < slice.length; i += 1) {
    const turn = slice[i];
    if (!turn || typeof turn !== 'object') {
      dropped = true;
      continue;
    }
    const t = turn as Record<string, unknown>;
    if (t.role !== 'user' && t.role !== 'assistant') {
      dropped = true;
      continue;
    }
    const rawBlocks = Array.isArray(t.blocks) ? (t.blocks as unknown[]) : [];
    const blocks: HandoffReplayBlock[] = [];
    for (const item of rawBlocks.slice(0, HANDOFF_REPLAY_MAX_BLOCKS)) {
      if (!item || typeof item !== 'object') {
        dropped = true;
        continue;
      }
      const b = item as Record<string, unknown>;
      const id = typeof b.id === 'string' && b.id ? b.id : `p_${i}_${blocks.length}`;
      if (b.kind === 'text' || b.kind === 'thinking') {
        if (typeof b.text !== 'string' || !b.text) {
          dropped = true;
          continue;
        }
        blocks.push({ kind: b.kind, id, text: take(b.text, REPLAY_TEXT_MAX) });
        continue;
      }
      if (b.kind === 'tool') {
        if (typeof b.name !== 'string' || !b.name) {
          dropped = true;
          continue;
        }
        const state = b.state === 'running' || b.state === 'error' ? b.state : 'done';
        const callId = typeof b.callId === 'string' && b.callId ? b.callId : id;
        blocks.push({
          kind: 'tool',
          id,
          callId,
          name: b.name,
          arguments: typeof b.arguments === 'string' ? take(b.arguments, REPLAY_TOOL_ARGS_MAX) : '{}',
          summary: typeof b.summary === 'string' ? take(b.summary, 500) : b.name,
          state,
          ...(typeof b.detail === 'string' ? { detail: take(b.detail, REPLAY_TOOL_DETAIL_MAX) } : {}),
        });
        continue;
      }
      unsupported.add(`block:${String(b.kind ?? 'unknown')}`);
      dropped = true;
    }
    if (rawBlocks.length > HANDOFF_REPLAY_MAX_BLOCKS) dropped = true;
    if (blocks.length === 0) continue;
    const status =
      t.status === 'streaming' || t.status === 'stopped' || t.status === 'error' ? t.status : 'done';
    turns.push({
      id: typeof t.id === 'string' && t.id ? t.id : `p_turn_${i}`,
      role: t.role,
      createdAt: typeof t.createdAt === 'number' ? t.createdAt : i,
      status,
      blocks,
    });
  }

  if (turns.length === 0) return null;
  return {
    schema: HANDOFF_REPLAY_SCHEMA,
    source: raw.source === 'light-turns' ? 'light-turns' : 'history',
    turns,
    stats: statsOf(turns, dropped || (raw.stats as { truncated?: unknown } | undefined)?.truncated === true),
    unsupported: [...unsupported],
  };
}

/** replay → 轻引擎 turns（用于 sessions.import 重建会话正文）。 */
export function replayToTurns(replay: HandoffReplay | undefined): Turn[] {
  if (!replay) return [];
  return replay.turns.map((turn, turnIndex) => ({
    id: `ho_t${turnIndex}_${turn.id}`,
    role: turn.role,
    createdAt: turn.createdAt,
    status: turn.status === 'streaming' ? 'done' : turn.status,
    blocks: turn.blocks.map((block, blockIndex): Block => {
      const id = `ho_t${turnIndex}_b${blockIndex}_${block.id}`;
      if (block.kind === 'text') return { kind: 'text', id, text: block.text, done: true };
      if (block.kind === 'thinking') return { kind: 'thinking', id, text: block.text, done: true };
      return {
        kind: 'tool',
        id,
        callId: block.callId,
        name: block.name,
        summary: block.summary,
        // 交接只发生在回合边界；历史里的 running 不应在接收侧永远转圈。
        state: block.state === 'running' ? 'done' : block.state,
        ...(block.detail ? { detail: block.detail } : {}),
      };
    }),
  }));
}

/** replay → 轻引擎 history（模型上下文）；工具调用与结果按原顺序一一对应。 */
export function replayToHistory(replay: HandoffReplay | undefined): HandoffHistoryMessage[] {
  if (!replay) return [];
  const out: HandoffHistoryMessage[] = [];
  for (const turn of replay.turns) {
    const text = turn.blocks
      .map((block) => (block.kind === 'text' ? block.text : ''))
      .join('\n')
      .trim();
    if (turn.role === 'user') {
      if (text) out.push({ role: 'user', content: text });
      continue;
    }
    const tools = turn.blocks.filter(
      (block): block is Extract<HandoffReplayBlock, { kind: 'tool' }> => block.kind === 'tool',
    );
    if (!text && tools.length === 0) continue;
    out.push({
      role: 'assistant',
      content: text || null,
      ...(tools.length > 0
        ? {
            tool_calls: tools.map((block) => ({
              id: block.callId,
              type: 'function' as const,
              function: { name: block.name, arguments: block.arguments || '{}' },
            })),
          }
        : {}),
    });
    for (const block of tools) {
      out.push({
        role: 'tool',
        tool_call_id: block.callId,
        name: block.name,
        content:
          block.detail ??
          block.summary ??
          (block.state === 'error' ? '[错误] 工具执行失败' : '[已完成]'),
      });
    }
  }
  return out;
}

/** 从 seed 第一行的 marker 反推 handoffId（旧客户端只传 text 也能幂等）。 */
export function handoffIdFromSeed(text: string): string | undefined {
  const match = /\[dsh-handoff:(h_[0-9a-zA-Z]+)\]/u.exec(text);
  return match?.[1];
}

function clipLine(text: string, max: number): string {
  return take(text.replace(/\s+/g, ' ').trim(), max);
}

function renderReplaySeed(replay: HandoffReplay): string[] {
  const chunks: string[] = [];
  let used = 0;
  let skipped = 0;
  for (let i = replay.turns.length - 1; i >= 0; i -= 1) {
    const turn = replay.turns[i]!;
    const lines: string[] = [];
    if (turn.role === 'user') {
      const text = turn.blocks
        .filter((block): block is Extract<HandoffReplayBlock, { kind: 'text' }> => block.kind === 'text')
        .map((block) => block.text)
        .join('\n');
      lines.push(`T${i + 1} USER: ${clipLine(text, 1_000)}`);
    } else {
      lines.push(`T${i + 1} ASSISTANT:`);
      for (const block of turn.blocks) {
        if (block.kind === 'text') {
          lines.push(`  - TEXT: ${clipLine(block.text, 1_000)}`);
        } else if (block.kind === 'thinking') {
          lines.push(`  - THINKING: ${clipLine(block.text, 800)}`);
        } else {
          const result = block.detail ?? block.summary;
          lines.push(
            `  - TOOL ${block.name} #${block.callId} [${block.state}] ` +
              `args=${clipLine(block.arguments, 300)} result=${clipLine(result, 600)}`,
          );
        }
      }
    }
    const chunk = lines.join('\n');
    if (used + chunk.length > REPLAY_SEED_MAX_CHARS && chunks.length > 0) {
      skipped = i + 1;
      break;
    }
    used += chunk.length;
    chunks.push(chunk);
  }
  chunks.reverse();
  const out = ['## 结构化回放（turn / block / tool，按时间顺序）'];
  if (replay.unsupported.length > 0) {
    out.push(`（未回放：${replay.unsupported.join('、')}；这些块没有跨引擎等价事件）`);
  }
  if (skipped > 0) out.push(`（较早的 ${skipped} 轮已省略；完整数据见 replay 字段）`);
  out.push(...chunks);
  return out;
}

export interface BuildHandoffInput {
  conversationId: string;
  reason: string;
  from?: { engine: 'light' | 'full'; sessionId: string; hostId?: string };
  presetId: string;
  presetForTarget?: string;
  permission?: { source: string; target?: string; escalated?: boolean };
  model?: { source?: ModelChoice; target?: ModelChoice; matched?: boolean; notice?: string };
  channel?: { baseURL: string; model: string; apiKeyRef: string };
  history: HandoffHistoryMessage[];
  turns?: Turn[];
  userText?: string;
  assistantText?: string;
  blocked?: HandoffBlockedCall[];
  missing?: string[];
  files?: FileRef[];
  now?: number;
  limit?: number;
  /** 1 = 只生成旧版摘要包；默认 2（带结构化 replay） */
  version?: 1 | 2;
}

export function buildHandoff(input: BuildHandoffInput): HandoffV1 {
  const history = input.history;
  const version = input.version ?? HANDOFF_VERSION;
  const userText = input.userText?.trim() || lastUserMessage(history);
  const assistantText = input.assistantText?.trim() || lastAssistantMessage(history);
  const blocked = input.blocked ?? [];
  const completed = completedStepsFromHistory(history);
  const fileRefs = collectFileRefs(history, input.files ?? []);
  const handoffId = buildHandoffId({
    conversationId: input.conversationId,
    reason: input.reason,
    blocked,
    userText,
  });
  // v1 用抽取式摘要；TODO(1.4): 模型生成摘要后置（需要多一次模型调用与失败兜底）。
  const summary = buildExtractiveSummary(userText, completed, touchedFilePaths(history));
  const replay =
    version >= 2 ? buildReplay({ history, ...(input.turns ? { turns: input.turns } : {}) }) : undefined;
  return {
    version,
    conversationId: input.conversationId,
    reason: input.reason,
    from: input.from ?? { engine: 'light', sessionId: input.conversationId },
    presetId: input.presetId,
    presetForTarget: input.presetForTarget ?? input.presetId,
    permission: {
      source: input.permission?.source ?? 'workspace-write',
      target: input.permission?.target ?? input.permission?.source ?? 'workspace-write',
      escalated: input.permission?.escalated ?? false,
    },
    model: {
      ...(input.model?.source ? { source: input.model.source } : {}),
      ...(input.model?.target ? { target: input.model.target } : {}),
      matched: input.model?.matched ?? true,
      ...(input.model?.notice ? { notice: input.model.notice } : {}),
    },
    channel: input.channel ?? { baseURL: '', model: '', apiKeyRef: 'light-engine' },
    summary,
    recentTurns: truncateTurns(history, input.limit ?? HANDOFF_RECENT_TURNS),
    completedSteps: completed,
    fileRefs,
    pendingIntent: {
      kind: blocked.length > 0 ? 'blocked_tool' : 'message',
      userText,
      ...(assistantText ? { assistantText } : {}),
      blocked,
      ...(input.missing && input.missing.length > 0 ? { missing: input.missing } : {}),
    },
    handoffId,
    seedMarker: seedMarkerFor(handoffId),
    createdAt: input.now ?? Date.now(),
    ...(replay ? { replay } : {}),
  };
}

/** 完整引擎会话 → Handoff 历史消息（工具 block 当 tool 结果，供摘要/最近轮次用） */
export function turnDetailToHistory(turns: Turn[]): HandoffHistoryMessage[] {
  const out: HandoffHistoryMessage[] = [];
  for (const turn of turns) {
    if (turn.role === 'user') {
      const text = turn.blocks
        .map((block) => (block.kind === 'text' ? block.text : ''))
        .join('')
        .trim();
      if (text) out.push({ role: 'user', content: text });
      continue;
    }
    const text = turn.blocks
      .filter((block): block is Extract<Block, { kind: 'text' }> => block.kind === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (text) out.push({ role: 'assistant', content: text });
    for (const block of turn.blocks) {
      if (block.kind !== 'tool') continue;
      out.push({
        role: 'tool',
        tool_call_id: `t_${block.id}`,
        name: block.name,
        content: block.detail?.trim() || block.summary || block.state,
      });
    }
  }
  return out;
}

/** 交给完整引擎的第一条消息；只给"不要重做"的指令和上下文，不重放工具。 */
export function buildSeedText(handoff: HandoffV1): string {
  const lines: string[] = [];
  lines.push(handoff.seedMarker);
  lines.push('这是一次从手机轻引擎到完整引擎的交接。不要重做已完成步骤，只继续未执行的步骤。');
  const hasReplay = Boolean(handoff.replay && handoff.replay.turns.length > 0);
  if (hasReplay) {
    lines.push('兼容说明：完整引擎不支持原生事件导入；结构化回放按文本降级，接收侧按顺序理解。');
  }
  lines.push('');
  lines.push('## 摘要');
  lines.push(handoff.summary || '（无）');
  lines.push('');
  lines.push('## 已完成步骤（不要重做）');
  if (handoff.completedSteps.length === 0) {
    lines.push('（无；还没有执行过工具）');
  } else {
    handoff.completedSteps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.name}（${step.callId}）— ${step.summary}`);
    });
  }
  lines.push('');
  lines.push(`## 最近 ${handoff.recentTurns.length} 条对话（含工具调用与结果）`);
  if (handoff.recentTurns.length === 0) {
    lines.push('（无）');
  } else {
    for (const turn of handoff.recentTurns) {
      if (turn.role === 'tool') {
        lines.push(`TOOL[${turn.name ?? turn.toolCallId ?? 'tool'}]: ${turn.content ?? ''}`);
        continue;
      }
      if (turn.toolCalls && turn.toolCalls.length > 0) {
        lines.push(
          `${turn.role.toUpperCase()}（工具调用）：${turn.toolCalls
            .map((call) => `${call.name}(${call.arguments})`)
            .join('；')}`,
        );
        if (turn.content) lines.push(`${turn.role.toUpperCase()}: ${turn.content}`);
        continue;
      }
      lines.push(`${turn.role.toUpperCase()}: ${turn.content ?? ''}`);
    }
  }
  if (hasReplay && handoff.replay) {
    lines.push('');
    lines.push(...renderReplaySeed(handoff.replay));
  }
  lines.push('');
  lines.push('## 涉及文件');
  if (handoff.fileRefs.length === 0) {
    lines.push('（无）');
  } else {
    for (const file of handoff.fileRefs) lines.push(`- ${file.relPath}`);
  }
  lines.push('');
  lines.push('## 未执行的调用（只继续这些，不要再调用已经完成的工具）');
  if (handoff.pendingIntent.blocked.length === 0) {
    lines.push('（无已拦截的工具调用）');
  } else {
    lines.push('```json');
    lines.push(JSON.stringify(handoff.pendingIntent.blocked, null, 2));
    lines.push('```');
    if (handoff.pendingIntent.missing && handoff.pendingIntent.missing.length > 0) {
      lines.push(`缺少的能力：${handoff.pendingIntent.missing.join('、')}`);
    }
  }
  lines.push('');
  lines.push('## 用户请求');
  lines.push(handoff.pendingIntent.userText || '（无）');
  if (handoff.pendingIntent.assistantText) {
    lines.push('');
    lines.push('## 轻引擎最后的回答');
    lines.push(handoff.pendingIntent.assistantText);
  }
  return lines.join('\n');
}

/** 完整 → 轻的 seed：结构与正向一致，只换交接方向说明（M2.6 继续版）。 */
export function buildReverseSeedText(handoff: HandoffV1): string {
  return buildSeedText(handoff)
    .replace(
      '这是一次从手机轻引擎到完整引擎的交接。不要重做已完成步骤，只继续未执行的步骤。',
      '这是从完整引擎回到手机轻引擎的继续会话。不要重做已完成步骤；需要跑 Python/Office/长任务时再切回完整引擎。',
    )
    .replace(
      '兼容说明：完整引擎不支持原生事件导入；结构化回放按文本降级，接收侧按顺序理解。',
      '兼容说明：轻引擎会按结构化 turn/block/tool 重建上下文，工具结果保持原顺序。',
    );
}

/* ------------------------------------------------------------------ *
 * 逻辑会话 ⇄ 物理会话
 * ------------------------------------------------------------------ */

export function physicalIdFor(
  link: ConversationLink | undefined,
  side: ConversationSide = link?.activeSide ?? 'light',
): string | undefined {
  if (!link) return undefined;
  return side === 'full' ? (link.fullSessionId ?? link.lightSessionId) : link.lightSessionId;
}

/** 需求里用的短名：logicalId / physicalId / seedMarker（实现本体带 For 后缀） */
export const logicalId = logicalIdFor;
export const physicalId = physicalIdFor;
export const seedMarker = seedMarkerFor;

export function logicalIdFor(link: ConversationLink | undefined, physicalId: string): string | undefined {
  if (!link) return undefined;
  if (physicalId === link.lightSessionId || physicalId === link.fullSessionId || physicalId === link.id) {
    return link.id;
  }
  return undefined;
}

export function upsertConversationLink(
  links: ConversationLink[],
  next: ConversationLink,
): ConversationLink[] {
  const index = links.findIndex((link) => link.id === next.id);
  if (index < 0) return [...links, next];
  const copy = links.slice();
  copy[index] = next;
  return copy;
}

/** 清空两边的 seed 用户消息；full 快照里如果还有别的轮次也保留。 */
export function stripSeedTurns(turns: Turn[], seedMarker: string, seedTurnId?: string): Turn[] {
  return turns.filter((turn) => {
    if (turn.id === seedTurnId) return false;
    if (turn.role !== 'user') return true;
    const text = turn.blocks
      .map((block) => (block.kind === 'text' ? block.text : ''))
      .join('');
    return !text.includes(seedMarker);
  });
}

/**
 * 完整引擎在切 approval policy 时会往历史里写一条 user 角色提示
 * （"The approval policy changed from … to …"），它不是用户发的，别显示成用户气泡。
 * 只按这句固定文案过滤，避免误吞真实用户消息（见 PITFALLS I9）。
 */
const ENGINE_NOTICE_PATTERN = /^The approval policy changed\b/i;

function isEngineNoticeTurn(turn: Turn): boolean {
  if (turn.role !== 'user') return false;
  const text = turn.blocks
    .map((block) => (block.kind === 'text' ? block.text : ''))
    .join('')
    .trim();
  return ENGINE_NOTICE_PATTERN.test(text);
}

/** 完整引擎侧回合：去 seed + 去引擎自动提示 */
function fullSideTurns(turns: Turn[], seedMarker: string, seedTurnId?: string): Turn[] {
  return stripSeedTurns(turns, seedMarker, seedTurnId).filter((turn) => !isEngineNoticeTurn(turn));
}

/** 原生完整会话展示层也过滤引擎提示（不进 ConversationLink 的会话同样适用） */
export function stripEngineNoticeTurns(turns: Turn[]): Turn[] {
  return turns.filter((turn) => !isEngineNoticeTurn(turn));
}


/**
 * 逻辑会话详情 = 轻引擎缓存回合 + 完整引擎回合（去掉 seed 用户消息）。
 * 任一侧缺失时退回另一侧，UI 永远只看到一条会话。
 */
export function mergeDetail(
  link: ConversationLink,
  light: SessionDetail | null | undefined,
  full: SessionDetail | null | undefined,
): SessionDetail | null {
  const base = light ?? null;
  const target = full ?? null;
  if (!base && !target) return null;
  // 反向交接已经把完整历史重建成轻引擎回合：以轻侧为唯一正文，避免重复一遍。
  if (link.handoffDirection === 'full_to_light' && base) {
    return {
      ...base,
      id: link.id,
      title: link.title || base.title,
      presetId: link.presetId || base.presetId,
      turns: stripSeedTurns(base.turns, link.seedMarker, link.seedTurnId),
    };
  }
  if (!target) {
    return { ...base!, turns: stripSeedTurns(base!.turns, link.seedMarker, link.seedTurnId) };
  }
  if (!base) {
    return {
      ...target,
      id: link.id,
      title: link.title || target.title,
      presetId: link.presetId || target.presetId,
      turns: fullSideTurns(target.turns, link.seedMarker, link.seedTurnId),
    };
  }
  const turns = [...base.turns, ...fullSideTurns(target.turns, link.seedMarker, link.seedTurnId)];
  return {
    ...target,
    id: link.id,
    title: link.title || target.title || base.title,
    presetId: link.presetId || target.presetId || base.presetId,
    turns,
    status: target.status,
    updatedAt: Math.max(base.updatedAt, target.updatedAt),
    unread: 0,
    preview: target.preview || base.preview,
  };
}

/** 完整引擎快照里找到 seed 用户回合（发送结果不确定时用来判定"其实已经落地"） */
export function findSeedTurnId(detail: SessionDetail | null | undefined, seedMarker: string): string | undefined {
  if (!detail) return undefined;
  for (const turn of detail.turns) {
    if (turn.role !== 'user') continue;
    const text = turn.blocks.map((block) => (block.kind === 'text' ? block.text : '')).join('');
    if (text.includes(seedMarker)) return turn.id;
  }
  return undefined;
}

export function detailHasSeedMarker(
  detail: SessionDetail | null | undefined,
  seedMarker: string,
): boolean {
  return findSeedTurnId(detail, seedMarker) != null;
}

/**
 * 顶栏/发送门：完整侧链路断了，这个逻辑会话就只读；
 * 绝不在轻引擎里自动重放完整引擎做过的步骤。
 */
export function isConversationReadOnly(
  link: ConversationLink | undefined,
  engineMode: 'light' | 'starting-proot' | 'full',
): boolean {
  if (!link) return false;
  if (link.activeSide === 'full') return engineMode !== 'full';
  return engineMode !== 'light' && engineMode !== 'starting-proot';
}

/** 最近一条用户文本（能力卡触发交接时取"用户到底要什么"） */
export function lastUserTextFromDetail(detail: SessionDetail | null | undefined): string {
  if (!detail) return '';
  for (let i = detail.turns.length - 1; i >= 0; i -= 1) {
    const turn = detail.turns[i];
    if (turn?.role !== 'user') continue;
    const text = turn.blocks
      .map((block) => (block.kind === 'text' ? block.text : ''))
      .join('')
      .trim();
    if (text) return text;
  }
  return '';
}

/** 最近一条助手文本（seed 里给完整引擎看"轻引擎最后说到哪"） */
export function lastAssistantTextFromDetail(detail: SessionDetail | null | undefined): string {
  if (!detail) return '';
  for (let i = detail.turns.length - 1; i >= 0; i -= 1) {
    const turn = detail.turns[i];
    if (turn?.role !== 'assistant') continue;
    const text = turn.blocks
      .filter((block): block is Extract<Turn['blocks'][number], { kind: 'text' }> => block.kind === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

/** 完整引擎预设映射：同名优先，reader → minimal，否则目标第一个 */
export function mapPresetForTarget(sourcePresetId: string, targetPresetIds: string[]): string {
  if (targetPresetIds.length === 0) return sourcePresetId || 'standard';
  if (targetPresetIds.includes(sourcePresetId)) return sourcePresetId;
  if (sourcePresetId === 'reader' && targetPresetIds.includes('minimal')) return 'minimal';
  return targetPresetIds[0] as string;
}
