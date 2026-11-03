/**
 * SSE 传输（Node / web）：fetch + ReadableStream 增量读。
 *
 * 手机上的实现见 `transport.native.ts`：React Native 的 fetch 拿不到
 * 流式 response.body，必须退回 XMLHttpRequest 的增量 responseText。
 * provider 只依赖这里导出的 `postSse`，不关心底层。
 */
export interface SseRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
  onData(chunk: string): void;
}

export interface SseHttpResult {
  status: number;
  statusText: string;
  /** 非 2xx 时的响应体，用来给用户解释（401 / 404 / 429…） */
  errorText?: string;
}

export class StreamAbortedError extends Error {
  constructor(message = '请求已取消') {
    super(message);
    this.name = 'StreamAbortedError';
  }
}

export async function postSse(request: SseRequest): Promise<SseHttpResult> {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    ...(request.signal ? { signal: request.signal } : {}),
  } as unknown as RequestInit);

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    return { status: response.status, statusText: response.statusText, errorText };
  }

  if (!response.body) {
    throw new Error('当前宿主不支持流式响应体（response.body 为空）');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) request.onData(decoder.decode(value, { stream: true }));
    }
    request.onData(decoder.decode());
  } catch (error) {
    if (request.signal?.aborted) throw new StreamAbortedError();
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // 已经结束的流，忽略
    }
  }

  return { status: response.status, statusText: response.statusText };
}
