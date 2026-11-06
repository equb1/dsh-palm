/**
 * 官方 dsh web 前端的本机入口（M2.1，纯函数，Node 可测）。
 *
 * 安全边界：
 * - token 只允许在「桥的客户端是本机 loopback」且「上游 dsh 也是 loopback」时下发；
 * - 这里不做任何日志输出，调用方也不要把 token 打进日志；
 * - WebView 里点会话时，官方前端把当前会话写在 localStorage `dsh.sessions.current`，
 *   我们注入的观察器会把它发回 RN，但不能把初始恢复误判成用户点击。
 */
import type { ProtocolError } from '../protocol';

export const WEB_SESSION_STORAGE_KEY = 'dsh.sessions.current';

export interface WebFrontendEndpoint {
  /** 带 token 的官方前端入口（token 在 query 里） */
  url: string;
  /** 官方前端 origin（不含 token），展示/校验用 */
  origin: string;
  /** 引擎启动 token；只在 loopback/本机下发 */
  token: string;
  local: true;
}

export interface WebFrontendTarget extends WebFrontendEndpoint {
  /** 可选：打开后要定位到的完整引擎会话 id */
  sessionId?: string;
  /** 降级说明（例如当前是轻引擎会话，只能打开官方前端首页） */
  note?: string;
}

export interface WebSessionDeepLink {
  kind: 'web-session';
  sessionId: string;
  engine: 'full' | 'light';
}

export type WebViewBridgeMessage =
  | { type: 'web-session'; sessionId: string }
  | { type: 'web-deeplink'; url: string }
  | { type: 'bridge-ready' };

export class WebFrontendError extends Error {
  readonly code: Extract<ProtocolError['code'], 'unsupported' | 'bad_request'>;
  readonly hint?: string;

  constructor(
    code: Extract<ProtocolError['code'], 'unsupported' | 'bad_request'>,
    message: string,
    hint?: string,
  ) {
    super(message);
    this.name = 'WebFrontendError';
    this.code = code;
    if (hint) this.hint = hint;
  }
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
}

/** `localhost` / `127.0.0.0/8` / `::1` 才算本机 */
export function isLoopbackHost(host: string): boolean {
  const value = normalizeHost(host);
  if (value === 'localhost' || value === '::1' || value === '0:0:0:0:0:0:0:1') return true;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== '127') return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** WebSocket 的 remoteAddress 可能是 `::ffff:127.0.0.1` 或带 zone id */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  let value = address.trim().toLowerCase();
  if (value.startsWith('::ffff:')) value = value.slice('::ffff:'.length);
  const zone = value.indexOf('%');
  if (zone >= 0) value = value.slice(0, zone);
  return isLoopbackHost(value);
}

/**
 * 构造官方前端入口。
 * 远程宿主（非 loopback）明确抛 unsupported，不返回一个「看起来能开」的远程 token。
 */
export function buildWebFrontendEndpoint(baseUrl: string, token: string): WebFrontendEndpoint {
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new WebFrontendError('bad_request', '引擎还没打印 Web token，官方前端暂时打不开');
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new WebFrontendError('unsupported', '引擎地址无效，打不开官方 Web 前端');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebFrontendError('unsupported', '官方 Web 前端只支持 http/https 地址');
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new WebFrontendError(
      'unsupported',
      '官方 Web 入口只在本机 loopback 提供；远程宿主请直接在电脑浏览器里打开',
      '手机 App 不接收远程宿主的 Web token。要在这里打开，请切换到本机完整引擎。',
    );
  }

  const path = parsed.pathname === '' ? '/' : parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
  const origin = `${parsed.protocol}//${parsed.host}`;
  const query = new URLSearchParams({ token: cleanToken }).toString();

  return {
    url: `${origin}${path}?${query}`,
    origin,
    token: cleanToken,
    local: true,
  };
}

/** 会话 id 只接受 URL/JSON 里安全的字符，避免注入到 localStorage 或深链 */
export function normalizeWebSessionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  if (!id || id.length > 256) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(id)) return null;
  return id;
}

function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * WebView 启动前注入：定位当前会话 + 安装「会话变化 / dshpalm 深链」观察器。
 * `sessionId` 为空时只观察，不改官方前端已保存的选择。
 */
export function buildWebSessionBootstrap(sessionId?: string | null): string {
  const target = normalizeWebSessionId(sessionId);
  const targetLiteral = target ? jsString(target) : 'null';
  return `(function(){
  var KEY = ${jsString(WEB_SESSION_STORAGE_KEY)};
  var target = ${targetLiteral};
  function read() {
    try {
      var value = JSON.parse(localStorage.getItem(KEY) || 'null');
      return value && typeof value.sessionId === 'string' ? value.sessionId : null;
    } catch (e) { return null; }
  }
  function send(payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    } catch (e) {}
  }
  if (window.__dshPalmWebBridge) {
    window.__dshPalmWebBridge.setTarget(target);
    window.__dshPalmWebBridge.start();
    return;
  }
  var last = null;
  var timer = null;
  var enabled = false;
  var interacted = false;
  if (target) {
    try { localStorage.setItem(KEY, JSON.stringify({ sessionId: target })); } catch (e) {}
    last = target;
  } else {
    last = read();
  }
  function scan() {
    if (!enabled || !interacted) return;
    var id = read();
    if (!id || id === last) return;
    last = id;
    send({ type: 'web-session', sessionId: id });
  }
  function start() {
    enabled = true;
    if (timer === null) timer = setInterval(scan, 1500);
  }
  function stop() {
    enabled = false;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }
  function setTarget(id) {
    target = typeof id === 'string' && id ? id : null;
    if (target) {
      try { localStorage.setItem(KEY, JSON.stringify({ sessionId: target })); } catch (e) {}
      last = target;
    }
  }
  try {
    var original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      var result = original.apply(this, arguments);
      if (key === KEY) scan();
      return result;
    };
  } catch (e) {}
  document.addEventListener('pointerdown', function(){ interacted = true; }, true);
  document.addEventListener('keydown', function(){ interacted = true; }, true);
  document.addEventListener('click', function(event){
    var node = event.target;
    while (node && node !== document && !(node.getAttribute && node.getAttribute('href'))) node = node.parentNode;
    if (!node || node === document || !node.getAttribute) return;
    var href = String(node.getAttribute('href') || '');
    if (href.indexOf('dshpalm://') === 0) {
      event.preventDefault();
      send({ type: 'web-deeplink', url: href });
    }
  }, true);
  window.__dshPalmWebBridge = { start: start, stop: stop, scan: scan, setTarget: setTarget };
  start();
  send({ type: 'bridge-ready' });
})();true;`;
}

/** 页面隐藏/显示时启停 WebView 内的观察器；不要在隐藏期间继续轮询 */
export function buildWebBridgeControlScript(action: 'start' | 'stop'): string {
  return `(function(){try{var b=window.__dshPalmWebBridge;if(b)b.${action}();}catch(e){}})();true;`;
}

function sessionIdFromUrl(url: URL, allowGenericId: boolean): string | null {
  const query =
    url.searchParams.get('sessionId') ??
    url.searchParams.get('session') ??
    (allowGenericId ? url.searchParams.get('id') : null);
  const fromQuery = normalizeWebSessionId(query);
  if (fromQuery) return fromQuery;

  const path = url.pathname.replace(/^\/+/, '');
  const match = /^(?:session|sessions|s)\/([^/]+)\/?$/i.exec(path);
  if (!match?.[1]) return null;
  try {
    return normalizeWebSessionId(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function parseEngine(raw: string | null): 'full' | 'light' | null {
  if (raw === null || raw.trim() === '') return 'full';
  const value = raw.trim().toLowerCase();
  if (value === 'full' || value === 'light') return value;
  return null;
}

/** `dshpalm://session?id=…` / `dshpalm://session/<id>?engine=light` */
export function parseWebSessionDeepLink(raw: string | null | undefined): WebSessionDeepLink | null {
  if (!raw || !raw.trim().toLowerCase().startsWith('dshpalm://')) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'dshpalm:') return null;
  const host = url.hostname.toLowerCase();
  if (host !== 'session' && host !== 'chat' && host !== 'open') return null;
  const barePath = url.pathname.replace(/^\/+|\/+$/g, '');
  let pathId: string | null = null;
  if (barePath && !barePath.includes('/')) {
    try {
      pathId = normalizeWebSessionId(decodeURIComponent(barePath));
    } catch {
      pathId = null;
    }
  }
  const sessionId = sessionIdFromUrl(url, true) ?? pathId;
  const engine = parseEngine(url.searchParams.get('engine'));
  if (!sessionId || !engine) return null;
  return { kind: 'web-session', sessionId, engine };
}

/**
 * 官方 Web 页面自己的 loopback 深链（供 onShouldStartLoadWithRequest 拦截）。
 * 只认显式的 sessionId / /session/<id>，普通页面导航原样放行。
 */
export function parseLoopbackWebSessionLink(raw: string | null | undefined): WebSessionDeepLink | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!isLoopbackHost(url.hostname)) return null;
  const sessionId = sessionIdFromUrl(url, false);
  if (!sessionId) return null;
  return { kind: 'web-session', sessionId, engine: 'full' };
}

export function parseWebSessionNavigation(raw: string | null | undefined): WebSessionDeepLink | null {
  return parseWebSessionDeepLink(raw) ?? parseLoopbackWebSessionLink(raw);
}

/** WebView postMessage 的防御性解析 */
export function parseWebViewBridgeMessage(raw: unknown): WebViewBridgeMessage | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.type === 'bridge-ready') return { type: 'bridge-ready' };
  if (record.type === 'web-session') {
    const sessionId = normalizeWebSessionId(record.sessionId);
    return sessionId ? { type: 'web-session', sessionId } : null;
  }
  if (record.type === 'web-deeplink') {
    if (typeof record.url !== 'string' || record.url.trim().length === 0) return null;
    return { type: 'web-deeplink', url: record.url.trim() };
  }
  return null;
}

/** token 过期/引擎重启时给用户可执行的说明，而不是只显示 WebView 英文错误 */
export function describeWebViewError(input: { description?: string; statusCode?: number }): string {
  const status = input.statusCode;
  if (status === 401 || status === 403) {
    return '官方前端 token 已失效（引擎可能重启过）：点「重新获取地址」再打开。';
  }
  if (typeof status === 'number' && status >= 500) {
    return `官方前端加载失败（HTTP ${status}）：引擎可能正在重启，点「重新获取地址」再试。`;
  }
  const description = (input.description ?? '').trim();
  const lower = description.toLowerCase();
  if (
    lower.includes('econnrefused') ||
    lower.includes('connection_refused') ||
    lower.includes('connection refused') ||
    lower.includes('failed to connect')
  ) {
    return '连不上本机引擎（连接被拒绝）：确认「本机引擎」运行中，再点「重新获取地址」。';
  }
  if (lower.includes('enotfound') || lower.includes('name_not_resolved') || lower.includes('name not resolved')) {
    return '找不到引擎地址：确认本机引擎还在运行，再重新获取地址。';
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('timed_out')) {
    return '官方前端响应超时：引擎可能正在重启，稍后再点「重新获取地址」。';
  }
  return description ? `加载失败：${description}` : '加载失败：官方前端没有响应。';
}

/* ------------------------------------------------------------------ *
 * 生命周期（纯 reducer，供 WebSurface 和单测共用）
 * ------------------------------------------------------------------ */

export type WebSurfaceStatus = 'loading' | 'ready' | 'error';

export interface WebSurfaceLifecycleState {
  /** 页面可见（App 在前台）时观察器才应该轮询 */
  visible: boolean;
  status: WebSurfaceStatus;
  error: string | null;
  /** 重新加载计数器；用作 WebView 的 key */
  generation: number;
}

export type WebSurfaceLifecycleEvent =
  | { type: 'open' }
  | { type: 'hide' }
  | { type: 'show' }
  | { type: 'loaded' }
  | { type: 'failed'; error: string }
  | { type: 'retry' }
  | { type: 'close' };

export function initialWebSurfaceLifecycle(): WebSurfaceLifecycleState {
  return { visible: true, status: 'loading', error: null, generation: 0 };
}

export function reduceWebSurfaceLifecycle(
  state: WebSurfaceLifecycleState,
  event: WebSurfaceLifecycleEvent,
): WebSurfaceLifecycleState {
  switch (event.type) {
    case 'open':
      return { visible: true, status: 'loading', error: null, generation: state.generation };
    case 'hide':
      return state.visible ? { ...state, visible: false } : state;
    case 'show':
      return state.visible ? state : { ...state, visible: true };
    case 'loaded':
      // 出错后迟到的 onLoadEnd 不能把错误横幅洗掉
      return state.status === 'error' ? state : { ...state, status: 'ready', error: null };
    case 'failed':
      return { ...state, status: 'error', error: event.error };
    case 'retry':
      return { ...state, status: 'loading', error: null, generation: state.generation + 1 };
    case 'close':
      return { ...state, visible: false };
    default:
      return state;
  }
}
