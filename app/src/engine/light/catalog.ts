/**
 * 轻引擎的模型目录（M2.5）。
 *
 * 账号模式复用 dsh 账号 token 调 `GET {baseURL}/models`，把 DeepSeek 账号
 * 当前可用模型（deepseek-flash / deepseek-v4-pro）拉给模型面板；
 * 普通 API Key 渠道不额外请求，仍用配置里的单一模型。
 *
 * 失败不抛给 UI：调用方拿到空数组就回退到「当前模型」。
 */
import type { LightModelConfig } from './types';

export interface CatalogModel {
  id: string;
  name?: string;
}

export function modelsUrl(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/models')) return trimmed;
  return `${trimmed}/models`;
}

interface ModelsResponse {
  data?: Array<{ id?: unknown; name?: unknown }>;
}

export async function listProviderModels(
  config: Pick<LightModelConfig, 'baseURL' | 'authToken'>,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<CatalogModel[]> {
  const token = config.authToken?.trim();
  if (!token) return [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 6000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`模型目录超时（${timeoutMs}ms）`)), timeoutMs);
  });
  try {
    const response = await Promise.race([
      fetchImpl(modelsUrl(config.baseURL), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-dsh-auth-token': token,
        },
      }),
      timeout,
    ]);
    if (!response.ok) return [];
    const payload = (await response.json()) as ModelsResponse;
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const seen = new Set<string>();
    const models: CatalogModel[] = [];
    for (const row of rows) {
      const id = typeof row?.id === 'string' ? row.id.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const name = typeof row?.name === 'string' && row.name.trim() ? row.name.trim() : id;
      models.push({ id, name });
      if (models.length >= 50) break;
    }
    return models;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
