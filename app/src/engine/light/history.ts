/**
 * 轻引擎的历史清洗：模型服务要求 assistant.tool_calls 后面必须有
 * 一一对应的 tool 消息，否则下一次请求直接 400。
 *
 * 用户停止/中断、trimHistory 截断都可能破坏这个约束，所以每次发请求前
 * 统一清洗一遍；中断时也主动补齐未执行的调用。
 */
import type { ChatMessage, ToolCall } from './types';

export const MISSING_TOOL_RESULT = '[已停止] 未执行';

/** 给历史里缺失结果的 tool_calls 补一条“未执行” */
export function closePendingToolCalls(
  history: ChatMessage[],
  calls: ToolCall[],
  reason = MISSING_TOOL_RESULT,
): void {
  const answered = new Set(
    history
      .filter((message) => message.role === 'tool' && typeof message.tool_call_id === 'string')
      .map((message) => message.tool_call_id as string),
  );
  for (const call of calls) {
    if (answered.has(call.id)) continue;
    history.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: reason });
    answered.add(call.id);
  }
}

/** 保证每个 assistant.tool_calls 都有对应 tool，并丢掉孤立的 tool 消息 */
export function sanitizeToolHistory(history: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < history.length; i += 1) {
    const message = history[i]!;
    if (message.role === 'tool') continue; // 合法的 tool 消息在下面按 assistant 重新补
    out.push(message);
    if (message.role !== 'assistant' || !message.tool_calls?.length) continue;

    const following = new Map<string, ChatMessage>();
    let j = i + 1;
    while (j < history.length && history[j]!.role === 'tool') {
      const toolMessage = history[j]!;
      if (toolMessage.tool_call_id) following.set(toolMessage.tool_call_id, toolMessage);
      j += 1;
    }
    for (const call of message.tool_calls) {
      out.push(
        following.get(call.id) ?? {
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: MISSING_TOOL_RESULT,
        },
      );
    }
    i = j - 1;
  }
  return out;
}
