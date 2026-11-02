/**
 * SSE 传输（Android / iOS）：XMLHttpRequest + 增量 responseText。
 *
 * 为什么不用 fetch：React Native 的 fetch 会把响应体收完再交给 JS，
 * `response.body` 不可用，流式就没了。XHR 在 RN 上支持 readyState 3 /
 * onprogress 的增量文本，是手机端唯一不引原生依赖的做法。
 */
import type { SseHttpResult, SseRequest } from './transport';

export async function postSse(request: SseRequest): Promise<SseHttpResult> {
  return new Promise<SseHttpResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let delivered = 0;

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

    xhr.onprogress = emitNew;
    xhr.onload = () => {
      emitNew();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ status: xhr.status, statusText: xhr.statusText });
      } else {
        resolve({ status: xhr.status || 0, statusText: xhr.statusText, errorText: xhr.responseText ?? '' });
      }
    };
    xhr.onerror = () => reject(new Error('网络错误：连不上模型服务'));
    xhr.ontimeout = () => reject(new Error('模型服务超时'));
    // 用户取消：provider 会看 signal，所以这里只要把控制权交回去
    xhr.onabort = () => resolve({ status: 0, statusText: 'aborted' });

    if (request.signal) {
      if (request.signal.aborted) {
        reject(new Error('已取消'));
        return;
      }
      request.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    try {
      xhr.send(request.body);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
