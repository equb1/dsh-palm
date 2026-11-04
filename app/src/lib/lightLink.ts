/**
 * `dshpalm://` 深链解析。
 *
 * 目前有两种：
 *   dshpalm://pair?url=ws://…&code=123456    连另一台宿主
 *   dshpalm://light?base=…&model=…&key=…     配好并连接本机轻引擎（扫码/粘贴）
 *
 * 轻引擎这条把 Key 放在 URL 里，适合本机扫码或自己粘贴；**不要当成分享链接**，
 * URL 可能进 shell history / 系统日志。文档里写清楚了。
 */
import { normalizeSetup, setupProblem, type LightEngineSetup } from '../engine/light/config';

export type DeepLink =
  | { kind: 'pair'; url?: string; code?: string }
  | { kind: 'light'; setup: LightEngineSetup };

const PREFIX = 'dshpalm://';

export function parseDeepLink(raw: string | null | undefined): DeepLink | null {
  if (!raw || !raw.startsWith(PREFIX)) return null;
  const rest = raw.slice(PREFIX.length);
  const queryIndex = rest.indexOf('?');
  const host = (queryIndex >= 0 ? rest.slice(0, queryIndex) : rest).replace(/\/+$/, '');
  const query = queryIndex >= 0 ? rest.slice(queryIndex + 1) : '';
  const params = new URLSearchParams(query);

  if (host === 'pair') {
    const url = params.get('url') ?? undefined;
    const code = params.get('code') ?? undefined;
    if (!url && !code) return null;
    return { kind: 'pair', ...(url ? { url } : {}), ...(code ? { code } : {}) };
  }

  if (host === 'light') {
    const setup = normalizeSetup({
      baseURL: params.get('base') ?? params.get('baseURL') ?? '',
      apiKey: params.get('key') ?? params.get('apiKey') ?? '',
      model: params.get('model') ?? '',
      providerName: params.get('name') ?? undefined,
      imageBaseURL: params.get('imageBase') ?? undefined,
      imageApiKey: params.get('imageKey') ?? undefined,
      imageModel: params.get('imageModel') ?? undefined,
      imageSize: params.get('imageSize') ?? undefined,
      imageResponseFormat:
        (params.get('imageFormat') as 'auto' | 'b64_json' | 'url' | null) ?? undefined,
    });
    if (setupProblem(setup) !== null) return null;
    return { kind: 'light', setup };
  }

  return null;
}
