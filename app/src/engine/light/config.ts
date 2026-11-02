/**
 * 轻引擎的配置形状与默认值。
 *
 * 只有「一个渠道」：Base URL + 模型 + Key。账号体系、目录、多提供商
 * 都是完整引擎的能力（docs/23 §4），轻引擎 MVP 不假装有。
 */
export interface LightEngineSetup {
  baseURL: string;
  apiKey: string;
  model: string;
  /** 展示名，例如 DeepSeek / OpenRouter */
  providerName?: string;
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
  return {
    baseURL,
    apiKey: (input.apiKey ?? '').trim(),
    model: (input.model ?? '').trim(),
    ...(input.providerName?.trim() ? { providerName: input.providerName.trim() } : {}),
  };
}

/** 给界面用的一句话校验；null 表示可以连 */
export function setupProblem(setup: LightEngineSetup): string | null {
  if (!/^https?:\/\//i.test(setup.baseURL)) return 'Base URL 要以 http:// 或 https:// 开头';
  if (!setup.model) return '模型名不能为空';
  if (!setup.apiKey) return 'API Key 不能为空（模型服务都需要）';
  return null;
}
