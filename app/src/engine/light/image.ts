/**
 * 生图：调 OpenAI 兼容的 `POST {base}/images/generations`，把图落到工作区。
 *
 * 只支持 `b64_json`（手机端最稳，不用二次下载）和 `url` 两种返回。
 * 官方 DeepSeek 账号没有图像模型，所以这是**可选渠道**：没配就明确报错，
 * 而不是让模型编一个"我画好了"。
 */
import { base64ToBytes } from '../fs/encoding';
import type { LightImageConfig } from './types';

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

function sniffsMime(bytes: Uint8Array, fallback?: string | null): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  return fallback?.split(';')[0]?.trim() || 'image/png';
}

export async function generateImage(
  config: LightImageConfig,
  prompt: string,
  options: { size?: string; signal?: AbortSignal } = {},
): Promise<GeneratedImage> {
  if (!config.baseURL.trim()) throw new Error('没有配置生图 Base URL');
  if (!config.model.trim()) throw new Error('没有配置生图模型');
  if (!prompt.trim()) throw new Error('prompt 为空');

  const size = options.size ?? config.size ?? '1024x1024';
  const response = await fetch(imagesUrl(config.baseURL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      prompt,
      n: 1,
      size,
      response_format: 'b64_json',
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  } as unknown as RequestInit);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const detail = body.replace(/\s+/g, ' ').trim().slice(0, 200);
    const hint =
      response.status === 401 || response.status === 403
        ? '生图 Key 无效或没有权限'
        : response.status === 404
          ? '生图接口不存在，检查 Base URL 是否要带 /v1'
          : response.status === 429
            ? '生图额度不足或太频繁'
            : `生图失败（${response.status} ${response.statusText}）`;
    throw new Error(`${hint}${detail ? `：${detail}` : ''}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  };
  const first = payload.data?.[0];
  if (!first) throw new Error('生图服务没有返回 data[0]');

  let bytes: Uint8Array;
  let fallbackMime: string | null = null;
  if (typeof first.b64_json === 'string' && first.b64_json.length > 0) {
    bytes = base64ToBytes(first.b64_json);
  } else if (typeof first.url === 'string' && first.url.length > 0) {
    const download = await fetch(
      first.url,
      (options.signal ? { signal: options.signal } : {}) as unknown as RequestInit,
    );
    if (!download.ok) throw new Error(`下载生成的图片失败（${download.status}）`);
    fallbackMime = download.headers.get('content-type');
    bytes = new Uint8Array(await download.arrayBuffer());
  } else {
    throw new Error('生图服务返回里既没有 b64_json 也没有 url');
  }

  if (bytes.length === 0) throw new Error('生成的图片是空文件');
  return {
    bytes,
    mime: sniffsMime(bytes, fallbackMime),
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
