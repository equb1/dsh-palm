/**
 * 轻引擎的配置形状与默认值。
 *
 * 文本模型只有一个渠道（Base URL + 模型 + Key）；生图是**可选渠道**
 * （官方账号没有图像模型，要用户自己配）。
 */
import type { LightImageConfig } from './types';

export interface LightEngineSetup {
  baseURL: string;
  apiKey: string;
  model: string;
  /** 展示名，例如 DeepSeek / OpenRouter */
  providerName?: string;
  /** 可选：生图渠道 */
  imageBaseURL?: string;
  imageApiKey?: string;
  imageModel?: string;
  imageSize?: string;
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
  return {
    baseURL,
    apiKey: (input.apiKey ?? '').trim(),
    model: (input.model ?? '').trim(),
    ...(input.providerName?.trim() ? { providerName: input.providerName.trim() } : {}),
    ...(imageBaseURL ? { imageBaseURL } : {}),
    ...(imageApiKey ? { imageApiKey } : {}),
    ...(imageModel ? { imageModel } : {}),
    ...(imageSize ? { imageSize } : {}),
  };
}

/** 给界面用的一句话校验；null 表示可以连 */
export function setupProblem(setup: LightEngineSetup): string | null {
  if (!/^https?:\/\//i.test(setup.baseURL)) return 'Base URL 要以 http:// 或 https:// 开头';
  if (!setup.model) return '模型名不能为空';
  if (!setup.apiKey) return 'API Key 不能为空（模型服务都需要）';
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
  return {
    baseURL: setup.imageBaseURL,
    apiKey: setup.imageApiKey ?? '',
    model: setup.imageModel,
    ...(setup.imageSize ? { size: setup.imageSize } : {}),
  };
}
