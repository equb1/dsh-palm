import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MISSING_TOOL_RESULT,
  closePendingToolCalls,
  sanitizeToolHistory,
} from '../app/src/engine/light/history';
import type { ChatMessage, ToolCall } from '../app/src/engine/light/types';

function call(id: string, name = 'bash'): ToolCall {
  return { id, type: 'function', function: { name, arguments: '{}' } };
}

test('缺失的 tool 结果会被补齐（用户中断场景）', () => {
  const history: ChatMessage[] = [
    { role: 'user', content: '找一下' },
    { role: 'assistant', content: null, tool_calls: [call('a'), call('b')] },
    { role: 'tool', tool_call_id: 'a', name: 'bash', content: 'ok' },
  ];
  const cleaned = sanitizeToolHistory(history);
  assert.equal(cleaned.length, 4);
  assert.equal(cleaned[2]!.tool_call_id, 'a');
  assert.equal(cleaned[3]!.tool_call_id, 'b');
  assert.equal(cleaned[3]!.content, MISSING_TOOL_RESULT);
});

test('中止时只补没有结果的调用，不重复已有的', () => {
  const history: ChatMessage[] = [
    { role: 'assistant', content: null, tool_calls: [call('a'), call('b')] },
    { role: 'tool', tool_call_id: 'a', name: 'bash', content: 'done' },
  ];
  closePendingToolCalls(history, [call('a'), call('b')]);
  assert.equal(history.length, 3);
  assert.equal(history.filter((m) => m.role === 'tool').length, 2);
});

test('孤立的 tool 消息会被丢弃，合法链保持顺序', () => {
  const history: ChatMessage[] = [
    { role: 'tool', tool_call_id: 'orphan', content: 'x' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: null, tool_calls: [call('a'), call('b')] },
    { role: 'tool', tool_call_id: 'b', name: 'bash', content: 'b-result' },
    { role: 'tool', tool_call_id: 'a', name: 'bash', content: 'a-result' },
    { role: 'assistant', content: 'done' },
  ];
  const cleaned = sanitizeToolHistory(history);
  assert.deepEqual(
    cleaned.map((m) => m.role),
    ['user', 'assistant', 'tool', 'tool', 'assistant'],
  );
  assert.equal(cleaned[2]!.tool_call_id, 'a');
  assert.equal(cleaned[3]!.tool_call_id, 'b');
});
