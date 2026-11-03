import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { NodeBackend } from '../app/src/engine/fs/nodeBackend';
import { SandboxFs } from '../app/src/engine/fs/sandbox';
import { normalizePath } from '../app/src/engine/fs/path';
import {
  ExpoBackend,
  type ExpoDirRef,
  type ExpoFileRef,
  type ExpoFsApi,
} from '../app/src/engine/fs/expoBackend';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-palm-fs-'));
  roots.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe('path', () => {
  it('chroot 式规范化：.. 到根停住，越不出去', () => {
    assert.equal(normalizePath('/a/../b'), '/b');
    assert.equal(normalizePath('../../etc/passwd'), '/etc/passwd');
    assert.equal(normalizePath('/a//b/./c'), '/a/b/c');
    assert.equal(normalizePath('/'), '/');
  });
});

describe('SandboxFs + NodeBackend', () => {
  it('读写文本/字节，落到真实目录', async () => {
    const root = await tempRoot();
    const fs = new SandboxFs({ backend: new NodeBackend({ root }) });
    await fs.ensureRoot();
    await fs.mkdir('/notes', { recursive: true });

    await fs.writeFile('/notes/a.md', '# hello\n');
    assert.equal(await fs.readFile('/notes/a.md'), '# hello\n');
    assert.equal(await readFile(join(root, 'notes/a.md'), 'utf8'), '# hello\n');

    const bytes = await fs.readFileBuffer('/notes/a.md');
    assert.equal(Buffer.from(bytes).toString('utf8'), '# hello\n');

    // binary 编码按 latin1 一个字符一个字节
    await fs.writeFile('/bin.dat', Uint8Array.from([0x00, 0xff, 0x41]));
    assert.equal(await fs.readFile('/bin.dat', 'binary'), '\u0000\u00ffA');
    assert.equal(await fs.readFile('/bin.dat', 'hex'), '00ff41');
  });

  it('路径只能落在工作区里', async () => {
    const root = await tempRoot();
    const fs = new SandboxFs({ backend: new NodeBackend({ root }) });
    await fs.ensureRoot();
    await fs.writeFile('/a.txt', 'x');
    // ../../etc/passwd 被规范化成 /etc/passwd（工作区里的 etc/），不是宿主的 /etc
    await assert.rejects(fs.readFile('../../etc/passwd'), /ENOENT/);
    assert.equal(await fs.exists('/a.txt'), true);
  });

  it('mkdir / readdir / readdirWithFileTypes / rm 的错误码', async () => {
    const root = await tempRoot();
    const fs = new SandboxFs({ backend: new NodeBackend({ root }) });
    await fs.ensureRoot();

    await fs.mkdir('/a/b', { recursive: true });
    await fs.writeFile('/a/b/c.txt', 'c');
    assert.deepEqual((await fs.readdir('/a')).sort(), ['b']);
    const entries = await fs.readdirWithFileTypes('/a/b');
    assert.deepEqual(entries, [{ name: 'c.txt', isFile: true, isDirectory: false, isSymbolicLink: false }]);

    await assert.rejects(fs.mkdir('/a'), /EEXIST/);
    await assert.rejects(fs.mkdir('/x/y'), /ENOENT/);
    await assert.rejects(fs.rm('/a'), /EISDIR/);
    await assert.rejects(fs.readdir('/a/b/c.txt'), /ENOTDIR/);
    await assert.rejects(fs.readFile('/a'), /EISDIR/);
    await assert.rejects(fs.readFile('/nope'), /ENOENT/);
    await assert.rejects(fs.stat('/nope'), /ENOENT/);

    await fs.rm('/a/b', { recursive: true });
    assert.equal(await fs.exists('/a/b'), false);
    await fs.rm('/nope', { force: true });
    await assert.rejects(fs.rm('/nope'), /ENOENT/);
  });

  it('cp / mv：目标是目录时落到目录里面', async () => {
    const root = await tempRoot();
    const fs = new SandboxFs({ backend: new NodeBackend({ root }) });
    await fs.ensureRoot();
    await fs.mkdir('/dst', { recursive: true });
    await fs.writeFile('/a.txt', 'a');

    await fs.cp('/a.txt', '/dst');
    assert.equal(await fs.readFile('/dst/a.txt'), 'a');
    await fs.mv('/dst/a.txt', '/dst/b.txt');
    assert.equal(await fs.readFile('/dst/b.txt'), 'a');
    assert.equal(await fs.exists('/dst/a.txt'), false);

    // 目录不带 recursive 不能 cp
    await fs.mkdir('/dir/sub', { recursive: true });
    await assert.rejects(fs.cp('/dir', '/dir2'), /EISDIR/);
    await fs.cp('/dir', '/dir2', { recursive: true });
    assert.equal(await fs.exists('/dir2/sub'), true);
  });

  it('chmod / utimes 是内存覆盖层：不碰真机，stat 能看见', async () => {
    const root = await tempRoot();
    const fs = new SandboxFs({ backend: new NodeBackend({ root }) });
    await fs.ensureRoot();
    await fs.writeFile('/x.txt', 'x');

    await fs.chmod('/x.txt', 0o600);
    await fs.utimes('/x.txt', new Date(0), new Date(1_700_000_000_000));
    const stat = await fs.stat('/x.txt');
    assert.equal(stat.mode, 0o600);
    assert.equal(stat.mtime.getTime(), 1_700_000_000_000);
    assert.equal(stat.isFile, true);

    await assert.rejects(fs.chmod('/nope', 0o600), /ENOENT/);
  });

  it('软链/硬链明确不支持，而不是假装成功', async () => {
    const root = await tempRoot();
    const fs = new SandboxFs({ backend: new NodeBackend({ root }) });
    await fs.ensureRoot();
    await assert.rejects(fs.symlink('/a', '/b'), /EPERM/);
    await assert.rejects(fs.link('/a', '/b'), /EPERM/);
    await assert.rejects(fs.readlink('/a'), /EINVAL/);
  });

  it('只读沙箱拒绝写入', async () => {
    const root = await tempRoot();
    const fs = new SandboxFs({ backend: new NodeBackend({ root }), readOnly: true });
    await fs.ensureRoot();
    await assert.rejects(fs.writeFile('/a.txt', 'x'), /EACCES/);
    await assert.rejects(fs.mkdir('/d'), /EACCES/);
    assert.equal(await fs.exists('/a.txt'), false);
  });

  it('超过读取上限报 EFBIG', async () => {
    const root = await tempRoot();
    await writeFile(join(root, 'big.bin'), Buffer.alloc(2048));
    const fs = new SandboxFs({ backend: new NodeBackend({ root }), maxFileReadSize: 1024 });
    await assert.rejects(fs.readFile('/big.bin'), /EFBIG/);
  });

  it('createExclusive 不允许覆盖已有文件', async () => {
    const root = await tempRoot();
    const fs = new SandboxFs({ backend: new NodeBackend({ root }) });
    await fs.ensureRoot();
    await fs.createExclusive('/t.txt', { mode: 0o600 });
    assert.equal((await fs.stat('/t.txt')).mode, 0o600);
    await assert.rejects(fs.createExclusive('/t.txt', { mode: 0o600 }), /EEXIST/);
    await fs.createExclusive('/d', { mode: 0o700, directory: true });
    assert.equal((await fs.stat('/d')).isDirectory, true);
  });

  it('refreshIndex 之后 getAllPaths 能拿到全量路径', async () => {
    const root = await tempRoot();
    const fs = new SandboxFs({ backend: new NodeBackend({ root }) });
    await fs.ensureRoot();
    await fs.mkdir('/a/b', { recursive: true });
    await fs.writeFile('/a/b/c.txt', 'c');
    const before = fs.getAllPaths();
    assert.deepEqual(before, []);
    const paths = await fs.refreshIndex();
    assert.ok(paths.includes('/a'));
    assert.ok(paths.includes('/a/b/c.txt'));
  });
});

/* ------------------------------------------------------------------ *
 * 假 expo：把「相对路径 + 原生调用」的映射单独测一遍
 * ------------------------------------------------------------------ */

function fakeExpoApi(): { api: ExpoFsApi; files: Map<string, Uint8Array>; dirs: Set<string> } {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(['']);
  const key = (segments: string[]): string => segments.join('/');
  const parentOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

  const fileRef = (segments: string[]): ExpoFileRef => {
    const path = key(segments);
    return {
      get exists() {
        return files.has(path);
      },
      get size() {
        return files.get(path)?.length ?? 0;
      },
      lastModified: 1_700_000_000_000,
      async readText() {
        const bytes = files.get(path);
        if (!bytes) throw new Error(`ENOENT: no such file: ${path}`);
        return new TextDecoder().decode(bytes);
      },
      async readBytes() {
        const bytes = files.get(path);
        if (!bytes) throw new Error(`ENOENT: no such file: ${path}`);
        return bytes;
      },
      async write(content) {
        const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
        files.set(path, bytes);
      },
      info: () => ({ exists: files.has(path), size: files.get(path)?.length ?? 0 }),
      delete() {
        if (!files.delete(path)) throw new Error(`ENOENT: no such file: ${path}`);
      },
      async copy(destination) {
        const target = (destination as ExpoFileRef & { __path: string }).__path;
        const bytes = files.get(path);
        if (!bytes) throw new Error(`ENOENT: no such file: ${path}`);
        files.set(target, bytes.slice());
      },
      async move(destination) {
        const target = (destination as ExpoFileRef & { __path: string }).__path;
        const bytes = files.get(path);
        if (!bytes) throw new Error(`ENOENT: no such file: ${path}`);
        files.delete(path);
        files.set(target, bytes);
      },
    };
  };

  const dirRef = (segments: string[]): ExpoDirRef => {
    const path = key(segments);
    return {
      get exists() {
        return dirs.has(path);
      },
      size: 0,
      info: () => ({ exists: dirs.has(path), modificationTime: 1_700_000_000_000 }),
      list() {
        if (!dirs.has(path)) throw new Error(`ENOENT: no such directory: ${path}`);
        const prefix = path === '' ? '' : `${path}/`;
        const names = new Set<string>();
        for (const dir of dirs) {
          if (dir !== path && dir.startsWith(prefix)) names.add(dir.slice(prefix.length).split('/')[0] as string);
        }
        for (const file of files.keys()) {
          if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split('/')[0] as string);
        }
        return [...names].map((name) => {
          const child = prefix + name;
          return { name, isDirectory: dirs.has(child) };
        });
      },
      create(options) {
        if (dirs.has(path)) {
          if (options?.intermediates) return;
          throw new Error(`EEXIST: directory exists: ${path}`);
        }
        if (options?.intermediates) {
          let cursor = '';
          for (const part of path.split('/').filter(Boolean)) {
            cursor = cursor === '' ? part : `${cursor}/${part}`;
            dirs.add(cursor);
          }
        } else {
          if (!dirs.has(parentOf(path)) && path !== '') throw new Error(`ENOENT: parent missing: ${path}`);
          dirs.add(path);
        }
      },
      delete() {
        if (!dirs.has(path)) throw new Error(`ENOENT: no such directory: ${path}`);
        const prefix = path === '' ? '' : `${path}/`;
        for (const dir of [...dirs]) if (dir === path || dir.startsWith(prefix)) dirs.delete(dir);
        for (const file of [...files.keys()]) if (file.startsWith(prefix)) files.delete(file);
      },
      async copy(destination) {
        const target = (destination as ExpoDirRef & { __path: string }).__path;
        const prefix = path === '' ? '' : `${path}/`;
        for (const dir of [...dirs]) if (dir === path || dir.startsWith(prefix)) dirs.add(target + dir.slice(path.length));
        for (const [file, bytes] of [...files]) {
          if (file.startsWith(prefix) || file === path) files.set(target + file.slice(path.length), bytes.slice());
        }
      },
      async move(destination) {
        await dirRef(segments).copy(destination);
        dirRef(segments).delete();
      },
    };
  };

  // 让 copy/move 拿到目标路径：包一层 __path
  const withPath = <T extends object>(ref: T, path: string): T => Object.assign(ref, { __path: path });

  return {
    files,
    dirs,
    api: {
      rootLabel: 'file:///fake/workspace',
      file: (segments) => withPath(fileRef(segments), key(segments)),
      dir: (segments) => withPath(dirRef(segments), key(segments)),
    },
  };
}

describe('ExpoBackend（假 expo）', () => {
  it('路径映射与读写都走相对路径', async () => {
    const { api, files } = fakeExpoApi();
    const backend = new ExpoBackend({ api });
    await backend.ensureRoot();
    await backend.mkdir('notes', { recursive: true });
    await backend.write('notes/a.md', '# hi');
    assert.equal(await backend.readText('notes/a.md'), '# hi');
    assert.deepEqual(files.get('notes/a.md') && new TextDecoder().decode(files.get('notes/a.md')!), '# hi');
    assert.deepEqual(await backend.stat('notes/a.md'), {
      type: 'file',
      size: 4,
      mtime: 1_700_000_000_000,
    });
    assert.deepEqual(await backend.stat('notes'), { type: 'dir', size: 0, mtime: 1_700_000_000_000 });
    assert.equal(await backend.stat('nope'), null);
  });

  it('copy / move 解包目标，目录递归', async () => {
    const { api } = fakeExpoApi();
    const backend = new ExpoBackend({ api });
    await backend.ensureRoot();
    await backend.mkdir('a/b', { recursive: true });
    await backend.write('a/b/c.txt', 'c');
    await backend.copy('a', 'a2', { recursive: true });
    assert.equal(await backend.readText('a2/b/c.txt'), 'c');
    await backend.move('a2/b/c.txt', 'a2/d.txt');
    assert.equal(await backend.readText('a2/d.txt'), 'c');
    assert.equal(await backend.stat('a2/b/c.txt'), null);
  });
});
