/**
 * 轻引擎的模型目录（M2.5）。
 *
 * 两种鉴权都支持：
 *  - 账号模式：复用 dsh 账号 token 调 `GET {baseURL}/models`（`x-dsh-auth-token`）；
 *  - 普通 API Key 渠道：`Authorization: Bearer <key>`（OpenAI 兼容 /models）。
 *
 * 失败不抛给 UI：调用方拿到空数组就回退到「当前模型」或给出人话错误。
 */
export interface CatalogModel {
  id: string;
  name?: string;
  /** 服务商给了 context_length/context_window 就带上，模型面板显示 K 数 */
  contextWindow?: number;
}

/** 发现模型只需要地址和一种鉴权；两者都给时优先 API Key */
export interface CatalogSource {
  baseURL: string;
  apiKey?: string;
  authToken?: string;
}

export function modelsUrl(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/models')) return trimmed;
  return `${trimmed}/models`;
}

interface ModelsResponse {
  data?: Array<{
    id?: unknown;
    name?: unknown;
    context_length?: unknown;
    context_window?: unknown;
  }>;
}

function positiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return undefined;
}

export async function listProviderModels(
  config: CatalogSource,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<CatalogModel[]> {
  const apiKey = config.apiKey?.trim();
  const token = config.authToken?.trim();
  if (!apiKey && !token) return [];
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  else headers['x-dsh-auth-token'] = token as string;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 6000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`模型目录超时（${timeoutMs}ms）`)), timeoutMs);
  });
  try {
    const response = await Promise.race([
      fetchImpl(modelsUrl(config.baseURL), { method: 'GET', headers }),
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
      const contextWindow = positiveInt(row.context_window ?? row.context_length);
      models.push({ id, name, ...(contextWindow ? { contextWindow } : {}) });
      if (models.length >= 50) break;
    }
    return models;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
