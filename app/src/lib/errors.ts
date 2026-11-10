/**
 * 把协议层 / 轻引擎的原始错误翻成人话。
 *
 * 真 dsh 的错误长这样：`session/create -> gateway/invocation-unavailable | no active Remote
 * method exports this endpoint`；直接扔给用户等于没提示。这里按最常见的几类压成一句
 * 「发生了什么 + 怎么办」，识别不了才原样截断。
 *
 * 轻引擎（fetch / SSE）还会带结构化分类：`LightRequestError.kind`。分类用于
 * `[light] error kind=… status=…` 日志和 ChatScreen 的错误横幅，避免 401/429/断网
 * 最后只剩一句“出错”。错误消息本身若已经是中文（工具/渠道给的人话），原样透传。
 */

/** 轻引擎模型调用的错误分类（日志 / 横幅共用） */
export type LightErrorKind =
  | 'canceled'
  | 'timeout'
  | 'offline'
  | 'unauthorized'
  | 'rate_limited'
  | 'not_found'
  | 'bad_request'
  | 'server'
  | 'empty';

/** 每一类给一句中文建议；`humanizeError` 识别到分类时直接用它 */
export const LIGHT_ERROR_HINTS: Record<LightErrorKind, string> = {
  canceled: '请求已取消。',
  timeout: '模型服务超时：网络可能不稳或服务卡住了；稍后重试，或换一个 Base URL。',
  offline: '连不上网络或模型服务：检查手机网络 / Wi-Fi，确认 Base URL 能在浏览器里打开。',
  unauthorized: 'API Key 无效或没有权限（401/403）：检查 Key、Base URL 和模型权限。',
  rate_limited: '请求太频繁或额度不足（429）：等一会儿再试，或检查账户余额。',
  not_found: '接口或模型不存在（404）：检查 Base URL 是否要带 /v1，模型名是否写错。',
  bad_request:
    '请求被拒绝（400/422）：检查模型名和参数；若渠道不支持 response_format，可在生图设置里改成“自动”。',
  server: '模型服务异常（5xx）：稍后重试；持续失败就换一个渠道。',
  empty: '模型没有返回任何内容：检查 Base URL / 模型名，或该服务是否支持 stream。',
};

const CHINESE = /[\u3400-\u9fff]/;

/** 已经有人话的消息（中文）直接透传，不再按英文关键字猜 */
export function hasChinese(text: string): boolean {
  return CHINESE.test(text);
}

/** 结构化的轻引擎错误：kind 用于日志与横幅，message 已经是中文 */
export class LightRequestError extends Error {
  readonly kind: LightErrorKind;
  readonly status?: number;

  constructor(kind: LightErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'LightRequestError';
    this.kind = kind;
    if (typeof status === 'number') this.status = status;
  }
}

/** 按 HTTP 状态码分类；2xx / 未知返回 null */
export function classifyStatus(status: number): LightErrorKind | null {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 422) return 'bad_request';
  if (status === 0) return 'offline';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return null;
}

/** 网络是否已被系统标记为断开（web / RN 都有 navigator.onLine） */
export function isOffline(): boolean {
  try {
    const online = (navigator as unknown as { onLine?: boolean }).onLine;
    return online === false;
  } catch {
    return false;
  }
}

/** 超时消息带秒数，方便和日志里的设置对上 */
export function lightTimeoutMessage(idleMs: number): string {
  const seconds = Math.max(1, Math.round(idleMs / 1000));
  return `模型服务 ${seconds} 秒没有新响应：网络可能不稳或服务卡住了；稍后重试，或换一个 Base URL。`;
}

/** 从错误对象/消息里尽量恢复分类 */
export function errorKindOf(error: unknown): LightErrorKind | null {
  if (error instanceof LightRequestError) return error.kind;
  const raw = error instanceof Error ? error.message : String(error);
  const m = raw.toLowerCase();
  if (m.includes('已取消') || m.includes('aborted') || m.includes('abort')) return 'canceled';
  if (m.includes('超时') || m.includes('timeout') || m.includes('timed out')) return 'timeout';
  if (
    m.includes('offline') ||
    m.includes('断网') ||
    m.includes('网络') ||
    m.includes('econnrefused') ||
    m.includes('econnreset') ||
    m.includes('eai_again') ||
    m.includes('enotfound') ||
    m.includes('failed to fetch') ||
    m.includes('network request failed')
  ) {
    return 'offline';
  }
  if (m.includes('401') || m.includes('403') || m.includes('unauthorized') || m.includes('api key')) {
    return 'unauthorized';
  }
  if (m.includes('429') || m.includes('rate limit') || m.includes('too many requests')) return 'rate_limited';
  if (m.includes('404') || m.includes('not found')) return 'not_found';
  if (m.includes('400') || m.includes('422') || m.includes('bad request')) return 'bad_request';
  if (/\b5\d\d\b/.test(m) || m.includes('server error')) return 'server';
  if (m.includes('没有返回任何内容') || m.includes('空响应') || m.includes('empty')) return 'empty';
  return null;
}

/** 错误对象里的 HTTP 状态（LightRequestError 才有） */
export function errorStatusOf(error: unknown): number | undefined {
  return error instanceof LightRequestError ? error.status : undefined;
}

export function humanizeError(err: unknown): string {
  // 结构化错误的消息已经是中文建议，直接给用户；日志里另有 kind/status
  if (err instanceof LightRequestError) return err.message;
  const raw = err instanceof Error ? err.message : String(err);

  // 没登录 / 没配 Key 时上游会把整段 gateway 错误吐出来；先收成一句人话
  const lowerRaw = raw.toLowerCase();
  if (
    lowerRaw.includes('missing_credential')
    || lowerRaw.includes('missing-credential')
    || lowerRaw.includes('missing credential')
    || lowerRaw.includes('credential-not-found')
    || lowerRaw.includes('no routable provider')
    || lowerRaw.includes('provider_not_configured')
    || lowerRaw.includes('apikey not configured')
    || lowerRaw.includes('api key not configured')
  ) {
    return '当前引擎还没有可用的模型凭据：登录 DeepSeek 账号，或在「设置 → 模型提供商 / API Key」配置渠道后再发送。';
  }

  // 轻引擎/工具已经给了中文人话：原样透传，不要按英文关键字二次翻译
  if (hasChinese(raw)) {
    const text = raw.trim();
    return text.length > 240 ? `${text.slice(0, 240)}…` : text;
  }

  const m = raw.toLowerCase();

  if (m.includes('no active remote method') || m.includes('invocation-unavailable')) {
    return '这个宿主版本不支持该操作。把宿主上的 dsh 升级一下，或换一种方式。';
  }
  if (m.includes('需要配对码') || m.includes('4001')) {
    return '配对码不对或已过期：重新输入宿主打印的六位码。';
  }
  if (m.includes('econnrefused') || m.includes('连接失败') || m.includes('econnreset')) {
    return '连不上宿主：确认引擎在跑、地址正确，或重新配对。';
  }
  if (m.includes('model-discovery') || (m.includes('401') && m.includes('api key'))) {
    return '服务商拒绝了请求：检查 Base URL 和 API Key 是否有效。';
  }
  if (m.includes('eai_again') || m.includes('enotfound')) {
    return '域名解析失败：检查手机网络，或换个 DNS。';
  }
  if (m.includes('eacces') && m.includes('session')) {
    return '会话写盘失败：引擎的 Android 兼容补丁可能没生效（见设置里的日志）。';
  }
  if (m.includes('timeout') || m.includes('timed out')) {
    return '请求超时了，稍等再试。';
  }
  if (m.includes('401')) return '宿主拒绝了请求（401）：可能需要重新登录或配对。';
  if (m.includes('429') || m.includes('rate limit')) return '请求太频繁被限流了，过一会儿再试。';
  if (isOffline()) return LIGHT_ERROR_HINTS.offline;

  // 英文但能归类的轻引擎错误：给分类建议
  const kind = errorKindOf(raw);
  if (kind) return LIGHT_ERROR_HINTS[kind];

  return raw.length > 180 ? raw.slice(0, 180) + '…' : raw;
}
