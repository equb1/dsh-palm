/**
 * SSE 传输（Android / iOS）：XMLHttpRequest + 增量 responseText。
 *
 * 为什么不用 fetch：React Native 的 fetch 会把响应体收完再交给 JS，
 * `response.body` 不可用，流式就没了。XHR 在 RN 上支持 readyState 3 /
 * onprogress 的增量文本，是手机端唯一不引原生依赖的做法。
 *
 * 空闲超时：默认 45s，每收到一段 progress 就重置（JS 定时器）。`xhr.timeout`
 * 先设成同一个值兜住“连上但一直没数据”；收到首个分片后关掉它，避免长回答
 * 被总时长误杀，后续交给可重置的空闲定时器。
 */
import {
  LIGHT_ERROR_HINTS,
  LightRequestError,
  isOffline,
  lightTimeoutMessage,
} from '../../lib/errors';
import { SSE_IDLE_TIMEOUT_MS, type SseHttpResult, type SseRequest } from './transport';

function offlineError(): LightRequestError {
  return isOffline()
    ? new LightRequestError('offline', LIGHT_ERROR_HINTS.offline)
    : new LightRequestError(
        'offline',
        '连不上模型服务（网络错误）：检查手机网络和 Base URL，确认服务在跑。',
      );
}

export async function postSse(request: SseRequest): Promise<SseHttpResult> {
  const idleMs = request.idleTimeoutMs ?? SSE_IDLE_TIMEOUT_MS;
  if (request.signal?.aborted) throw new LightRequestError('canceled', LIGHT_ERROR_HINTS.canceled);

  return new Promise<SseHttpResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let delivered = 0;
    let settled = false;
    let timedOut = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const clearIdle = (): void => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    };
    const onAbort = (): void => {
      xhr.abort();
    };
    const cleanup = (): void => {
      clearIdle();
      request.signal?.removeEventListener('abort', onAbort);
    };
    const finishResolve = (result: SseHttpResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const finishReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const arm = (): void => {
      clearIdle();
      idleTimer = setTimeout(() => {
        timedOut = true;
        // onabort 看到 timedOut 不会把它当用户取消
        xhr.abort();
        finishReject(new LightRequestError('timeout', lightTimeoutMessage(idleMs)));
      }, idleMs);
    };

    const emitNew = (): void => {
      const text = xhr.responseText ?? '';
      if (text.length > delivered) {
        request.onData(text.slice(delivered));
        delivered = text.length;
      }
    };

    xhr.open('POST', request.url, true);
    for (const [key, value] of Object.entries(request.headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.setRequestHeader('Accept', 'text/event-stream');
    // 先兜住“一个字节都没来”的情况；首个分片后改用可重置的 JS 定时器
    xhr.timeout = idleMs;

    xhr.onprogress = () => {
      try {
        xhr.timeout = 0;
      } catch {
        // 某些 RN/ROM 不允许中途改 timeout，忽略即可
      }
      emitNew();
      arm();
    };
    xhr.onload = () => {
      emitNew();
      if (xhr.status >= 200 && xhr.status < 300) {
        finishResolve({ status: xhr.status, statusText: xhr.statusText });
      } else {
        finishResolve({
          status: xhr.status || 0,
          statusText: xhr.statusText,
          errorText: xhr.responseText ?? '',
        });
      }
    };
    xhr.onerror = () => finishReject(offlineError());
    xhr.ontimeout = () => {
      timedOut = true;
      finishReject(new LightRequestError('timeout', lightTimeoutMessage(idleMs)));
    };
    xhr.onabort = () => {
      if (timedOut) return;
      // 用户取消：provider 会看 signal，所以这里只要把控制权交回去
      finishResolve({ status: 0, statusText: 'aborted' });
    };

    if (request.signal) {
      if (request.signal.aborted) {
        finishReject(new LightRequestError('canceled', LIGHT_ERROR_HINTS.canceled));
        return;
      }
      request.signal.addEventListener('abort', onAbort, { once: true });
    }

    arm();
    try {
      xhr.send(request.body);
    } catch (error) {
      finishReject(
        error instanceof Error
          ? new LightRequestError('offline', `发送模型请求失败：${error.message}`)
          : new LightRequestError('offline', String(error)),
      );
    }
  });
}
