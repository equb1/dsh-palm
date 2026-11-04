/**
 * 文件名 / 沙箱路径边界（P0 1.5）。
 *
 * 覆盖中文、空格、# % ? : 控制字符、emoji、超长、`..`、空名，以及
 * create_docx / create_xlsx 真正落盘后的磁盘名和读回。
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  mimeForKey,
  sanitizeFileName,
  sanitizeSandboxPath,
} from '../app/src/lib/filenames';
import { NodeBackend } from '../app/src/engine/fs/nodeBackend';
import { createWorkspaceMount } from '../app/src/engine/fs/mount';
import { ShellRunner } from '../app/src/engine/shell/bash';
import { toolByName } from '../app/src/engine/light/tools';
import type { ToolContext } from '../app/src/engine/light/types';

const roots: string[] = [];

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function context(): Promise<{ ctx: ToolContext; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-palm-names-'));
  roots.push(root);
  const mount = await createWorkspaceMount({ backend: new NodeBackend({ root }) });
  const ctx: ToolContext = {
    fs: mount.workspace,
    bash: new ShellRunner({ fs: mount.fs }),
    permission: 'workspace-write',
    signal: new AbortController().signal,
    requestApproval: async () => 'approve',
    askUser: async () => ({ id: 'q', selected: [] }),
  };
  return { ctx, root };
}

describe('sanitizeFileName', () => {
  it('中文 + 空格 + #/% 保留可读部分', () => {
    assert.equal(sanitizeFileName('周会 纪要 #1 100%.md'), '周会 纪要 _1 100_.md');
  });

  it('其余特殊字符与路径分隔符都换成下划线', () => {
    assert.equal(
      sanitizeFileName('a#b%c:d*e?f"g<h>i|j.md'),
      'a_b_c_d_e_f_g_h_i_j.md',
    );
    // 路径只取最后一段
    assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
    assert.equal(sanitizeFileName('docs\\会议纪要.txt'), '会议纪要.txt');
  });

  it('控制字符 / emoji 不会进文件名', () => {
    assert.equal(sanitizeFileName('a\u0000b\u001fc.txt'), 'a_b_c.txt');
    assert.equal(sanitizeFileName('会议😀纪要.txt'), '会议_纪要.txt');
  });

  it('300 字符：主名按码点截到 80，扩展名保留', () => {
    const name = sanitizeFileName(`${'a'.repeat(300)}.md`);
    assert.equal(name, `${'a'.repeat(80)}.md`);
    assert.equal([...name.split('.')[0] ?? ''].length, 80);

    const chinese = sanitizeFileName(`${'会'.repeat(300)}.docx`);
    assert.equal([...(chinese.split('.')[0] ?? '')].length, 80);
    assert.match(chinese, /\.docx$/);
  });

  it('空名 / 只有点 / `..` 回退 file-<ts>，可带 mime 扩展名', () => {
    assert.match(sanitizeFileName(''), /^file-\d+$/);
    assert.match(sanitizeFileName('...'), /^file-\d+$/);
    assert.match(sanitizeFileName('..'), /^file-\d+$/);
    assert.match(sanitizeFileName('', { mime: 'image/jpeg' }), /^file-\d+\.jpg$/);
    assert.match(sanitizeFileName('', { fallback: '未命名' }), /^未命名$/);
  });

  it('NFC 归一化（组合字符不拆成两个）', () => {
    assert.equal(sanitizeFileName('e\u0301.txt'), 'é.txt');
  });

  it('mimeForKey 认常见扩展名', () => {
    assert.equal(
      mimeForKey('docx'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    assert.equal(mimeForKey('.PNG'), 'image/png');
    assert.equal(mimeForKey('nope'), '');
  });
});

describe('sanitizeSandboxPath', () => {
  it('目录与文件名都 sanitize，扩展名只补一次', () => {
    assert.equal(
      sanitizeSandboxPath('docs/会议 纪要 #1 100%', '.docx', 'docs'),
      '/docs/会议 纪要 _1 100_.docx',
    );
    assert.equal(
      sanitizeSandboxPath('/workspace/docs/会议 纪要 #1 100%', '.docx', 'docs'),
      '/docs/会议 纪要 _1 100_.docx',
    );
  });

  it('冲突扩展名替换而不是叠加', () => {
    assert.equal(sanitizeSandboxPath('docs/报告.txt', '.docx', 'docs'), '/docs/报告.docx');
    assert.equal(sanitizeSandboxPath('docs/报告.docx', '.docx', 'docs'), '/docs/报告.docx');
    assert.equal(sanitizeSandboxPath('docs/a.docx.txt', '.docx', 'docs'), '/docs/a.docx');
    // 图片按真实 MIME 替换：模型写 .png，实际是 jpeg
    assert.equal(sanitizeSandboxPath('images/cat.png', '.jpg', 'images'), '/images/cat.jpg');
  });

  it('空路径 / 穿越路径回退到 fallbackDir，且不逃出工作区', () => {
    assert.match(sanitizeSandboxPath('', '.docx', 'docs'), /^\/docs\/file-\d+\.docx$/);
    assert.match(sanitizeSandboxPath('..', '.docx', 'docs'), /^\/docs\/file-\d+\.docx$/);
    assert.match(sanitizeSandboxPath('docs/', '.docx', 'docs'), /^\/docs\/file-\d+\.docx$/);
    assert.equal(
      sanitizeSandboxPath('../../etc/passwd', '.docx', 'docs'),
      '/etc/passwd.docx',
    );
  });
});

describe('生成工具落盘：中文/空格/#/% 路径', () => {
  it('create_docx 用 sanitize 后的名字，磁盘可读回', async () => {
    const { ctx, root } = await context();
    const create = toolByName('create_docx');
    const read = toolByName('read_docx');
    assert.ok(create && read);

    const approval = create.describeApproval?.({
      path: 'docs/会议 纪要 #1 100%',
      blocks: [{ type: 'paragraph', text: 'x' }],
    });
    assert.match(approval?.command ?? '', /\/workspace\/docs\/会议 纪要 _1 100_\.docx/);

    const created = await create.execute(
      {
        path: 'docs/会议 纪要 #1 100%',
        title: '会议纪要',
        blocks: [
          { type: 'heading', text: '结论', level: 2 },
          { type: 'paragraph', text: '下周上线灰度。' },
        ],
      },
      ctx,
    );
    assert.match(created, /已生成 Word 文档 \/workspace\/docs\/会议 纪要 _1 100_\.docx/);

    const onDisk = join(root, 'docs', '会议 纪要 _1 100_.docx');
    assert.equal(existsSync(onDisk), true);
    assert.equal((await readFile(onDisk)).subarray(0, 2).toString('utf8'), 'PK');

    const saved = await read.execute({ path: 'docs/会议 纪要 _1 100_.docx' }, ctx);
    assert.match(saved, /下周上线灰度/);
  });

  it('create_xlsx 同样 sanitize；冲突扩展名被替换', async () => {
    const { ctx, root } = await context();
    const create = toolByName('create_xlsx');
    const read = toolByName('read_xlsx');
    assert.ok(create && read);

    const created = await create.execute(
      {
        path: 'docs/会议 纪要 #1 100%.txt',
        sheets: [{ name: '11 月', rows: [['项目', '金额'], ['打车', 56.5]] }],
      },
      ctx,
    );
    assert.match(created, /已生成 Excel \/workspace\/docs\/会议 纪要 _1 100_\.xlsx/);
    assert.equal(existsSync(join(root, 'docs', '会议 纪要 _1 100_.xlsx')), true);

    const saved = await read.execute({ path: 'docs/会议 纪要 _1 100_.xlsx' }, ctx);
    assert.match(saved, /打车 \| 56\.5/);
  });
});
