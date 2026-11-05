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

  it('API Key 渠道走 Authorization: Bearer，账号模式走 x-dsh-auth-token', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const capture = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(JSON.stringify({ data: [{ id: 'm1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await listProviderModels({ baseURL: 'https://x.test/v1', apiKey: 'sk-1' }, { fetchImpl: capture });
    assert.equal(calls[0]?.url, 'https://x.test/v1/models');
    assert.equal(calls[0]?.headers.Authorization, 'Bearer sk-1');
    assert.equal(calls[0]?.headers['x-dsh-auth-token'], undefined);

    await listProviderModels({ baseURL: 'https://x.test/v1', authToken: 't' }, { fetchImpl: capture });
    assert.equal(calls[1]?.headers['x-dsh-auth-token'], 't');
    assert.equal(calls[1]?.headers.Authorization, undefined);
  });

  it('解析 context_window / context_length 给模型面板', async () => {
    const fetchImpl = fakeFetch({
      data: [
        { id: 'a', context_window: 65536 },
        { id: 'b', context_length: '131072' },
        { id: 'c', context_length: 0 },
      ],
    });
    const models = await listProviderModels(
      { baseURL: 'https://x', apiKey: 'k' },
      { fetchImpl, timeoutMs: 1000 },
    );
    assert.deepEqual(models, [
      { id: 'a', name: 'a', contextWindow: 65536 },
      { id: 'b', name: 'b', contextWindow: 131072 },
      { id: 'c', name: 'c' },
    ]);
  });
});
