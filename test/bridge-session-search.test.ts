import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Turn } from '../app/src/protocol';
import { buildSessionSearchText, matchSessionText } from '../engine/src/real/sessionSearch';

const turns: Turn[] = [
  {
    id: 'u1',
    role: 'user',
    createdAt: 1,
    status: 'done',
    blocks: [{ kind: 'text', id: 'u1-b1', text: '请检查 Python 文档库版本' }],
  },
  {
    id: 'a1',
    role: 'assistant',
    createdAt: 2,
    status: 'done',
    blocks: [
      { kind: 'thinking', id: 'a1-b1', text: '先跑 python3 -c ...' },
      { kind: 'text', id: 'a1-b2', text: '当前 Python 是 3.12.3' },
      {
        kind: 'tool',
        id: 'a1-t1',
        name: 'bash',
        callId: 'c1',
        summary: 'python3 --version',
        state: 'done',
      },
    ],
  },
];

describe('真引擎正文搜索', () => {
  it('标题/用户正文/思考/回复都能命中，大小写不敏感', () => {
    const text = buildSessionSearchText('Python 环境检查', turns);
    assert.ok(text.includes('Python 环境检查'));
    assert.ok(text.includes('python3 -c'));
    const hit = matchSessionText(text, 'PYTHON');
    assert.ok(hit);
    assert.equal(hit.matches, 4);
    assert.ok(hit.snippet.length <= 140);
  });

  it('片段压缩空白，未命中返回 null', () => {
    const text = `标题\n${'x'.repeat(60)}  命中词   后面`;
    const hit = matchSessionText(text, '命中词');
    assert.ok(hit);
    assert.equal(hit.snippet.includes('  '), false);
    assert.equal(matchSessionText(text, '不存在'), null);
  });

  it('空搜索词不命中（由协议层负责报错）', () => {
    assert.equal(matchSessionText('abc', '   '), null);
  });
});
