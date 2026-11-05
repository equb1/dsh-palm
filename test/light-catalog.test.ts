/**
 * 轻引擎账号模型目录（M2.5）：URL 拼接、解析、去重、失败回退。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { listProviderModels, modelsUrl } from '../app/src/engine/light/catalog';

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('light · 账号模型目录', () => {
  it('modelsUrl：baseURL 去尾斜杠，避免重复 /models', () => {
    assert.equal(modelsUrl('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/models');
    assert.equal(modelsUrl('https://api.deepseek.com/v1/'), 'https://api.deepseek.com/v1/models');
    assert.equal(modelsUrl('https://x.test/models'), 'https://x.test/models');
  });

  it('解析 data[].id/name，去重并保序', async () => {
    const fetchImpl = fakeFetch({
      data: [
        { id: 'deepseek-flash', name: 'DeepSeek Flash' },
        { id: 'deepseek-v4-pro' },
        { id: 'deepseek-flash' },
        { id: '' },
      ],
    });
    const models = await listProviderModels(
      { baseURL: 'https://api.deepseek.com/v1', authToken: 't' },
      { fetchImpl, timeoutMs: 1000 },
    );
    assert.deepEqual(models, [
      { id: 'deepseek-flash', name: 'DeepSeek Flash' },
      { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
    ]);
  });

  it('没有 token 不发请求；HTTP 非 2xx / 网络错误回退空数组', async () => {
    let called = 0;
    const counting = (async () => {
      called += 1;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    assert.deepEqual(await listProviderModels({ baseURL: 'https://x', authToken: '' }, { fetchImpl: counting }), []);
    assert.equal(called, 0);

    assert.deepEqual(
      await listProviderModels(
        { baseURL: 'https://x', authToken: 't' },
        { fetchImpl: fakeFetch({}, 500), timeoutMs: 1000 },
      ),
      [],
    );
    const throwing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    assert.deepEqual(
      await listProviderModels({ baseURL: 'https://x', authToken: 't' }, { fetchImpl: throwing, timeoutMs: 1000 }),
      [],
    );
  });
});
