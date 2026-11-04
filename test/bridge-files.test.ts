/**
 * 完整引擎（proot）附件提示词：路径拼装、路径校验、saveOnly 文案（纯函数，不连桥）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FileRef } from '../app/src/protocol';
import {
  buildFileLines,
  buildProotFileLines,
  PROOT_WORKSPACE_ROOT,
  promptWithProotFiles,
} from '../engine/src/real/promptParts';

const MD: FileRef = {
  path: '/data/user/0/cool.cnb.dshpalm/files/workspace/uploads/abc-x.md',
  relPath: 'uploads/abc-x.md',
  name: 'x.md',
  displayName: '说明.md',
  mime: 'text/markdown',
  bytes: 1536,
  hash: 'abc',
};

const PDF: FileRef = {
  path: '/data/user/0/cool.cnb.dshpalm/files/workspace/uploads/def-合同.pdf',
  relPath: 'uploads/def-合同.pdf',
  name: '合同.pdf',
  mime: 'application/pdf',
  bytes: 12 * 1024,
};

describe('完整引擎 · 附件提示词', () => {
  it('拼出 /root/work/uploads 的路径行', () => {
    assert.deepEqual(buildFileLines([MD], PROOT_WORKSPACE_ROOT), [
      '- /root/work/uploads/abc-x.md (text/markdown, 1.5 KB, 未解析)',
    ]);
    assert.deepEqual(buildProotFileLines([MD]), buildFileLines([MD], '/root/work'));
    assert.deepEqual(buildFileLines([], '/root/work'), []);
    assert.deepEqual(buildFileLines(undefined, '/root/work'), []);
  });

  it('PDF 这类 saveOnly 格式标「未解析」', () => {
    assert.deepEqual(buildFileLines([PDF], '/root/work'), [
      '- /root/work/uploads/def-合同.pdf (application/pdf, 12 KB, 未解析)',
    ]);
  });

  it('.. / 绝对路径 / 非 uploads 目录 / 反斜杠一律拒绝', () => {
    const bad = [
      '../secret',
      'uploads/../secret',
      'uploads/../../secret',
      '/root/work/uploads/abc-x.md',
      'uploads/sub/abc-x.md',
      'etc/passwd',
      'uploads\\abc-x.md',
      'uploads/\0x.md',
      '',
    ];
    for (const relPath of bad) {
      assert.throws(
        () => buildFileLines([{ ...MD, relPath }], '/root/work'),
        (error: { code?: string }) => error.code === 'bad_request',
        relPath,
      );
    }
  });

  it('普通文件名里的连续点不算路径穿越', () => {
    const lines = buildFileLines([{ ...MD, relPath: 'uploads/a..b.md' }], '/root/work');
    assert.deepEqual(lines, ['- /root/work/uploads/a..b.md (text/markdown, 1.5 KB, 未解析)']);
  });

  it('正文里附件清单在前，没有正文时只发清单', () => {
    assert.equal(
      promptWithProotFiles('看看这个', [MD]),
      '[附件]\n- /root/work/uploads/abc-x.md (text/markdown, 1.5 KB, 未解析)\n\n看看这个',
    );
    assert.equal(
      promptWithProotFiles('', [MD]),
      '[附件]\n- /root/work/uploads/abc-x.md (text/markdown, 1.5 KB, 未解析)',
    );
    assert.equal(promptWithProotFiles('', undefined), '');
  });
});
