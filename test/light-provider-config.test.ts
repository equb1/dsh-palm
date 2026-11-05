/**
 * M2.5：轻引擎把设置页 ProvidersCard 的保存落到单条渠道（纯函数）。
 *
 * 重点验证账号模式不会被「留空 API Key」洗掉（PITFALLS I7），
 * 以及换域名时必须重新填 Key，避免把账号 token 发到别的服务商。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyProviderSave,
  withFreshAccountToken,
  type LightEngineSetup,
} from '../app/src/engine/light/config';

const account: LightEngineSetup = {
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  authMode: 'account',
  authToken: 'account-token-64',
  providerName: 'DeepSeek',
};

function save(overrides: Partial<Parameters<typeof applyProviderSave>[1]> = {}) {
  return applyProviderSave(account, {
    mode: 'custom',
    baseURL: 'https://api.deepseek.com/v1',
    api: 'openai-completions',
    models: [{ id: 'deepseek-chat' }],
    ...overrides,
  });
}

describe('light · providers.save', () => {
  it('账号模式留空 Key、同域名保存：模型和账号 token 都保留', () => {
    const next = save();
    assert.equal(next.baseURL, 'https://api.deepseek.com/v1');
    assert.equal(next.model, 'deepseek-chat');
    assert.equal(next.authMode, 'account');
    assert.equal(next.authToken, 'account-token-64');
    assert.equal(next.apiKey, '');
  });

  it('填了新 Key：切到 API Key 模式，清掉账号 token', () => {
    const next = save({ apiKey: ' sk-new ', baseURL: 'https://api.deepseek.com/v1/' });
    assert.equal(next.baseURL, 'https://api.deepseek.com/v1');
    assert.equal(next.apiKey, 'sk-new');
    assert.equal(next.authMode, undefined);
    assert.equal(next.authToken, undefined);
  });

  it('提交的模型里还有当前模型就保持；没有就取第一个', () => {
    assert.equal(save({ models: [{ id: 'deepseek-flash' }, { id: 'deepseek-chat' }] }).model, 'deepseek-chat');
    assert.equal(save({ models: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }).model, 'deepseek-flash');
  });

  it('换 Base URL 又没填 Key / 空模型 / 非 OpenAI 协议都拒绝', () => {
    assert.throws(() => save({ baseURL: 'https://openrouter.ai/api/v1' }), /重新填 API Key/);
    assert.throws(() => save({ models: [] }), /至少勾选一个模型/);
    assert.throws(() => save({ api: 'anthropic-messages' }), /OpenAI 兼容/);
    assert.throws(() => save({ baseURL: 'api.deepseek.com' }), /http/);
  });

  it('账号模式但 token 已丢：明确提示重登，不生成无鉴权配置', () => {
    assert.throws(
      () => applyProviderSave({ ...account, authToken: undefined }, {
        mode: 'custom',
        baseURL: 'https://api.deepseek.com/v1',
        api: 'openai-completions',
        models: [{ id: 'deepseek-chat' }],
      }),
      /重新登录/,
    );
  });
});

describe('light · 账号 token 刷新（M2.7）', () => {
  it('切回轻引擎优先用最新 token，不被缓存里的旧 token 挡住', () => {
    const next = withFreshAccountToken(account, ' brand-new-token ');
    assert.equal(next?.authToken, 'brand-new-token');
    assert.equal(next?.authMode, 'account');
  });

  it('读不到新 token 时回退旧值，不清空还能用的配置', () => {
    assert.equal(withFreshAccountToken(account, null)?.authToken, 'account-token-64');
    assert.equal(withFreshAccountToken(account, '   ')?.authToken, 'account-token-64');
  });

  it('账号模式且新旧 token 都没有 → null（交给配置页/完整模式）', () => {
    assert.equal(withFreshAccountToken({ ...account, authToken: undefined }, null), null);
  });

  it('普通 API Key 渠道不碰 token', () => {
    const apiKeySetup: LightEngineSetup = { baseURL: 'https://x/v1', apiKey: 'sk-1', model: 'm' };
    assert.deepEqual(withFreshAccountToken(apiKeySetup, 't'), apiKeySetup);
  });
});
