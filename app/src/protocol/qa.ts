import type {
  Approval,
  ApprovalDecision,
  ApprovalResolution,
  Block,
  RiskLevel,
} from './index';

/**
 * 问答卡的纯函数：判断一张审批/提问是否已经处理完，
 * 以及从 turn/approval 里还原「问题 + 用户答案 + 状态」。
 *
 * 界面只拿这里的结果渲染，不在这里碰 React；
 * 历史回合没有 pending approvals 时也能靠 block.snapshot / 工具结果还原。
 */

export type QaStatus = 'answered' | 'skipped' | 'rejected' | 'approved';

export interface QaView {
  approvalId: string;
  kind: 'question' | 'approval';
  title: string;
  /** 问题正文（普通审批时为空） */
  question: string;
  status: QaStatus;
  statusLabel: string;
  selected: string[];
  custom?: string;
  /** 普通审批的命令原文 */
  command?: string;
  summary: string;
  risk: RiskLevel;
  decision: ApprovalDecision;
  by?: string;
  at?: number;
}

export interface QuestionAnswer {
  id?: string;
  selected: string[];
  custom?: string;
}

const STATUS_LABELS: Record<QaStatus, string> = {
  answered: '已回答',
  skipped: '已跳过',
  rejected: '已拒绝',
  approved: '已批准',
};

export function questionText(approval: Approval): string {
  if (approval.kind === 'question') {
    return (approval.command?.trim() || approval.summary.trim() || approval.title.trim()).trim();
  }
  return (approval.summary.trim() || approval.title.trim()).trim();
}

function hasAnswerContent(resolution: ApprovalResolution): boolean {
  return Boolean(
    resolution.selected?.some((item) => item.trim().length > 0) ||
      resolution.custom?.trim(),
  );
}

/** 已处理审批/提问的状态；未处理或没有 resolution 时返回 null */
export function approvalQaStatus(
  approval: Approval,
): { status: QaStatus; label: string } | null {
  const resolution = approval.resolution;
  if (!resolution) return null;
  if (approval.kind === 'question') {
    if (resolution.by === 'timeout') return { status: 'skipped', label: STATUS_LABELS.skipped };
    if (resolution.by === 'stop' || resolution.by === 'run_finished') {
      return { status: 'rejected', label: STATUS_LABELS.rejected };
    }
    if (hasAnswerContent(resolution)) {
      return { status: 'answered', label: STATUS_LABELS.answered };
    }
    if (resolution.decision === 'reject') {
      return { status: 'rejected', label: STATUS_LABELS.rejected };
    }
    return { status: 'skipped', label: STATUS_LABELS.skipped };
  }
  return resolution.decision === 'approve'
    ? { status: 'approved', label: STATUS_LABELS.approved }
    : { status: 'rejected', label: STATUS_LABELS.rejected };
}

/** 只有已处理的审批/提问才生成只读卡数据；pending 返回 null 交给交互卡 */
export function qaViewFromApproval(approval: Approval): QaView | null {
  const resolution = approval.resolution;
  const status = approvalQaStatus(approval);
  if (!resolution || !status) return null;
  const selected = (resolution.selected ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const custom = resolution.custom?.trim();
  return {
    approvalId: approval.id,
    kind: approval.kind === 'question' ? 'question' : 'approval',
    title: approval.title,
    question: questionText(approval),
    status: status.status,
    statusLabel: status.label,
    selected,
    ...(custom ? { custom } : {}),
    ...(approval.command ? { command: approval.command } : {}),
    summary: approval.summary,
    risk: approval.risk,
    decision: resolution.decision,
    ...(resolution.by ? { by: resolution.by } : {}),
    ...(typeof resolution.at === 'number' ? { at: resolution.at } : {}),
  };
}

/**
 * 轻引擎持久化的 ask_user_question 工具结果是
 * `{"answers":[{"id":"q1","selected":["写代码"],"custom":"..."}]}`。
 * detail 可能被截断或不是 JSON，解析失败就当作没有答案。
 */
export function parseQuestionAnswer(detail?: string): QuestionAnswer | null {
  if (!detail?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const answers = (parsed as { answers?: unknown }).answers;
  const first = Array.isArray(answers) ? answers[0] : undefined;
  if (!first || typeof first !== 'object') return null;
  const record = first as Record<string, unknown>;
  const selected = Array.isArray(record.selected)
    ? record.selected.filter((item): item is string => typeof item === 'string')
    : [];
  const custom = typeof record.custom === 'string' ? record.custom : undefined;
  return {
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    selected,
    ...(custom ? { custom } : {}),
  };
}

/**
 * 旧轻引擎历史没有把 approval block 落进 turn，
 * 只剩 ask_user_question 工具块（summary=问题，detail=答案 JSON）。
 */
export function qaViewFromToolBlock(
  block: Extract<Block, { kind: 'tool' }>,
): QaView | null {
  if (block.name !== 'ask_user_question' || block.state === 'running') return null;
  const answer = parseQuestionAnswer(block.detail);
  if (!answer) return null;
  const question = block.summary.replace(/^提问[:：]\s*/, '').trim();
  return qaViewFromApproval({
    id: block.callId ?? block.id,
    sessionId: '',
    runId: '',
    createdAt: 0,
    kind: 'question',
    title: '问答记录',
    summary: question || block.summary,
    risk: 'low',
    actions: [],
    resolution: {
      decision: 'approve',
      selected: answer.selected,
      ...(answer.custom ? { custom: answer.custom } : {}),
      by: 'user',
    },
  });
}

export type ApprovalBlockView =
  | { mode: 'interactive'; approval: Approval }
  | { mode: 'readonly'; qa: QaView };

/**
 * 回合里的 approval block 该怎么画：
 * - approvals 里还有未处理数据 → 现有交互卡；
 * - 已处理（approval / snapshot 带 resolution）→ 只读问答卡；
 * - 什么都没有（旧数据）→ 不画，保持旧行为。
 */
export function approvalBlockView(
  block: Extract<Block, { kind: 'approval' }>,
  approvals: Record<string, Approval>,
): ApprovalBlockView | null {
  const live = approvals[block.approvalId];
  if (live && !live.resolution) return { mode: 'interactive', approval: live };
  const resolved = live?.resolution ? live : block.snapshot;
  if (!resolved?.resolution) return null;
  const qa = qaViewFromApproval(resolved);
  return qa ? { mode: 'readonly', qa } : null;
}

/** 已处理问题对应工具块的 block id；这些工具块不再重复画成工具行 */
export function readonlyQaToolBlockIds(
  blocks: Block[],
  approvals: Record<string, Approval>,
): Set<string> {
  const approvalIds = new Set(
    blocks
      .filter((block): block is Extract<Block, { kind: 'approval' }> => block.kind === 'approval')
      .map((block) => block.approvalId),
  );
  const ids = new Set<string>();
  for (const block of blocks) {
    if (block.kind !== 'tool') continue;
    if (block.callId && approvalIds.has(block.callId)) {
      ids.add(block.id);
      continue;
    }
    if (qaViewFromToolBlock(block)) ids.add(block.id);
  }
  return ids;
}

/**
 * 把新结果并进已有 resolution：先到的本地答案（selected/custom）
 * 不会被随后只带 decision/by 的 approval.resolved 事件冲掉。
 */
export function withApprovalResolution(
  approval: Approval,
  next: ApprovalResolution,
): Approval {
  const base = approval.resolution;
  const selected = next.selected !== undefined ? next.selected : base?.selected;
  const custom = next.custom !== undefined ? next.custom : base?.custom;
  const by = next.by ?? base?.by;
  const at = next.at ?? base?.at;
  return {
    ...approval,
    resolution: {
      decision: next.decision ?? base?.decision ?? 'approve',
      ...(selected ? { selected } : {}),
      ...(custom ? { custom } : {}),
      ...(by ? { by } : {}),
      ...(typeof at === 'number' ? { at } : {}),
    },
  };
}
