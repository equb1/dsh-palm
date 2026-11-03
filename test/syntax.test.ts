import assert from 'node:assert/strict';
import test from 'node:test';

import { highlight } from '../app/src/ui/syntax';

test('JS：关键字/字符串/注释/数字/函数名被识别，且文本可拼回', () => {
  const code = [
    '// hello',
    'const x = 42;',
    'function add(a, b) { return a + b; }',
    'const s = "ok";',
  ].join('\n');
  const tokens = highlight(code, 'ts');
  const kinds = new Set(tokens.map((t) => t.kind));
  assert.ok(kinds.has('comment'));
  assert.ok(kinds.has('keyword'));
  assert.ok(kinds.has('number'));
  assert.ok(kinds.has('function'));
  assert.ok(kinds.has('string'));
  assert.equal(tokens.map((t) => t.text).join(''), code);
});

test('Python / Bash / JSON 有基本着色', () => {
  assert.ok(highlight('def f():\n  return "x" # c', 'python').some((t) => t.kind === 'keyword'));
  assert.ok(highlight('echo $HOME # c', 'bash').some((t) => t.kind === 'property'));
  assert.ok(highlight('{"a": 1, "b": true}', 'json').some((t) => t.kind === 'property'));
});

test('未知语言原样返回', () => {
  const tokens = highlight('some ??? text', 'brainfuck');
  assert.deepEqual(tokens, [{ text: 'some ??? text', kind: 'plain' }]);
});
