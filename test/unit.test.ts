/**
 * 单元测试：协议判别 + 真引擎事件投影。
 * 这些是纯函数，不连网络、不碰原生。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { eventSessionId, isEvent, isResponse, PROTOCOL_VERSION } from '../app/src/protocol';
import { projectRecords, titleFromRecords, type RealRecord } from '../engine/src/real/project';

test('协议版本与事件/响应判别', () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.equal(isEvent({ type: 'event', v: 1, event: 'session.updated', seq: 1, data: {} } as never), true);
  assert.equal(isEvent({ type: 'res', v: 1, id: 'x', ok: true, result: {} } as never), false);
  assert.equal(isResponse({ type: 'res', v: 1, id: 'x', ok: true, result: {} } as never), true);
});

test('eventSessionId 兼容直接字段与嵌套 session.id', () => {
  assert.equal(eventSessionId({ sessionId: 'a' }), 'a');
  assert.equal(eventSessionId({ session: { id: 'b' } }), 'b');
  assert.equal(eventSessionId({ foo: 1 }), undefined);
});

test('标题取最后一条 session/title', () => {
  const records = [
    { event: { type: 'session/title', data: { title: '旧标题' } } },
    { event: { type: 'session/title', data: { title: ' 新标题 ' } } },
  ] as RealRecord[];
  assert.equal(titleFromRecords(records), '新标题');
  assert.equal(titleFromRecords([]), null);
});

test('用户消息投影成回合，系统注入的 user/message 被忽略', () => {
  const records = [
    {
      event: {
        type: 'user/message',
        time: 1,
        data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] },
      },
    },
    {
      event: {
        type: 'user/message',
        time: 2,
        data: { id: 'u2', source: { kind: 'runtime' }, content: [{ type: 'text', text: '系统注入' }] },
      },
    },
  ] as RealRecord[];
  const projection = projectRecords(records);
  assert.equal(projection.turns.length, 1);
  assert.equal(projection.turns[0]!.role, 'user');
  assert.equal(projection.turns[0]!.status, 'done');
});
