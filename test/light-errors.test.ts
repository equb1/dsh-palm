/**
 * 1.5：模型 HTTP 错误的人话化。
 *
 * 真机 401 时服务端返回 `{"error":{"message":"Authentication Fails (governor)"}}`，
 * 之前整段 JSON 直接进横幅；现在只取 error.message / message。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeHttpError } from '../app/src/engine/light/provider';

describe('light · HTTP 错误人话化', () => {
  it('401 的 JSON error.message 只取人话，不带 JSON 外壳', () => {
    const message = describeHttpError(
      401,
      'Unauthorized',
      '{"error":{"message":"Authentication Fails (governor)","type":"authentication_error"}}',
    );
    assert.match(message, /登录或 API Key 无效\/已过期（401）/);
    assert.match(message, /Authentication Fails \(governor\)/);
    assert.equal(message.includes('{"error"'), false);
  });

  it('纯文本 body 原样保留，空 body 不加冒号', () => {
    assert.match(describeHttpError(429, 'Too Many Requests', 'rate limit exceeded'), /rate limit exceeded/);
    assert.equal(describeHttpError(500, 'Internal Server Error'), '模型服务异常（500 Internal Server Error）');
  });

  it('message 字段和顶层 error 字符串也兼容', () => {
    assert.match(describeHttpError(400, 'Bad Request', '{"message":"model not found"}'), /model not found/);
    assert.match(describeHttpError(403, 'Forbidden', '{"error":"nope"}'), /nope/);
  });
});
