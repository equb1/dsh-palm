/**
 * SSE 传输的平台无关部分。
 *
 * `transport.ts`（Node/web，fetch + ReadableStream）与 `transport.native.ts`
 * （Android/iOS，XMLHttpRequest 增量 responseText）共用这里的常量与类型。
 *
 * 注意：native 文件**不能**从 './transport' 取这些共享项——Metro 在原生平台
 * 会把 './transport' 解析成 transport.native.ts 自己，形成 self require cycle
 * （真机上表现为 LogBox 的 "Require cycle" 警告）。所以单独放这个文件。
 */
/**
 * 空闲超时：推理模型在长思考/长输出前可能几十秒没有新分片。
 * 45s 在真机上会把正常的长报告误判成网络错误，这里放宽到 120s；
 * 真正断网仍由 XHR 的 onerror 立即结束。
 */
export const SSE_IDLE_TIMEOUT_MS = 120_000;

export interface SseRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
  /** 空闲超时；默认 45s（测试可调小） */
  idleTimeoutMs?: number;
  onData(chunk: string): void;
}

export interface SseHttpResult {
  status: number;
  statusText: string;
  /** 非 2xx 时的响应体，用来给用户解释（401 / 404 / 429…） */
  errorText?: string;
}
