import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isWidgetQuickAskLink, parseDeepLink } from '../app/src/lib/lightLink';

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

  it('light：可带生图渠道参数', () => {
    const link = parseDeepLink(
      'dshpalm://light?base=https%3A%2F%2Fapi.deepseek.com%2Fv1&model=deepseek-chat&key=sk-test' +
        '&imageBase=https%3A%2F%2Fapi.openai.com%2Fv1&imageModel=gpt-image-1&imageKey=sk-img&imageSize=512x512',
    );
    assert.equal(link?.kind, 'light');
    if (link?.kind !== 'light') return;
    assert.equal(link.setup.imageBaseURL, 'https://api.openai.com/v1');
    assert.equal(link.setup.imageModel, 'gpt-image-1');
    assert.equal(link.setup.imageApiKey, 'sk-img');
    assert.equal(link.setup.imageSize, '512x512');
  });

  it('light：生图参数只填一半就不认', () => {
    assert.equal(
      parseDeepLink('dshpalm://light?base=https%3A%2F%2Fapi.deepseek.com%2Fv1&model=x&key=k&imageBase=https%3A%2F%2Fa'),
      null,
    );
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

describe('桌面小组件快速提问链接', () => {
  it('widget_quick 与旧的带 draft 链接都算快速提问', () => {
    assert.equal(
      isWidgetQuickAskLink('dshpalm://session?source=widget_quick&draft=%E4%BD%A0%E5%A5%BD&autoSend=true'),
      true,
    );
    assert.equal(isWidgetQuickAskLink('dshpalm://session?source=widget&draft=hi&autoSend=true'), true);
  });

  it('单纯打开 App / 新会话 / 桌宠回 App 不算', () => {
    assert.equal(isWidgetQuickAskLink('dshpalm://session?source=widget&newChat=false&focus=true'), false);
    assert.equal(isWidgetQuickAskLink('dshpalm://session?source=widget&newChat=true'), false);
    assert.equal(isWidgetQuickAskLink('dshpalm://session?source=pet_float'), false);
    assert.equal(isWidgetQuickAskLink('dshpalm://session?source=tile'), false);
    assert.equal(isWidgetQuickAskLink(null), false);
  });
});
