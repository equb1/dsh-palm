/**
 * SSE 传输（Node / web）：fetch + ReadableStream 增量读。
 *
 * 手机上的实现见 `transport.native.ts`：React Native 的 fetch 拿不到
 * 流式 response.body，必须退回 XMLHttpRequest 的增量 responseText。
 * provider 只依赖这里导出的 `postSse`，不关心底层。
 *
 * 空闲超时（P0 1.5）：从请求开始计时，每收到一个 chunk 就重置；默认 45s。
 * 超时/断网/取消都抛 `LightRequestError`，让上层日志和横幅能拿到分类。
 */
import {
  LIGHT_ERROR_HINTS,
  LightRequestError,
  isOffline,
  lightTimeoutMessage,
} from '../../lib/errors';
import { SSE_IDLE_TIMEOUT_MS, type SseHttpResult, type SseRequest } from './transport.shared';

export { SSE_IDLE_TIMEOUT_MS } from './transport.shared';
export type { SseHttpResult, SseRequest } from './transport.shared';

export class StreamAbortedError extends LightRequestError {
  constructor(message = LIGHT_ERROR_HINTS.canceled) {
    super('canceled', message);
    this.name = 'StreamAbortedError';
  }
}

function offlineError(error: unknown): LightRequestError {
  if (isOffline()) return new LightRequestError('offline', LIGHT_ERROR_HINTS.offline);
  const detail = error instanceof Error ? error.message : String(error);
  return new LightRequestError(
    'offline',
    `连不上模型服务（${detail.slice(0, 120)}）：检查手机网络和 Base URL，确认服务在跑。`,
  );
}

export async function postSse(request: SseRequest): Promise<SseHttpResult> {
  const idleMs = request.idleTimeoutMs ?? SSE_IDLE_TIMEOUT_MS;
  if (request.signal?.aborted) throw new StreamAbortedError();

  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const arm = (): void => {
    clearTimer();
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, idleMs);
  };
  const onAbort = (): void => controller.abort();
  request.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    arm();
    const response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    } as unknown as RequestInit);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return { status: response.status, statusText: response.statusText, errorText };
    }

    if (!response.body) {
      throw new LightRequestError(
        'bad_request',
        '当前宿主不支持流式响应体（response.body 为空）：换用原生构建，或让服务端支持 stream。',
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        arm();
        const { done, value } = await reader.read();
        arm();
        if (done) break;
        if (value) request.onData(decoder.decode(value, { stream: true }));
      }
      request.onData(decoder.decode());
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // 已经结束的流，忽略
      }
    }

    return { status: response.status, statusText: response.statusText };
  } catch (error) {
    if (error instanceof LightRequestError) throw error;
    if (request.signal?.aborted) throw new StreamAbortedError();
    if (timedOut) throw new LightRequestError('timeout', lightTimeoutMessage(idleMs));
    throw offlineError(error);
  } finally {
    clearTimer();
    request.signal?.removeEventListener('abort', onAbort);
  }
}
