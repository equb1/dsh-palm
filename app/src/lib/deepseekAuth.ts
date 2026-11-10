/**
 * DeepSeek 账号登录（轻引擎也能用）。
 *
 * 直接走 platform.deepseek.com 的 dsh PKCE 接口，和 dsh 宿主是同一套：
 *   auth_init → 内置浏览器授权 → 回调带 code → auth_exchange 换 token
 *
 * 回调地址用 loopback（平台只接受 loopback），但不需要真的起 HTTP 服务：
 * 内置 WebView 在 onShouldStartLoadWithRequest 里拦截这个前缀就能拿到 code。
 */
/**
 * 只在真正登录时才加载 expo-crypto。
 * 同步 import 会把 Expo runtime 带进 Node 测试（__DEV__ 未定义），
 * 而 store 会被很多单测直接 import。
 */
type CryptoModule = typeof import('expo-crypto');
let cryptoModule: CryptoModule | null = null;
async function getCrypto(): Promise<CryptoModule> {
  if (!cryptoModule) cryptoModule = await import('expo-crypto');
  return cryptoModule;
}

const PLATFORM_ORIGIN = 'https://platform.deepseek.com';
const API = `${PLATFORM_ORIGIN}/auth-api/v0/dsh`;

/** 回调前缀：只用于 WebView 拦截，不会有真实服务器监听 */
export const DEEPSEEK_REDIRECT_URI = 'http://127.0.0.1:8787/oauth/callback';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64[b2 & 63];
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function clientHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    // 平台 WAF 会拦 okhttp 默认 UA（直接 429）；用浏览器 UA 才能过
    'user-agent':
      'Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
    'x-client-bundle-id': '',
    'x-client-platform': 'web',
    'x-client-version': '0.1.0',
    'x-client-locale': 'zh_CN',
    'x-client-timezone-offset': String(-new Date().getTimezoneOffset() * 60),
  };
}

interface Envelope<T> {
  code?: number;
  msg?: string;
  data?: { biz_code?: number; biz_msg?: string; biz_data?: T };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(`${API}/${path}`, {
      method: 'POST',
      headers: clientHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new Error(aborted ? '连不上 DeepSeek 登录服务（超时）' : '连不上 DeepSeek 登录服务，检查网络后重试');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`DeepSeek 登录服务返回 HTTP ${res.status}`);
  const json = (await res.json()) as Envelope<T>;
  const bizCode = json.data?.biz_code ?? -1;
  if (json.code !== 0 || bizCode !== 0) {
    throw new Error(json.data?.biz_msg || json.msg || 'DeepSeek 登录服务返回异常');
  }
  return json.data?.biz_data as T;
}

export interface DeepseekAuthAttempt {
  authorizeUrl: string;
  authorizeId: string;
  verifier: string;
  state: string;
  redirectUri: string;
  expiresAt: number;
}

interface AuthInitResult {
  authorize_url: string;
  authorize_id: string;
  expires_in: number;
}

interface AuthExchangeResult {
  token: string;
  authorized_url: string;
}

/** 开始登录：生成 PKCE，向平台申请授权页地址 */
export async function startDeepseekAuth(): Promise<DeepseekAuthAttempt> {
  const Crypto = await getCrypto();
  const verifier = base64Url(Crypto.getRandomBytes(32));
  const state = base64Url(Crypto.getRandomBytes(32));
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier);
  const challenge = base64Url(hexToBytes(digest));
  const init = await postJson<AuthInitResult>('auth_init', {
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    redirect_uri: DEEPSEEK_REDIRECT_URI,
    locale: 'zh_CN',
    login_source: 'web',
  });
  return {
    authorizeUrl: init.authorize_url,
    authorizeId: init.authorize_id,
    verifier,
    state,
    redirectUri: DEEPSEEK_REDIRECT_URI,
    expiresAt: Date.now() + init.expires_in * 1000,
  };
}

/** 用回调里的 code 换账号 token */
export async function exchangeDeepseekCode(
  attempt: DeepseekAuthAttempt,
  code: string,
): Promise<{ token: string }> {
  const { Platform } = await import('react-native');
  const result = await postJson<AuthExchangeResult>('auth_exchange', {
    code,
    code_verifier: attempt.verifier,
    redirect_uri: attempt.redirectUri,
    device_id: (await getDeviceId()) ?? '00000000-0000-4000-8000-000000000000',
    device_model: `${Platform.OS}-${Platform.Version ?? ''}`,
    os_version: `${Platform.OS} ${Platform.Version ?? ''}`,
  });
  if (!result.token) throw new Error('DeepSeek 登录没有返回 token');
  return { token: result.token };
}

/** 本机安装 id：exchange 要求带上，随机生成一次后固定 */
async function getDeviceId(): Promise<string | null> {
  const { loadDeepseekDeviceId, saveDeepseekDeviceId } = await import('./accountToken');
  const existing = await loadDeepseekDeviceId();
  if (existing) return existing;
  const Crypto = await getCrypto();
  const id = Crypto.randomUUID();
  await saveDeepseekDeviceId(id);
  return id;
}

/** 从回调 URL 里取 code / state（不依赖 URL 类的完整实现） */
export function parseAuthCallback(url: string): { code: string | null; state: string | null; error: string | null } {
  const query = url.split('?')[1] ?? '';
  const params = new Map<string, string>();
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const index = pair.indexOf('=');
    const key = decodeURIComponent(index >= 0 ? pair.slice(0, index) : pair);
    const value = decodeURIComponent(index >= 0 ? pair.slice(index + 1) : '');
    params.set(key, value);
  }
  return {
    code: params.get('code') ?? null,
    state: params.get('state') ?? null,
    error: params.get('error') ?? params.get('error_description') ?? null,
  };
}
