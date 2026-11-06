/**
 * M2.1：官方 Web 前端入口 / 深链 / WebView 生命周期（纯函数，不碰 react-native）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildWebBridgeControlScript,
  buildWebFrontendEndpoint,
  buildWebSessionBootstrap,
  describeWebViewError,
  initialWebSurfaceLifecycle,
  isLoopbackAddress,
  isLoopbackHost,
  normalizeWebSessionId,
  parseLoopbackWebSessionLink,
  parseWebSessionDeepLink,
  parseWebSessionNavigation,
  parseWebViewBridgeMessage,
  reduceWebSurfaceLifecycle,
  WebFrontendError,
  WEB_SESSION_STORAGE_KEY,
  type WebSurfaceLifecycleState,
} from '../app/src/lib/webFrontend';

describe('web 前端 URL / token 构造', () => {
  it('loopback 上把 token 放在 query 里，origin 不带 token', () => {
    const endpoint = buildWebFrontendEndpoint('http://127.0.0.1:8787', 'tok_123-x');
    assert.equal(endpoint.url, 'http://127.0.0.1:8787/?token=tok_123-x');
    assert.equal(endpoint.origin, 'http://127.0.0.1:8787');
    assert.equal(endpoint.token, 'tok_123-x');
    assert.equal(endpoint.local, true);
  });

  it('localhost / 127.0.0.1 / 带路径的 loopback 都能规整', () => {
    assert.equal(
      buildWebFrontendEndpoint('http://localhost:8899/', 'abc').url,
      'http://localhost:8899/?token=abc',
    );
    assert.equal(
      buildWebFrontendEndpoint('http://127.0.0.1:8787/app', 'a b').url,
      'http://127.0.0.1:8787/app/?token=a+b',
    );
  });

  it('远程 / 非 http / 空 token 明确拒绝，不返回假入口', () => {
    for (const base of ['http://192.168.1.3:8787', 'https://example.com', 'ws://127.0.0.1:8787']) {
      assert.throws(
        () => buildWebFrontendEndpoint(base, 'abc'),
        (error: unknown) =>
          error instanceof WebFrontendError &&
          error.code === 'unsupported' &&
          /loopback|http/.test(error.message),
      );
    }
    assert.throws(
      () => buildWebFrontendEndpoint('http://127.0.0.1:8787', '   '),
      (error: unknown) => error instanceof WebFrontendError && error.code === 'bad_request',
    );
  });

  it('只认 loopback 地址（含 ::ffff: 与 zone id）', () => {
    for (const host of ['localhost', '127.0.0.1', '127.8.9.10', '::1', '[::1]']) {
      assert.equal(isLoopbackHost(host), true, host);
    }
    for (const host of ['192.168.1.2', '10.0.0.1', '127.0.0.999', 'example.com']) {
      assert.equal(isLoopbackHost(host), false, host);
    }
    assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
    assert.equal(isLoopbackAddress('::1%lo0'), true);
    assert.equal(isLoopbackAddress('192.168.1.7'), false);
    assert.equal(isLoopbackAddress(null), false);
  });
});

describe('WebView 注入脚本', () => {
  it('启动时把目标会话写进官方前端的 localStorage key', () => {
    const script = buildWebSessionBootstrap('session-abc');
    assert.match(script, new RegExp(WEB_SESSION_STORAGE_KEY.replace(/\./g, '\\.')));
    assert.match(script, /var target = "session-abc"/);
    assert.match(script, /Storage\.prototype\.setItem/);
    assert.match(script, /__dshPalmWebBridge/);
  });

  it('非法会话 id 不注入；脚本里的 < 被转义', () => {
    assert.equal(normalizeWebSessionId('a b'), null);
    assert.equal(normalizeWebSessionId(''), null);
    assert.equal(normalizeWebSessionId('x'.repeat(257)), null);
    const script = buildWebSessionBootstrap('</script>');
    assert.doesNotMatch(script, /<\/script>/);
    assert.match(script, /\\u003c/);
  });

  it('隐藏/显示只切换观察器，不重载页面', () => {
    assert.match(buildWebBridgeControlScript('stop'), /\.stop\(\)/);
    assert.match(buildWebBridgeControlScript('start'), /\.start\(\)/);
  });
});

describe('深链解析', () => {
  it('dshpalm://session 支持 query / path / engine', () => {
    assert.deepEqual(parseWebSessionDeepLink('dshpalm://session?sessionId=session-1'), {
      kind: 'web-session',
      sessionId: 'session-1',
      engine: 'full',
    });
    assert.deepEqual(parseWebSessionDeepLink('dshpalm://session/session-2?engine=light'), {
      kind: 'web-session',
      sessionId: 'session-2',
      engine: 'light',
    });
    assert.deepEqual(parseWebSessionDeepLink('dshpalm://chat?id=session-3'), {
      kind: 'web-session',
      sessionId: 'session-3',
      engine: 'full',
    });
  });

  it('缺 id / 非法 engine / 其他 scheme 不认', () => {
    assert.equal(parseWebSessionDeepLink('dshpalm://session?sessionId='), null);
    assert.equal(parseWebSessionDeepLink('dshpalm://session?sessionId=x&engine=proot'), null);
    assert.equal(parseWebSessionDeepLink('dshpalm://pair?code=123456'), null);
    assert.equal(parseWebSessionDeepLink('https://example.com/session/1'), null);
    assert.equal(parseWebSessionDeepLink(null), null);
  });

  it('loopback 页面内的显式 session 链接也能回 RN；普通页面放行', () => {
    assert.deepEqual(parseLoopbackWebSessionLink('http://127.0.0.1:8787/?sessionId=session-9'), {
      kind: 'web-session',
      sessionId: 'session-9',
      engine: 'full',
    });
    assert.deepEqual(parseLoopbackWebSessionLink('http://127.0.0.1:8787/session/session-9'), {
      kind: 'web-session',
      sessionId: 'session-9',
      engine: 'full',
    });
    assert.equal(parseLoopbackWebSessionLink('http://127.0.0.1:8787/'), null);
    assert.equal(parseLoopbackWebSessionLink('https://example.com/session/1'), null);
    assert.equal(
      parseWebSessionNavigation('dshpalm://session?sessionId=session-4')?.sessionId,
      'session-4',
    );
  });

  it('WebView postMessage 防御性解析', () => {
    assert.deepEqual(parseWebViewBridgeMessage('{"type":"web-session","sessionId":"s1"}'), {
      type: 'web-session',
      sessionId: 's1',
    });
    assert.deepEqual(parseWebViewBridgeMessage({ type: 'bridge-ready' }), { type: 'bridge-ready' });
    assert.deepEqual(parseWebViewBridgeMessage('{"type":"web-deeplink","url":"dshpalm://session?id=s2"}'), {
      type: 'web-deeplink',
      url: 'dshpalm://session?id=s2',
    });
    assert.equal(parseWebViewBridgeMessage('not json'), null);
    assert.equal(parseWebViewBridgeMessage('{"type":"web-session","sessionId":"a b"}'), null);
  });
});

describe('WebView 错误与生命周期', () => {
  it('401 / 连接拒绝 / 超时都给人话', () => {
    assert.match(describeWebViewError({ statusCode: 401 }), /token 已失效/);
    assert.match(describeWebViewError({ description: 'net::ERR_CONNECTION_REFUSED' }), /连接被拒绝/);
    assert.match(describeWebViewError({ description: 'net::ERR_TIMED_OUT' }), /超时/);
    assert.match(describeWebViewError({ statusCode: 502 }), /HTTP 502/);
  });

  it('生命周期：加载完成、后台暂停、恢复、错误不被迟到的 onLoadEnd 洗掉', () => {
    let state: WebSurfaceLifecycleState = initialWebSurfaceLifecycle();
    assert.equal(state.status, 'loading');
    assert.equal(state.visible, true);

    state = reduceWebSurfaceLifecycle(state, { type: 'loaded' });
    assert.equal(state.status, 'ready');

    state = reduceWebSurfaceLifecycle(state, { type: 'hide' });
    assert.equal(state.visible, false);
    state = reduceWebSurfaceLifecycle(state, { type: 'show' });
    assert.equal(state.visible, true);

    state = reduceWebSurfaceLifecycle(state, { type: 'failed', error: 'token 已失效' });
    assert.equal(state.status, 'error');
    state = reduceWebSurfaceLifecycle(state, { type: 'loaded' });
    assert.equal(state.status, 'error');
    assert.equal(state.error, 'token 已失效');

    const beforeRetry = state.generation;
    state = reduceWebSurfaceLifecycle(state, { type: 'retry' });
    assert.equal(state.status, 'loading');
    assert.equal(state.error, null);
    assert.equal(state.generation, beforeRetry + 1);
  });

  it('打开新页面会清掉上一轮错误', () => {
    let state = reduceWebSurfaceLifecycle(initialWebSurfaceLifecycle(), {
      type: 'failed',
      error: '旧错误',
    });
    state = reduceWebSurfaceLifecycle(state, { type: 'open' });
    assert.equal(state.status, 'loading');
    assert.equal(state.error, null);
    assert.equal(state.visible, true);
  });
});
