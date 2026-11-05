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
import type {
  FileRef,
  HandoffBlockedCall,
  HandoffCompletedStep,
  HandoffRecentTurn,
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
  lastError?: string;
  updatedAt: number;
}

export const HANDOFF_VERSION = 1 as const;
export const HANDOFF_RECENT_TURNS = 8;
export const HANDOFF_SUMMARY_ASK_MAX = 500;

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
}

export function buildHandoff(input: BuildHandoffInput): HandoffV1 {
  const history = input.history;
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
  return {
    version: HANDOFF_VERSION,
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
  };
}

/** 交给完整引擎的第一条消息；只给"不要重做"的指令和上下文，不重放工具。 */
export function buildSeedText(handoff: HandoffV1): string {
  const lines: string[] = [];
  lines.push(handoff.seedMarker);
  lines.push('这是一次从手机轻引擎到完整引擎的交接。不要重做已完成步骤，只继续未执行的步骤。');
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
