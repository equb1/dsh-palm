/**
 * 轻引擎的配置形状与默认值。
 *
 * 文本模型只有一个渠道（Base URL + 模型 + Key）；生图是**可选渠道**
 * （官方账号没有图像模型，要用户自己配）。
 */
import type { ProviderProtocol } from '../../protocol';
import type { ImageResponseFormat, LightImageConfig } from './types';

export interface LightEngineSetup {
  baseURL: string;
  apiKey: string;
  model: string;
  /** apiKey：普通 OpenAI 兼容渠道；account：复用 dsh 官方账号 token */
  authMode?: 'apiKey' | 'account';
  /** 账号 token，只在运行时传入，不落 SecureStore */
  authToken?: string;
  /** 展示名，例如 DeepSeek / OpenRouter */
  providerName?: string;
  /** 可选：生图渠道 */
  imageBaseURL?: string;
  imageApiKey?: string;
  imageModel?: string;
  imageSize?: string;
  /** 生图返回格式；默认 auto（不传 response_format） */
  imageResponseFormat?: ImageResponseFormat;
}

export const LIGHT_CONFIG_KEY = 'dsh-palm.light.config.v1';

export const DEEPSEEK_DEFAULT: LightEngineSetup = {
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  providerName: 'DeepSeek',
};

export function normalizeSetup(input: Partial<LightEngineSetup>): LightEngineSetup {
  const baseURL = (input.baseURL ?? '').trim().replace(/\/+$/, '');
  const imageBaseURL = (input.imageBaseURL ?? '').trim().replace(/\/+$/, '');
  const imageApiKey = (input.imageApiKey ?? '').trim();
  const imageModel = (input.imageModel ?? '').trim();
  const imageSize = (input.imageSize ?? '').trim();
  const imageResponseFormat = normalizeResponseFormat(input.imageResponseFormat);
  return {
    baseURL,
    apiKey: (input.apiKey ?? '').trim(),
    model: (input.model ?? '').trim(),
    ...(input.authMode === 'account' ? { authMode: 'account' } : {}),
    ...(input.authToken?.trim() ? { authToken: input.authToken.trim() } : {}),
    ...(input.providerName?.trim() ? { providerName: input.providerName.trim() } : {}),
    ...(imageBaseURL ? { imageBaseURL } : {}),
    ...(imageApiKey ? { imageApiKey } : {}),
    ...(imageModel ? { imageModel } : {}),
    ...(imageSize ? { imageSize } : {}),
    ...(imageResponseFormat !== 'auto' ? { imageResponseFormat } : {}),
  };
}

/** 只认三个值；旧配置没有这个字段时按 auto */
export function normalizeResponseFormat(value: unknown): ImageResponseFormat {
  return value === 'b64_json' || value === 'url' ? value : 'auto';
}

/** 给界面用的一句话校验；null 表示可以连 */
export function setupProblem(setup: LightEngineSetup): string | null {
  if (!/^https?:\/\//i.test(setup.baseURL)) return 'Base URL 要以 http:// 或 https:// 开头';
  if (!setup.model) return '模型名不能为空';
  if (!setup.apiKey && setup.authMode !== 'account') return 'API Key 不能为空（或改用 DeepSeek 账号）';
  const imageFields = [setup.imageBaseURL, setup.imageModel, setup.imageApiKey];
  if (imageFields.some((value) => Boolean(value)) && imageFields.some((value) => !value)) {
    return '生图渠道要么全填（Base URL / 模型 / Key），要么全空';
  }
  if (setup.imageBaseURL && !/^https?:\/\//i.test(setup.imageBaseURL)) {
    return '生图 Base URL 要以 http:// 或 https:// 开头';
  }
  return null;
}

/** 生图配置齐全时才返回；否则 undefined（工具会提示没配） */
export function imageConfigFrom(setup: LightEngineSetup): LightImageConfig | undefined {
  if (!setup.imageBaseURL || !setup.imageModel) return undefined;
  const responseFormat = normalizeResponseFormat(setup.imageResponseFormat);
  return {
    baseURL: setup.imageBaseURL,
    apiKey: setup.imageApiKey ?? '',
    model: setup.imageModel,
    ...(setup.imageSize ? { size: setup.imageSize } : {}),
    ...(responseFormat !== 'auto' ? { responseFormat } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * M2.5：设置页 ProvidersCard 在轻引擎里保存单条模型渠道
 * ------------------------------------------------------------------ */

/** providers.save 的 custom 分支（轻引擎只有这一种） */
export interface ProviderSaveDraft {
  mode: 'custom';
  displayName?: string;
  baseURL: string;
  api: ProviderProtocol;
  models: Array<{ id: string }>;
  apiKey?: string;
}

function hostLabel(baseURL: string): string | undefined {
  const match = /^https?:\/\/([^/:]+)/i.exec(baseURL);
  return match?.[1]?.replace(/^www\./i, '');
}

/**
 * 把 ProvidersCard 的保存动作落到轻引擎的单条渠道上。
 *
 * 规则：
 *  - 只支持 OpenAI 兼容协议和一条渠道（轻引擎本来就是单模型）；
 *  - 提交的模型里如果还有当前模型就保持不动，否则取第一个（UI 是多选，轻引擎只认一个）；
 *  - API Key 留空表示沿用原 Key；账号模式下继续复用账号 token（I7）；
 *  - 换了 Base URL 又没填 Key 直接拒绝，避免把账号 token 发到别的域名。
 */
export function applyProviderSave(setup: LightEngineSetup, draft: ProviderSaveDraft): LightEngineSetup {
  if (draft.mode !== 'custom') throw new Error('轻引擎只有一条自定义模型渠道');
  if (draft.api !== 'openai-completions') {
    throw new Error('轻引擎只支持 OpenAI 兼容协议（chat/completions）');
  }
  const baseURL = draft.baseURL.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseURL)) throw new Error('Base URL 要以 http:// 或 https:// 开头');
  const ids = draft.models.map((model) => model.id.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error('至少勾选一个模型');
  const model = ids.includes(setup.model) ? setup.model : (ids[0] as string);

  const previousBase = setup.baseURL.trim().replace(/\/+$/, '');
  const apiKey = draft.apiKey?.trim() ?? '';
  if (!apiKey && baseURL !== previousBase) throw new Error('换了 Base URL 就要重新填 API Key');
  if (!apiKey && !setup.apiKey && setup.authMode !== 'account') throw new Error('先填 API Key');

  const name = draft.displayName?.trim() || setup.providerName || hostLabel(baseURL);
  const next: LightEngineSetup = { ...setup, baseURL, model, ...(name ? { providerName: name } : {}) };
  if (apiKey) {
    next.apiKey = apiKey;
    delete next.authMode;
    delete next.authToken;
  } else if (next.authMode === 'account' && !next.authToken) {
    throw new Error('账号 token 已失效，请先在完整引擎重新登录');
  }
  return normalizeSetup(next);
}
