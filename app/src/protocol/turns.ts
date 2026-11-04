import type { Block, Turn } from './index';

/**
 * 流式回合的共享归一化规则。
 *
 * 桥和客户端必须用同一套 run/turn/block 身份与合并策略：
 * - 新数据只按 runId 合并，绝不因为“都在 streaming”跨 run 合并；
 * - 快照与实时事件可能给同一段不同 id，内容前缀只作为同一 run 内的兜底；
 * - 合并时尽量保留未变化的 block/turn 引用，供 React.memo 使用。
 */

const PREFIX_MIN_LENGTH = 20;

export function canonicalRunId(turnNo: unknown, fallback?: string): string | undefined {
  if (typeof turnNo === 'number' && Number.isFinite(turnNo) && turnNo >= 0) {
    return `turn:${turnNo}`;
  }
  return fallback && fallback.length > 0 ? fallback : undefined;
}

export function canonicalTurnId(runId: string): string {
  return `turn-${runId}`;
}

export function canonicalBlockId(runId: string, index: number): string {
  return `${runId}:b${index}`;
}

export function liveBlockId(runId: string, step: number, index: number): string {
  return `${runId}:live:${step}:b${index}`;
}

function textPair(a: Block, b: Block): [string, string] | null {
  if ((a.kind === 'text' || a.kind === 'thinking') && a.kind === b.kind) {
    return [a.text, (b as Extract<Block, { kind: 'text' | 'thinking' }>).text];
  }
  return null;
}

function prefixMatch(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (left === right) return true;
  return (
    left.length >= PREFIX_MIN_LENGTH &&
    right.length >= PREFIX_MIN_LENGTH &&
    (left.startsWith(right) || right.startsWith(left))
  );
}

export function sameBlock(a: Block, b: Block): boolean {
  if (a.kind !== b.kind) return false;
  if (a.id === b.id) return true;
  const texts = textPair(a, b);
  if (texts) return prefixMatch(texts[0], texts[1]);
  if (a.kind === 'tool' && b.kind === 'tool') {
    return (
      (a.name === b.name && a.summary === b.summary) ||
      (a.name === b.name && Boolean(a.detail) && a.detail === b.detail)
    );
  }
  if (a.kind === 'approval' && b.kind === 'approval') return a.approvalId === b.approvalId;
  return false;
}

function preferLongerText(
  oldBlock: Extract<Block, { kind: 'text' | 'thinking' }>,
  nextBlock: Extract<Block, { kind: 'text' | 'thinking' }>,
): Extract<Block, { kind: 'text' | 'thinking' }> {
  if (nextBlock.text.length > oldBlock.text.length) {
    return { ...nextBlock, ...(nextBlock.done || !oldBlock.done ? {} : { done: true }) };
  }
  if (oldBlock.text === nextBlock.text && nextBlock.done && !oldBlock.done) {
    return { ...oldBlock, done: true };
  }
  return oldBlock;
}

export function mergeBlock(oldBlock: Block, nextBlock: Block): Block {
  if (oldBlock.id === nextBlock.id) {
    const oldText = textPair(oldBlock, nextBlock);
    if (oldText) return preferLongerText(oldBlock as never, nextBlock as never) as Block;
    if (oldBlock.kind === 'tool' && nextBlock.kind === 'tool') {
      if (
        oldBlock.state === nextBlock.state &&
        oldBlock.summary === nextBlock.summary &&
        oldBlock.detail === nextBlock.detail
      ) {
        return oldBlock;
      }
      return nextBlock;
    }
    if (JSON.stringify(oldBlock) === JSON.stringify(nextBlock)) return oldBlock;
    return nextBlock;
  }
  const texts = textPair(oldBlock, nextBlock);
  if (texts && prefixMatch(texts[0], texts[1])) {
    return preferLongerText(oldBlock as never, nextBlock as never) as Block;
  }
  if (oldBlock.kind === 'tool' && nextBlock.kind === 'tool') {
    if (oldBlock.state === 'done' && nextBlock.state === 'running') return oldBlock;
    return nextBlock;
  }
  if (oldBlock.kind === 'approval' && nextBlock.kind === 'approval') return oldBlock;
  return nextBlock;
}

function mergeBlocks(oldBlocks: Block[], nextBlocks: Block[]): Block[] {
  let blocks = oldBlocks;
  for (const nextBlock of nextBlocks) {
    const index = blocks.findIndex((block) => sameBlock(block, nextBlock));
    if (index < 0) {
      if (blocks === oldBlocks) blocks = oldBlocks.slice();
      blocks.push(nextBlock);
      continue;
    }
    const oldBlock = blocks[index]!;
    const merged = mergeBlock(oldBlock, nextBlock);
    if (merged === oldBlock) continue;
    if (blocks === oldBlocks) blocks = oldBlocks.slice();
    blocks[index] = merged;
  }
  return blocks;
}

export function mergeTurn(prev: Turn, next: Turn): Turn {
  if (next.role === 'user') return next;
  const blocks = mergeBlocks(prev.blocks, next.blocks);
  const status =
    prev.status === 'streaming' || next.status === 'streaming'
      ? 'streaming'
      : next.status;
  const meta = next.meta ?? prev.meta;
  const usage = next.usage ?? prev.usage;
  if (
    blocks === prev.blocks &&
    prev.id === next.id &&
    prev.runId === next.runId &&
    prev.status === status &&
    prev.meta === meta &&
    prev.usage === usage &&
    prev.createdAt === Math.min(prev.createdAt, next.createdAt)
  ) {
    return prev;
  }
  return {
    ...prev,
    id: next.id || prev.id,
    runId: prev.runId ?? next.runId,
    blocks,
    status,
    meta,
    usage,
    createdAt: Math.min(prev.createdAt, next.createdAt),
  };
}

function sharesBlock(a: Turn, b: Turn): boolean {
  return a.blocks.some((left) => b.blocks.some((right) => sameBlock(left, right)));
}

export function sameRun(left: Turn, right: Turn): boolean {
  if (left.role !== 'assistant' || right.role !== 'assistant') return false;
  if (left.id === right.id) return true;
  if (left.runId && right.runId) return left.runId === right.runId;
  // 旧宿主可能完全没有 runId；只在双方都缺失时用内容兜底，绝不跨已知 run 猜。
  if (!left.runId && !right.runId) {
    return (
      (left.status === 'streaming' && right.status === 'streaming') ||
      sharesBlock(left, right)
    );
  }
  return false;
}

/** 只合并相邻的同 run assistant 回合；跨 run 的 assistant 绝不合并。 */
export function mergeNearbyTurns(turns: Turn[], incoming: Turn): Turn[] {
  if (incoming.role === 'user') {
    if (turns.some((turn) => turn.id === incoming.id)) return turns;
    return [...turns, incoming];
  }
  const last = turns[turns.length - 1];
  if (!last || !sameRun(last, incoming)) return [...turns, incoming];
  const merged = mergeTurn(last, incoming);
  if (merged === last) return turns;
  const next = turns.slice();
  next[next.length - 1] = merged;
  return next;
}

export function normalizeTurns(turns: Turn[]): Turn[] {
  return turns.reduce<Turn[]>((acc, turn) => mergeNearbyTurns(acc, turn), []);
}

/** 客户端收到 sessions.get 时，把仍在运行的实时回合并回快照。 */
export function mergeLiveTurn(turns: Turn[], live: Turn): Turn[] {
  let index = -1;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i]!;
    if (!sameRun(turn, live)) continue;
    index = i;
    break;
  }
  if (index < 0) return [...turns, live];
  const next = turns.slice();
  next[index] = mergeTurn(next[index]!, live);
  return next;
}

/**
 * 找到 run.finished 应该收尾的回合。
 * 有 runId 时匹配同一 run；只有旧宿主完全没有 runId 时才退回最后一个 streaming 回合。
 */
export function findRunTurnIndex(turns: Turn[], runId?: string): number {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i]!;
    if (turn.role !== 'assistant') continue;
    if (runId && turn.runId === runId) return i;
  }
  if (runId) {
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const turn = turns[i]!;
      if (turn.role === 'assistant' && !turn.runId && turn.status === 'streaming') return i;
    }
    return -1;
  }
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i]!;
    if (turn.role === 'assistant' && turn.status === 'streaming') return i;
  }
  return -1;
}
