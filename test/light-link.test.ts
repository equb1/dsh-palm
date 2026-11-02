import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseDeepLink } from '../app/src/lib/lightLink';

describe('dshpalm 深链', () => {
  it('pair：url + code', () => {
    const link = parseDeepLink('dshpalm://pair?url=ws%3A%2F%2F192.168.1.7%3A8788%2Fws&code=246810');
    assert.deepEqual(link, { kind: 'pair', url: 'ws://192.168.1.7:8788/ws', code: '246810' });
  });

  it('light：base/model/key/name 齐全才认', () => {
    const link = parseDeepLink(
      'dshpalm://light?base=https%3A%2F%2Fapi.deepseek.com%2Fv1&model=deepseek-chat&key=sk-test&name=DeepSeek',
    );
    assert.deepEqual(link, {
      kind: 'light',
      setup: {
        baseURL: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: 'sk-test',
        providerName: 'DeepSeek',
      },
    });
  });

  it('light：缺 key / 非 http base 一律忽略', () => {
    assert.equal(parseDeepLink('dshpalm://light?base=https%3A%2F%2Fapi.deepseek.com%2Fv1&model=x'), null);
    assert.equal(parseDeepLink('dshpalm://light?base=api.deepseek.com&model=x&key=k'), null);
    assert.equal(parseDeepLink('dshpalm://light?model=x&key=k'), null);
  });

  it('其它 scheme/host 不认', () => {
    assert.equal(parseDeepLink('https://example.com'), null);
    assert.equal(parseDeepLink('dshpalm://unknown?a=1'), null);
    assert.equal(parseDeepLink(null), null);
  });

  it('base URL 尾部斜杠会被规整', () => {
    const link = parseDeepLink('dshpalm://light?base=http%3A%2F%2F127.0.0.1%3A8799%2Fv1%2F&model=m&key=k');
    assert.equal(link?.kind === 'light' ? link.setup.baseURL : null, 'http://127.0.0.1:8799/v1');
  });
});
