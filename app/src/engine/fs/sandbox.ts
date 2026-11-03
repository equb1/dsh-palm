/**
 * SandboxFs —— 把「真实目录」适配成 just-bash 的 IFileSystem。
 *
 * 这是 docs/25 里那条「VFS 目前是 InMemoryFs；要落手机真实目录，还得实现
 * IFileSystem 适配器（下一步）」的落地：上层只认虚拟绝对路径，下层用
 * `FsBackend`（Node / expo-file-system）真读写目录，中间补齐 POSIX 语义：
 *
 *  - chroot 式路径（`..` 到根停住，永远越不出去）；
 *  - errno 形状的错误消息（just-bash 的命令靠它判断 ENOENT/ENOTEMPTY…）；
 *  - 权限位与 mtime 的内存覆盖层（手机文件系统没有 chmod/utimes）；
 *  - 软链不支持（真机上也没有），按 ReadWriteFs 的默认策略抛 EPERM；
 *  - 读取上限与遍历上限（防止一个 `cat` 把 1GB 文件读进 Hermes 堆）。
 *
 * 没有实现 `readFileBytes`（可选方法）：just-bash 内部会退回 readFileBuffer，
 * 这样就不用碰 ByteString 的 nominal 类型。
 */
import type { IFileSystem } from 'just-bash/browser';

import type { BackendEntry, FsBackend } from './backend';
import { decodeBytes, encodeText, type TextEncoding } from './encoding';
import {
  eacces,
  eexist,
  eisdir,
  einval,
  enoent,
  enotdir,
  eperm,
  toFsError,
} from './errors';
import { basename, dirname, joinPath, normalizePath, splitPath } from './path';

const DEFAULT_MAX_READ = 10 * 1024 * 1024;
const DEFAULT_INDEX_LIMIT = 20_000;
const INDEX_TTL_MS = 1_000;

export interface SandboxFsOptions {
  backend: FsBackend;
  /** 只读沙箱：所有写操作抛 EACCES（给 read-only 挂载用） */
  readOnly?: boolean;
  /** 单次读取上限，默认 10MB */
  maxFileReadSize?: number;
  /** getAllPaths 的扫描上限，默认 20000 个条目 */
  maxIndexEntries?: number;
  now?: () => number;
}

interface IndexSnapshot {
  at: number;
  paths: string[];
}

/** FsStat 的全部字段（just-bash 接口里 dev/ino 是可选扩展，这里不提供） */
export interface SandboxStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  mode: number;
  size: number;
  mtime: Date;
}

export class SandboxFs implements IFileSystem {
  readonly backend: FsBackend;
  private readonly readOnly: boolean;
  private readonly maxRead: number;
  private readonly indexLimit: number;
  private readonly now: () => number;
  /** 手机文件系统没有 chmod：权限位在内存里覆盖 */
  private readonly modes = new Map<string, number>();
  private readonly mtimes = new Map<string, number>();
  private index: IndexSnapshot | null = null;

  constructor(options: SandboxFsOptions) {
    this.backend = options.backend;
    this.readOnly = options.readOnly === true;
    this.maxRead = options.maxFileReadSize ?? DEFAULT_MAX_READ;
    this.indexLimit = options.maxIndexEntries ?? DEFAULT_INDEX_LIMIT;
    this.now = options.now ?? (() => Date.now());
  }

  get kind(): string {
    return this.backend.kind;
  }

  get rootLabel(): string {
    return this.backend.rootLabel;
  }

  /** 挂载到 MountableFs 时先建根目录 */
  async ensureRoot(): Promise<void> {
    await this.backend.ensureRoot?.();
  }

  /* ------------------------------------------------------------------ */

  resolvePath(base: string, path: string): string {
    return joinPath(base, path);
  }

  /* --------------------------- 读 --------------------------- */

  async readFile(
    path: string,
    options?: { encoding?: TextEncoding | null } | TextEncoding,
  ): Promise<string> {
    const virtual = normalizePath(path);
    const bytes = await this.readFileBuffer(virtual);
    const encoding = typeof options === 'string' ? options : options?.encoding;
    return decodeBytes(bytes, (encoding ?? 'utf8') as TextEncoding);
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const virtual = normalizePath(path);
    const rel = this.toRel(virtual);
    const entry = await this.statEntry(virtual, rel, 'open');
    if (entry.type === 'dir') throw eisdir('read', virtual);
    if (entry.size > this.maxRead) {
      throw toFsError(
        new Error(`file size ${entry.size} exceeds limit ${this.maxRead}`),
        'open',
        virtual,
        'EFBIG',
      );
    }
    try {
      return await this.backend.readBytes(rel);
    } catch (error) {
      throw toFsError(error, 'open', virtual);
    }
  }

  async exists(path: string): Promise<boolean> {
    const virtual = normalizePath(path);
    try {
      return (await this.backend.stat(this.toRel(virtual))) != null;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<SandboxStat> {
    const virtual = normalizePath(path);
    const entry = await this.statEntry(virtual, this.toRel(virtual), 'stat');
    return this.toStat(virtual, entry);
  }

  async lstat(path: string): Promise<SandboxStat> {
    // 没有软链：lstat == stat
    return this.stat(path);
  }

  private async statEntry(virtual: string, rel: string, op: string): Promise<BackendEntry> {
    let entry: BackendEntry | null;
    try {
      entry = await this.backend.stat(rel);
    } catch (error) {
      throw toFsError(error, op, virtual);
    }
    if (!entry) throw enoent(op, virtual);
    return entry;
  }

  private toStat(virtual: string, entry: BackendEntry): SandboxStat {
    const rel = this.toRel(virtual);
    const mode = this.modes.get(rel) ?? (entry.type === 'dir' ? 0o755 : 0o644);
    const mtime = this.mtimes.get(rel) ?? entry.mtime;
    return {
      isFile: entry.type === 'file',
      isDirectory: entry.type === 'dir',
      isSymbolicLink: false,
      mode,
      size: entry.size,
      mtime: new Date(mtime),
    };
  }

  async readdir(path: string): Promise<string[]> {
    const entries = await this.readdirWithFileTypes(path);
    return entries.map((entry) => entry.name);
  }

  async readdirWithFileTypes(
    path: string,
  ): Promise<Array<{ name: string; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean }>> {
    const virtual = normalizePath(path);
    const rel = this.toRel(virtual);
    const info = await this.statEntry(virtual, rel, 'scandir');
    if (info.type !== 'dir') throw enotdir('scandir', virtual);
    let list;
    try {
      list = await this.backend.list(rel);
    } catch (error) {
      throw toFsError(error, 'scandir', virtual);
    }
    return list.map((entry) => ({
      name: entry.name,
      isFile: entry.type === 'file',
      isDirectory: entry.type === 'dir',
      isSymbolicLink: false,
    }));
  }

  /* --------------------------- 写 --------------------------- */

  async writeFile(
    path: string,
    content: string | Uint8Array,
    options?: { encoding?: TextEncoding } | TextEncoding,
  ): Promise<void> {
    const virtual = normalizePath(path);
    this.assertWritable('open', virtual);
    const encoding = typeof options === 'string' ? options : options?.encoding;
    const bytes = typeof content === 'string' ? encodeText(content, encoding) : content;
    await this.writeBytes(virtual, bytes, false);
  }

  async appendFile(
    path: string,
    content: string | Uint8Array,
    options?: { encoding?: TextEncoding } | TextEncoding,
  ): Promise<void> {
    const virtual = normalizePath(path);
    this.assertWritable('append', virtual);
    const encoding = typeof options === 'string' ? options : options?.encoding;
    const bytes = typeof content === 'string' ? encodeText(content, encoding) : content;
    await this.writeBytes(virtual, bytes, true);
  }

  private async writeBytes(virtual: string, bytes: Uint8Array, append: boolean): Promise<void> {
    const rel = this.toRel(virtual);
    const existing = await this.statOrNull(virtual, rel, 'open');
    if (existing?.type === 'dir') throw eisdir(append ? 'append' : 'open', virtual);
    if (virtual === '/') throw eisdir('write', virtual);
    const parent = dirname(virtual);
    const parentEntry = await this.statOrNull(parent, this.toRel(parent), 'open');
    if (!parentEntry) throw enoent('open', virtual);
    if (parentEntry.type !== 'dir') throw enotdir('open', virtual);

    try {
      await this.backend.write(rel, bytes, { append });
    } catch (error) {
      throw toFsError(error, 'open', virtual);
    }
    this.invalidateIndex();
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const virtual = normalizePath(path);
    this.assertWritable('mkdir', virtual);
    if (virtual === '/') return;
    const rel = this.toRel(virtual);
    const recursive = options?.recursive === true;
    const existing = await this.statOrNull(virtual, rel, 'mkdir');
    if (existing) {
      if (recursive) return;
      throw eexist('mkdir', virtual);
    }
    if (!recursive) {
      const parent = dirname(virtual);
      const parentEntry = await this.statOrNull(parent, this.toRel(parent), 'mkdir');
      if (!parentEntry) throw enoent('mkdir', virtual);
      if (parentEntry.type !== 'dir') throw enotdir('mkdir', virtual);
    }
    try {
      await this.backend.mkdir(rel, { recursive });
    } catch (error) {
      throw toFsError(error, 'mkdir', virtual);
    }
    this.invalidateIndex();
  }

  async createExclusive(
    path: string,
    options: { mode: number; directory?: boolean },
  ): Promise<void> {
    const virtual = normalizePath(path);
    this.assertWritable('open', virtual);
    const rel = this.toRel(virtual);
    const existing = await this.statOrNull(virtual, rel, 'open');
    if (existing) throw eexist('open', virtual);
    const parent = dirname(virtual);
    const parentEntry = await this.statOrNull(parent, this.toRel(parent), 'open');
    if (!parentEntry) throw enoent('open', virtual);
    if (parentEntry.type !== 'dir') throw enotdir('open', virtual);
    try {
      if (options.directory) await this.backend.mkdir(rel, { recursive: false });
      else await this.backend.write(rel, new Uint8Array(0));
    } catch (error) {
      throw toFsError(error, 'open', virtual);
    }
    this.modes.set(rel, options.mode);
    this.mtimes.set(rel, this.now());
    this.invalidateIndex();
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const virtual = normalizePath(path);
    this.assertWritable('unlink', virtual);
    if (virtual === '/') throw eperm('unlink', virtual);
    const rel = this.toRel(virtual);
    const recursive = options?.recursive === true;
    const force = options?.force === true;
    const entry = await this.statOrNull(virtual, rel, 'unlink');
    if (!entry) {
      if (force) return;
      throw enoent('unlink', virtual);
    }
    if (entry.type === 'dir' && !recursive) throw eisdir('unlink', virtual);
    try {
      await this.backend.remove(rel, { recursive, force });
    } catch (error) {
      throw toFsError(error, 'unlink', virtual);
    }
    this.dropOverlay(virtual);
    this.invalidateIndex();
  }

  async cp(src: string, dest: string, options?: { recursive?: boolean }): Promise<void> {
    const from = normalizePath(src);
    this.assertWritable('copyfile', dest);
    const entry = await this.statOrNull(from, this.toRel(from), 'copyfile');
    if (!entry) throw enoent('copyfile', from);
    if (entry.type === 'dir' && options?.recursive !== true) throw eisdir('copyfile', from);

    const target = await this.resolveCopyTarget(from, dest);
    const parent = dirname(target);
    const parentEntry = await this.statOrNull(parent, this.toRel(parent), 'copyfile');
    if (!parentEntry) throw enoent('copyfile', target);
    if (parentEntry.type !== 'dir') throw enotdir('copyfile', target);

    try {
      await this.backend.copy(this.toRel(from), this.toRel(target), {
        recursive: options?.recursive === true,
      });
    } catch (error) {
      throw toFsError(error, 'copyfile', target);
    }
    this.invalidateIndex();
  }

  async mv(src: string, dest: string): Promise<void> {
    const from = normalizePath(src);
    this.assertWritable('rename', dest);
    const entry = await this.statOrNull(from, this.toRel(from), 'rename');
    if (!entry) throw enoent('rename', from);
    const target = await this.resolveCopyTarget(from, dest);
    if (target === from) return;
    const parent = dirname(target);
    const parentEntry = await this.statOrNull(parent, this.toRel(parent), 'rename');
    if (!parentEntry) throw enoent('rename', target);
    if (parentEntry.type !== 'dir') throw enotdir('rename', target);
    try {
      await this.backend.move(this.toRel(from), this.toRel(target));
    } catch (error) {
      throw toFsError(error, 'rename', target);
    }
    this.modes.clear();
    this.mtimes.clear();
    this.invalidateIndex();
  }

  /** cp/mv 的 POSIX 目标解析：目标是已存在的目录时，落到目录里面 */
  private async resolveCopyTarget(from: string, dest: string): Promise<string> {
    const target = normalizePath(dest);
    const entry = await this.statOrNull(target, this.toRel(target), 'stat');
    if (entry?.type === 'dir') return joinPath(target, basename(from));
    return target;
  }

  async chmod(path: string, mode: number): Promise<void> {
    const virtual = normalizePath(path);
    this.assertWritable('chmod', virtual);
    await this.statEntry(virtual, this.toRel(virtual), 'chmod');
    this.modes.set(this.toRel(virtual), mode & 0o7777);
  }

  async utimes(path: string, _atime: Date, mtime: Date): Promise<void> {
    const virtual = normalizePath(path);
    this.assertWritable('utimes', virtual);
    await this.statEntry(virtual, this.toRel(virtual), 'utimes');
    this.mtimes.set(this.toRel(virtual), mtime.getTime());
  }

  async symlink(_target: string, linkPath: string): Promise<void> {
    throw eperm('symlink', normalizePath(linkPath), 'symlink not supported on this filesystem');
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    throw eperm('link', normalizePath(newPath), 'hard link not supported on this filesystem');
  }

  async readlink(path: string): Promise<string> {
    throw einval('readlink', normalizePath(path), 'not a symbolic link');
  }

  async realpath(path: string): Promise<string> {
    const virtual = normalizePath(path);
    await this.statEntry(virtual, this.toRel(virtual), 'realpath');
    return virtual;
  }

  /* ----------------------- 索引（glob 用） ----------------------- */

  /**
   * 全量扫一遍工作区，给 `getAllPaths()` 一份快照。
   * 手机端没有同步文件 API，所以接口是异步的；shell 执行前调一次即可。
   */
  async refreshIndex(): Promise<string[]> {
    const paths = await this.scanDir('');
    this.index = { at: this.now(), paths };
    return paths.slice();
  }

  getAllPaths(): string[] {
    if (!this.index) return [];
    if (this.now() - this.index.at > INDEX_TTL_MS) return this.index.paths.slice();
    return this.index.paths.slice();
  }

  private async scanDir(rel: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      if (out.length >= this.indexLimit) return;
      let entries;
      try {
        entries = await this.backend.list(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (out.length >= this.indexLimit) return;
        const child = dir === '' ? entry.name : `${dir}/${entry.name}`;
        out.push('/' + child);
        if (entry.type === 'dir') await walk(child);
      }
    };
    await walk(rel);
    return out;
  }

  private invalidateIndex(): void {
    this.index = null;
  }

  /* --------------------------- 内部 --------------------------- */

  private toRel(virtual: string): string {
    const normalized = normalizePath(virtual);
    if (normalized === '/') return '';
    return splitPath(normalized).join('/');
  }

  private assertWritable(op: string, path: string): void {
    if (this.readOnly) throw eacces(op, path, 'read-only file system');
  }

  private async statOrNull(virtual: string, rel: string, op: string): Promise<BackendEntry | null> {
    try {
      return await this.backend.stat(rel);
    } catch (error) {
      throw toFsError(error, op, virtual);
    }
  }

  private dropOverlay(virtual: string): void {
    const prefix = this.toRel(virtual);
    const matches = (key: string): boolean =>
      prefix === '' || key === prefix || key.startsWith(`${prefix}/`);
    for (const key of [...this.modes.keys()]) if (matches(key)) this.modes.delete(key);
    for (const key of [...this.mtimes.keys()]) if (matches(key)) this.mtimes.delete(key);
  }

  /** 软链/硬链在这里明确不支持，避免命令误以为成功 */
  static unsupportedNote(): string {
    return 'soft/hard links are not supported by the mobile filesystem adapter';
  }
}
