/**
 * 生图：调 OpenAI 兼容的 `POST {base}/images/generations`，把图落到工作区。
 *
 * 支持 `b64_json`（手机端最稳，不用二次下载）和 `url` 两种返回；默认
 * `response_format=auto`（不传），两种都接受。有些网关不认 `response_format`
 * 会回 400/422，这时去掉该字段重试一次。
 *
 * 官方 DeepSeek 账号没有图像模型，所以这是**可选渠道**：没配就明确报错，
 * 而不是让模型编一个"我画好了"。
 *
 * 加固点（P0 1.5）：
 *  - b64 允许 `data:image/...;base64,` 前缀和 URL-safe base64，解码上限 20MB；
 *  - url 下载 30s 超时 + 20MB 上限，必须 content-type: image/* 且魔数匹配；
 *  - 相对 URL / data: URL 都能处理；跨域下载不转发 API Key；
 *  - 失败一律给中文可操作建议（断网 / 超时 / 401 / 429 / 非 JSON…）。
 */
import { base64ToBytes } from '../fs/encoding';
import {
  LIGHT_ERROR_HINTS,
  LightRequestError,
  isOffline,
  lightTimeoutMessage,
  type LightErrorKind,
} from '../../lib/errors';
import type { LightImageConfig } from './types';

/** 生成图解码/下载后的上限（约 20MB；手机内存有限） */
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
/** 下载生成图的总超时 */
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;
/** 生成请求本身（模型出图可能慢，给 2 分钟） */
export const IMAGE_REQUEST_TIMEOUT_MS = 120_000;

export function imagesUrl(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/images/generations')) return trimmed;
  return `${trimmed}/images/generations`;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  mime: string;
  /** 部分服务会给改写后的 prompt */
  revisedPrompt?: string;
}

function normalizeMime(value?: string | null): string {
  const text = String(value ?? '').trim().toLowerCase();
  const semi = text.indexOf(';');
  return (semi >= 0 ? text.slice(0, semi) : text).trim();
}

/** 只看魔数认图片格式；认不出返回 null（url 模式会据此拒绝） */
function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
    return 'image/x-icon';
  }
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  ) {
    return 'image/tiff';
  }
  // HEIF/AVIF：偏移 4 是 'ftyp'，brand 在 8..12
  if (bytes.length >= 12) {
    const ftyp = String.fromCharCode(bytes[4] as number, bytes[5] as number, bytes[6] as number, bytes[7] as number);
    if (ftyp === 'ftyp') {
      const brand = String.fromCharCode(
        bytes[8] as number,
        bytes[9] as number,
        bytes[10] as number,
        bytes[11] as number,
      );
      if (brand === 'avif' || brand === 'avis') return 'image/avif';
      if (brand.startsWith('heic') || brand.startsWith('heix') || brand === 'mif1') return 'image/heic';
    }
  }
  return null;
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

/** 图片 mime → 扩展名（不带点）；生图落盘按真实格式命名，不再一律 .png */
export function extensionForImageMime(mime?: string | null): string {
  switch (normalizeMime(mime)) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/bmp':
      return 'bmp';
    case 'image/avif':
      return 'avif';
    case 'image/heic':
    case 'image/heif':
      return 'heic';
    case 'image/tiff':
      return 'tiff';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return 'ico';
    case 'image/png':
    default:
      return 'png';
  }
}

function imageError(kind: LightErrorKind, message: string, status?: number): LightRequestError {
  return new LightRequestError(kind, message, status);
}

function tooLargeError(): LightRequestError {
  return imageError(
    'bad_request',
    `生成的图片超过 ${Math.round(IMAGE_MAX_BYTES / 1024 / 1024)}MB 上限，手机端不落地。换小一点的尺寸再试。`,
  );
}

function corruptBase64Error(): LightRequestError {
  return imageError(
    'bad_request',
    '生图服务返回的 base64 数据损坏，解不出图片。让模型/渠道重试一次，或换一个生图模型。',
  );
}

/** 把 b64_json 的几种变体解成字节：带 data: 前缀、URL-safe、带换行都可以 */
function decodeImageBase64(raw: string): { bytes: Uint8Array; declaredMime?: string } {
  let text = raw.trim();
  let declaredMime: string | undefined;
  if (/^data:/i.test(text)) {
    const match = /^data:([^,]*),([\s\S]*)$/i.exec(text);
    if (!match) throw corruptBase64Error();
    const header = match[1] ?? '';
    const semi = header.indexOf(';');
    declaredMime = normalizeMime(semi >= 0 ? header.slice(0, semi) : header);
    text = match[2] ?? '';
  }
  text = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!text || /[^A-Za-z0-9+/]/.test(text) || text.length % 4 === 1) throw corruptBase64Error();
  // 先按长度估算，避免为了判断上限把 100MB 的串解进内存
  if (Math.floor((text.length * 3) / 4) > IMAGE_MAX_BYTES) throw tooLargeError();
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(text);
  } catch {
    throw corruptBase64Error();
  }
  if (bytes.length === 0) throw corruptBase64Error();
  if (bytes.length > IMAGE_MAX_BYTES) throw tooLargeError();
  return { bytes, ...(declaredMime ? { declaredMime } : {}) };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function resolveDownloadUrl(raw: string, requestUrl: string): string {
  if (/^data:/i.test(raw)) return raw;
  try {
    return new URL(raw, requestUrl).toString();
  } catch {
    throw imageError('bad_request', `生图服务返回的图片 URL 不合法：${raw.slice(0, 120)}`);
  }
}

/** 带总超时 + 外部取消的 fetch；超时覆盖到 body 读完，错误统一翻成中文 */
async function withFetch<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  external: AbortSignal | undefined,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  if (external?.aborted) throw imageError('canceled', LIGHT_ERROR_HINTS.canceled);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = (): void => controller.abort();
  external?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, { ...init, signal: controller.signal } as RequestInit);
    return await consume(response);
  } catch (error) {
    if (error instanceof LightRequestError) throw error;
    if (external?.aborted) throw imageError('canceled', LIGHT_ERROR_HINTS.canceled);
    if (timedOut) throw imageError('timeout', lightTimeoutMessage(timeoutMs));
    if (isOffline()) throw imageError('offline', LIGHT_ERROR_HINTS.offline);
    const detail = error instanceof Error ? error.message : String(error);
    throw imageError('offline', `连不上生图服务（${detail.slice(0, 120)}）：检查手机网络和 Base URL。`);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onAbort);
  }
}

function httpError(status: number, statusText: string, body: string): LightRequestError {
  const detail = body.replace(/\s+/g, ' ').trim().slice(0, 200);
  const suffix = detail ? `：${detail}` : '';
  if (status === 401 || status === 403) {
    return imageError('unauthorized', `生图 Key 无效或没有权限（${status}）：检查生图 Base URL / Key${suffix}`, status);
  }
  if (status === 404) {
    return imageError(
      'not_found',
      `生图接口不存在（404）：检查生图 Base URL 是否要带 /v1，或换成兼容 images/generations 的渠道${suffix}`,
      status,
    );
  }
  if (status === 429) {
    return imageError('rate_limited', `生图额度不足或太频繁（429）：稍后再试，或检查账户余额${suffix}`, status);
  }
  if (status === 400 || status === 422) {
    return imageError(
      'bad_request',
      `生图请求被拒绝（${status} ${statusText}）：检查模型名 / 尺寸；若渠道不认识 response_format，把“返回格式”改成“自动”${suffix}`,
      status,
    );
  }
  if (status >= 500) {
    return imageError('server', `生图服务异常（${status} ${statusText}）：稍后重试${suffix}`, status);
  }
  return imageError('bad_request', `生图失败（${status} ${statusText}）${suffix}`, status);
}

interface GenerationResponse {
  status: number;
  statusText: string;
  text: string;
}

async function postGeneration(
  config: LightImageConfig,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs: number = IMAGE_REQUEST_TIMEOUT_MS,
): Promise<GenerationResponse> {
  return withFetch(
    imagesUrl(config.baseURL),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
    signal,
    async (response) => {
      const text = await response.text().catch(() => '');
      return { status: response.status, statusText: response.statusText, text };
    },
  );
}

/** url 模式落盘前校验：content-type 必须是 image/* 且魔数可识别 */
function requireDownloadedImage(bytes: Uint8Array, contentType: string): { mime: string } {
  const declared = normalizeMime(contentType);
  if (!declared || !isImageMime(declared)) {
    throw imageError(
      'bad_request',
      `下载地址返回的不是图片（content-type 是 ${declared || '空'}）：检查生图渠道的 url 是否指向图片文件。`,
    );
  }
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) {
    throw imageError(
      'bad_request',
      `下载到的内容不像图片（content-type 说是 ${declared}，但文件头不匹配）：检查渠道返回的 url。`,
    );
  }
  return { mime: sniffed };
}

async function downloadImage(
  rawUrl: string,
  config: LightImageConfig,
  signal?: AbortSignal,
  timeoutMs: number = IMAGE_DOWNLOAD_TIMEOUT_MS,
): Promise<GeneratedImage> {
  const requestUrl = imagesUrl(config.baseURL);
  const url = resolveDownloadUrl(rawUrl, requestUrl);
  if (url.startsWith('data:')) {
    const decoded = decodeImageBase64(url);
    const declared = decoded.declaredMime ?? '';
    if (!isImageMime(declared)) {
      throw imageError(
        'bad_request',
        `data: 图片缺少 image/* 类型（收到 ${declared || '空'}）：检查生图渠道的返回格式。`,
      );
    }
    const sniffed = sniffImageMime(decoded.bytes);
    if (!sniffed) throw imageError('bad_request', 'data: 图片的文件头和声明的类型不匹配。');
    return { bytes: decoded.bytes, mime: sniffed };
  }

  const headers: Record<string, string> = {};
  // 只有同源才带 Key；跳到 CDN/第三方域名时绝不转发
  if (config.apiKey && sameOrigin(config.baseURL, url)) headers.Authorization = `Bearer ${config.apiKey}`;
  return withFetch(
    url,
    { method: 'GET', headers, redirect: 'follow' },
    timeoutMs,
    signal,
    async (response): Promise<GeneratedImage> => {
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw httpError(response.status, response.statusText, body);
      }
      const contentType = response.headers.get('content-type') ?? '';
      const declared = normalizeMime(contentType);
      if (!isImageMime(declared)) {
        throw imageError(
          'bad_request',
          `下载地址返回的不是图片（content-type 是 ${declared || '空'}）：检查生图渠道返回的 url。`,
        );
      }
      const length = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(length) && length > IMAGE_MAX_BYTES) throw tooLargeError();
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0) throw imageError('empty', '生成的图片是空文件，换一个生图模型或尺寸再试。');
      if (bytes.length > IMAGE_MAX_BYTES) throw tooLargeError();
      const { mime } = requireDownloadedImage(bytes, contentType);
      return { bytes, mime };
    },
  );
}

export async function generateImage(
  config: LightImageConfig,
  prompt: string,
  options: {
    size?: string;
    signal?: AbortSignal;
    /** 测试/特殊网络可用；默认 2 分钟 */
    requestTimeoutMs?: number;
    /** 测试/特殊网络可用；默认 30 秒 */
    downloadTimeoutMs?: number;
  } = {},
): Promise<GeneratedImage> {
  if (!config.baseURL.trim()) throw imageError('bad_request', '没有配置生图 Base URL');
  if (!config.model.trim()) throw imageError('bad_request', '没有配置生图模型');
  if (!prompt.trim()) throw imageError('bad_request', 'prompt 为空');

  const size = options.size ?? config.size ?? '1024x1024';
  const body: Record<string, unknown> = {
    model: config.model,
    prompt,
    n: 1,
    size,
  };
  const responseFormat = config.responseFormat ?? 'auto';
  if (responseFormat !== 'auto') body.response_format = responseFormat;

  let response = await postGeneration(config, body, options.signal, options.requestTimeoutMs);
  // 有些网关（不是模型）不认 response_format：400/422 明确提到时去掉重试一次
  if (
    (response.status === 400 || response.status === 422) &&
    /response[_\s-]?format/i.test(response.text)
  ) {
    const retryBody = { ...body };
    delete retryBody.response_format;
    response = await postGeneration(config, retryBody, options.signal, options.requestTimeoutMs);
  }

  if (response.status < 200 || response.status >= 300) {
    throw httpError(response.status, response.statusText, response.text);
  }

  let payload: {
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    error?: { message?: string };
  };
  try {
    payload = JSON.parse(response.text) as typeof payload;
  } catch {
    throw imageError(
      'bad_request',
      '生图服务返回的不是 JSON（HTTP 200）：检查生图 Base URL 是否指到了网页、网关或错误的路径。',
    );
  }
  const first = payload.data?.[0];
  if (!first) {
    const detail = payload.error?.message ? `：${payload.error.message}` : '';
    throw imageError('empty', `生图服务没有返回 data[0]${detail}`);
  }

  let image: GeneratedImage;
  if (typeof first.b64_json === 'string' && first.b64_json.trim().length > 0) {
    const decoded = decodeImageBase64(first.b64_json);
    const sniffed = sniffImageMime(decoded.bytes);
    if (!sniffed) {
      if (decoded.declaredMime && isImageMime(decoded.declaredMime)) {
        image = { bytes: decoded.bytes, mime: decoded.declaredMime };
      } else {
        throw imageError('bad_request', '生图服务返回的 base64 不是可识别的图片格式。');
      }
    } else {
      image = { bytes: decoded.bytes, mime: sniffed };
    }
  } else if (typeof first.url === 'string' && first.url.trim().length > 0) {
    image = await downloadImage(first.url.trim(), config, options.signal, options.downloadTimeoutMs);
  } else {
    throw imageError('empty', '生图服务返回里既没有 b64_json 也没有 url');
  }

  if (image.bytes.length === 0) throw imageError('empty', '生成的图片是空文件');
  return {
    ...image,
    ...(first.revised_prompt ? { revisedPrompt: first.revised_prompt } : {}),
  };
}

/** PNG 头里读宽高，给模型一个"图多大"的反馈；读不出来就返回 null */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
