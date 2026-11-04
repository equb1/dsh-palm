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
  id?: string;
  name?: string;
  arguments?: unknown;
  toolCallId?: string;
}

/* ------------------------------------------------------------------ */

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
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

function contentToBlocks(content: unknown, idPrefix: string, offset = 0): Block[] {
  const list = Array.isArray(content) ? (content as ContentBlock[]) : [];
  const out: Block[] = [];
  let i = 0;
  for (const b of list) {
    i += 1;
    const id = `${idPrefix}:b${offset + i - 1}`;
    if (b?.type === 'text' && b.text) {
      out.push({ kind: 'text', id, text: b.text });
    } else if (b?.type === 'reasoning' && b.text) {
      out.push({ kind: 'thinking', id, text: b.text });
    } else if (b?.type === 'image') {
      const att = (b as { attachment?: { name?: string } }).attachment;
      const label = att?.name ? `[图片: ${att.name}]` : '[图片]';
      out.push({ kind: 'text', id, text: label });
    } else if (b?.type === 'file') {
      const att = (b as { attachment?: { name?: string } }).attachment;
      const label = att?.name ? `[附件: ${att.name}]` : '[附件]';
      out.push({ kind: 'text', id, text: label });
    }
    // tool-call 块跳过：工具卡片统一由 tool/call 事件生成，避免重复
  }
  return out;
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
        const turnNo = typeof d.turn === 'number' ? d.turn : -1;
        const runId = canonicalRunId(d.turn);
        const msg = (d.message ?? {}) as Record<string, any>;
        if (!current || current.role !== 'assistant' || currentTurnNo !== turnNo) {
          current = newTurn(
            'assistant',
            time,
            typeof msg.id === 'string' ? msg.id : undefined,
            runId
          );
          currentTurnNo = turnNo;
        } else if (runId && !current.runId) {
          current.runId = runId;
        }
        const blockPrefix = current.runId ?? current.id;
        current.blocks.push(...contentToBlocks(msg.content, blockPrefix, current.blocks.length));
        if (d.usage) {
          const u = d.usage as Record<string, number>;
          current.usage = {
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
          };
        }
        const src = (msg.source ?? {}) as Record<string, unknown>;
        if (typeof src.model === 'string') model = src.model;
        break;
      }

      case 'tool/call': {
        if (!current || current.role !== 'assistant') {
          current = newTurn(
            'assistant',
            time,
            undefined,
            canonicalRunId(d.turn)
          );
          currentTurnNo = typeof d.turn === 'number' ? d.turn : -1;
        } else if (d.turn !== undefined && !current.runId) {
          current.runId = canonicalRunId(d.turn);
        }
        blockSeq += 1;
        const callName = str(d.name) || 'tool';
        const callId = typeof d.callId === 'string' ? d.callId : '';

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
        const block = callId ? toolIndex.get(callId) : undefined;
        if (block) {
          block.state = msg.isError === true ? 'error' : 'done';
          const text = contentToBlocks(msg.content, current?.runId ?? 'tool-result')
            .map((b) => (b.kind === 'text' ? b.text : ''))
            .join('\n');
          if (text) block.detail = clip(text, 200);
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
        if ((!current || current.role !== 'assistant') && status === 'error') {
          current = newTurn('assistant', time);
        }
        if (current && current.role === 'assistant') {
          current.status = status;
          if (status === 'error' && errMsg && current.blocks.length === 0) {
            current.blocks.push({ kind: 'text', id: `err-${turns.length}`, text: `错误：${errMsg}` });
          }
          current.meta = { steps: current.blocks.length };
        }
        current = null;
        currentTurnNo = -1;
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
      if (t.role === 'assistant' && t.status === 'streaming' && t.blocks.length > 0) {
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
