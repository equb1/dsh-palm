import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { modelReadiness } from '../app/src/lib/readiness';

describe('模型可用性（顶栏状态点 / 发送前检查）', () => {
  it('账号已登录：模型就绪，不显示“未配置”', () => {
    const readiness = modelReadiness({
      accountStatus: 'credential-stored',
      credentials: {},
      providers: [],
      engineKind: 'proot',
      lightReady: false,
    });
    assert.equal(readiness.signedIn, true);
    assert.equal(readiness.modelReady, true);
  });

  it('连上引擎但既没登录也没 Key / 提供商：不是就绪（不能假绿）', () => {
    const readiness = modelReadiness({
      accountStatus: 'signed-out',
      credentials: { DEEPSEEK_API_KEY: { configured: false } },
      providers: [{ configured: false, displayName: 'OpenRouter' }],
      engineKind: 'proot',
      lightReady: false,
    });
    assert.equal(readiness.modelReady, false);
  });

  it('API Key 或已配置的第三方提供商都算就绪', () => {
    const withKey = modelReadiness({
      accountStatus: 'signed-out',
      credentials: { DEEPSEEK_API_KEY: { configured: true } },
      providers: [],
      engineKind: 'light',
      lightReady: true,
    });
    assert.equal(withKey.modelReady, true);

    const withProvider = modelReadiness({
      accountStatus: 'signed-out',
      credentials: {},
      providers: [{ configured: true, displayName: 'SiliconFlow' }],
      engineKind: 'light',
      lightReady: true,
    });
    assert.equal(withProvider.modelReady, true);
    assert.equal(withProvider.providerName, 'SiliconFlow');
  });

  it('轻引擎已连上且列表里有渠道：即使 configured 字段缺失也算就绪', () => {
    const readiness = modelReadiness({
      accountStatus: 'signed-out',
      credentials: {},
      providers: [{ displayName: 'DeepSeek' }],
      engineKind: 'light',
      lightReady: true,
    });
    assert.equal(readiness.modelReady, true);
    assert.equal(readiness.providerName, 'DeepSeek');
  });
});
