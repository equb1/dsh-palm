import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  deleteWorkspace,
  listWorkspace,
  normalizeWorkspacePath,
  renameWorkspace,
} from '../engine/src/real/workspaceFs';

let root = '';

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-real-workspace-'));
  await mkdir(join(root, 'docs'), { recursive: true });
  await mkdir(join(root, 'uploads'), { recursive: true });
  await writeFile(join(root, 'docs', 'weekly.docx'), 'weekly');
  await writeFile(join(root, 'uploads', 'note.txt'), 'hello');
  await writeFile(join(root, 'README.md'), 'root');
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('完整引擎 · 工作区文件接口（U8）', () => {
  it('列根目录：目录在前、文件在后，带大小/mtime', async () => {
    const result = await listWorkspace(root, '/');
    assert.equal(result.path, '/');
    assert.deepEqual(
      result.entries.map((entry) => `${entry.kind}:${entry.name}`),
      ['dir:docs', 'dir:uploads', 'file:README.md'],
    );
    const readme = result.entries.find((entry) => entry.name === 'README.md');
    assert.equal(readme?.size, 4);
    assert.ok((readme?.mtime ?? 0) > 0);
  });

  it('列子目录、改名、删除', async () => {
    const docs = await listWorkspace(root, '/docs');
    assert.deepEqual(docs.entries.map((entry) => entry.name), ['weekly.docx']);

    await renameWorkspace(root, '/docs/weekly.docx', '/docs/weekly-2.docx');
    assert.deepEqual((await readdir(join(root, 'docs'))).sort(), ['weekly-2.docx']);

    await deleteWorkspace(root, '/docs');
    assert.deepEqual((await readdir(root)).sort(), ['README.md', 'uploads']);
  });

  it('拒绝路径穿越 / 根目录改名删除 / 非目录', async () => {
    await assert.rejects(
      () => listWorkspace(root, '/../etc'),
      (error: unknown) => (error as { code?: string }).code === 'bad_request',
    );
    await assert.rejects(
      () => renameWorkspace(root, '/', '/x'),
      (error: unknown) => (error as { code?: string }).code === 'bad_request',
    );
    await assert.rejects(
      () => deleteWorkspace(root, '/'),
      (error: unknown) => (error as { code?: string }).code === 'bad_request',
    );
    await assert.rejects(
      () => listWorkspace(root, '/README.md'),
      (error: unknown) => (error as { code?: string }).code === 'bad_request',
    );
    assert.equal(normalizeWorkspacePath('/uploads/note.txt'), '/uploads/note.txt');
  });

  it('软链不跟随、不出现在列表里', async (t) => {
    try {
      await symlink('/etc/hosts', join(root, 'uploads', 'outside-link'));
    } catch (error) {
      const code = (error as { code?: string }).code;
      // Windows 默认没有创建软链的权限；这是环境限制，不是列表逻辑失败。
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') {
        t.skip(`当前环境不能创建软链（${code}）`);
        return;
      }
      throw error;
    }
    const result = await listWorkspace(root, '/uploads');
    assert.equal(result.entries.some((entry) => entry.name === 'outside-link'), false);
  });
});
