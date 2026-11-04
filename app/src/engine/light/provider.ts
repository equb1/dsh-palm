/**
 * OpenAI 兼容的流式客户端（chat/completions + SSE）。
 *
 * 选它是因为手机端不需要 SDK：DeepSeek 官方、OpenRouter、Ollama、vLLM
 * 都是这个形状。流式解析自己做，原因见 `transport.*.ts`（RN 的 fetch 不流）。
 *
 * 支持：
 *  - `content` 增量 → onText
 *  - `reasoning_content` / `reasoning` 增量（DeepSeek reasoner、OpenRouter）→ onThinking
 *  - `tool_calls` 按 index 拼装（OpenAI 的流式工具调用是分片的）
 *  - usage（stream_options.include_usage）
 */
import type { AgentTool, ChatMessage, LightModelConfig, ToolCall } from './types';
import { postSse } from './transport';
import { LIGHT_ERROR_HINTS, LightRequestError, classifyStatus } from '../../lib/errors';

export interface StreamHandlers {
  onText?(delta: string): void;
  onThinking?(delta: string): void;
  /** 收到第一个非空工具调用分片时回调（TTFT 用；不参与拼装） */
  onToolCallDelta?(): void;
}

export interface StreamOptions {
  messages: ChatMessage[];
  tools?: AgentTool[];
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /** 是否要 stream_options.include_usage，默认要 */
  includeUsage?: boolean;
  /** 空闲超时毫秒；默认 45s */
  idleTimeoutMs?: number;
}

export interface StreamResult {
  text: string;
  thinking: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export function completionsUrl(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}

export function toolSchemas(tools: AgentTool[]): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

export function describeHttpError(status: number, statusText: string, body?: string): string {
  const detail = (body ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const suffix = detail ? `：${detail}` : '';
  switch (status) {
    case 401:
    case 403:
      return `API Key 无效或没有权限（${status}）${suffix}`;
    case 404:
      return `接口或模型不存在（404）。检查 Base URL 是否要带 /v1，模型名是否写错${suffix}`;
    case 429:
      return `请求太频繁或额度不足（429）${suffix}`;
    default:
      if (status >= 500) return `模型服务异常（${status} ${statusText}）${suffix}`;
      if (status === 0) return `连不上模型服务（网络或 Base URL 不对）${suffix}`;
      return `模型调用失败（${status} ${statusText}）${suffix}`;
  }
}

interface PartialToolCall {
  id: string;
  name: string;
  args: string;
}

export async function streamChat(
  config: LightModelConfig,
  options: StreamOptions,
  handlers: StreamHandlers = {},
): Promise<StreamResult> {
  if (!config.baseURL.trim()) throw new Error('没有配置 Base URL');
  if (!config.model.trim()) throw new Error('没有配置模型名');

  const body: Record<string, unknown> = {
    model: config.model,
    messages: options.messages,
    stream: true,
  };
  if (options.tools && options.tools.length > 0) {
    body.tools = toolSchemas(options.tools);
    body.tool_choice = 'auto';
  }
  if (typeof options.temperature === 'number') body.temperature = options.temperature;
  if (typeof options.maxTokens === 'number') body.max_tokens = options.maxTokens;
  if (options.includeUsage !== false) body.stream_options = { include_usage: true };

  let text = '';
  let thinking = '';
  let finishReason: string | undefined;
  let usage: StreamResult['usage'];
  const partials = new Map<number, PartialToolCall>();
  let toolCallSeen = false;

  let buffer = '';

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload) return;
    if (payload === '[DONE]') return;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }

    if (json.usage && typeof json.usage === 'object') {
      const u = json.usage as { prompt_tokens?: number; completion_tokens?: number };
      usage = {
        ...(typeof u.prompt_tokens === 'number' ? { inputTokens: u.prompt_tokens } : {}),
        ...(typeof u.completion_tokens === 'number' ? { outputTokens: u.completion_tokens } : {}),
      };
    }

    const choices = Array.isArray(json.choices) ? json.choices : [];
    const choice = choices[0] as
      | {
          delta?: Record<string, unknown>;
          finish_reason?: string;
        }
      | undefined;
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;

    const delta = choice.delta ?? {};
    const content = delta.content;
    if (typeof content === 'string' && content.length > 0) {
      text += content;
      handlers.onText?.(content);
    }
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      thinking += reasoning;
      handlers.onThinking?.(reasoning);
    }

    const toolCalls = delta.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const raw of toolCalls as Array<Record<string, unknown>>) {
        const index = typeof raw.index === 'number' ? raw.index : 0;
        const current = partials.get(index) ?? { id: '', name: '', args: '' };
        if (typeof raw.id === 'string' && raw.id) current.id = raw.id;
        const fn = raw.function as { name?: unknown; arguments?: unknown } | undefined;
        if (fn) {
          if (typeof fn.name === 'string' && fn.name) current.name = fn.name;
          if (typeof fn.arguments === 'string' && fn.arguments) current.args += fn.arguments;
        }
        partials.set(index, current);
        // 第一个非空工具分片也算首包，ttft 不能只统计正文
        const nonEmpty =
          (typeof raw.id === 'string' && raw.id.length > 0) ||
          (typeof fn?.name === 'string' && fn.name.length > 0) ||
          (typeof fn?.arguments === 'string' && fn.arguments.length > 0);
        if (nonEmpty && !toolCallSeen) {
          toolCallSeen = true;
          handlers.onToolCallDelta?.();
        }
      }
    }
  };

  const onData = (chunk: string): void => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      handleLine(line);
      newline = buffer.indexOf('\n');
    }
  };

  const http = await postSse({
    url: completionsUrl(config.baseURL),
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    onData,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.idleTimeoutMs ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
  });

  if (http.status < 200 || http.status >= 300) {
    if (http.status === 0 && options.signal?.aborted) {
      throw new LightRequestError('canceled', LIGHT_ERROR_HINTS.canceled);
    }
    const kind = classifyStatus(http.status);
    if (kind) {
      throw new LightRequestError(kind, describeHttpError(http.status, http.statusText, http.errorText), http.status);
    }
    throw new LightRequestError('offline', LIGHT_ERROR_HINTS.offline);
  }

  // 收尾：最后一行可能没有换行
  if (buffer.trim().length > 0) handleLine(buffer);
  if (options.signal?.aborted) throw new LightRequestError('canceled', LIGHT_ERROR_HINTS.canceled);
  if (!text && !thinking && partials.size === 0) {
    // 常见于 Base URL 指错（返回了 200 但内容是 HTML/空）、或服务端没实现 stream
    throw new LightRequestError('empty', LIGHT_ERROR_HINTS.empty);
  }

  const toolCalls: ToolCall[] = [...partials.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, partial], i) => ({
      id: partial.id || `call_${index}_${i}`,
      type: 'function' as const,
      function: { name: partial.name, arguments: partial.args || '{}' },
    }))
    .filter((call) => call.function.name.length > 0);

  return {
    text,
    thinking,
    toolCalls,
    ...(finishReason ? { finishReason } : {}),
    ...(usage ? { usage } : {}),
  };
}
