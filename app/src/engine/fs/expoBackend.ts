/**
 * expo-file-system 后端（手机）。
 *
 * 这一层只做「相对路径 → File/Directory 调用」，不 import expo：真正的
 * expo 对象由 `expoFsApi.ts` 注入。这样 Node 测试可以塞一份假实现，
 * 把路径映射、目录/文件判断、copy/move 语义都测一遍，不用真机。
 *
 * 已知取舍（写进 docs/26）：
 *  - 手机文件系统没有 chmod/utimes/软链，这些语义由 SandboxFs 的内存覆盖层补；
 *  - `File.exists` / `Directory.exists` 是同步原生属性，一次 bridge 调用；
 *  - 目录大小的语义和 POSIX 不同（expo 返回 null 或聚合值），一律报 0。
 */
import type { BackendDirEntry, BackendEntry, FsBackend } from './backend';
import { splitPath } from './path';

/** 注入用的最小 expo 形状（测试里可以换成假的） */
export interface ExpoFileRef {
  /** 原生对象（给 copy/move 时解包用） */
  readonly raw?: unknown;
  readonly exists: boolean;
  readonly size?: number | null;
  readonly lastModified?: number | null;
  readText(): Promise<string>;
  readBytes(): Promise<Uint8Array>;
  write(content: string | Uint8Array, options?: { append?: boolean }): Promise<void>;
  info(): { exists?: boolean; size?: number; modificationTime?: number };
  delete(): void;
  copy(destination: ExpoDirRef | ExpoFileRef, options?: { overwrite?: boolean }): Promise<void>;
  move(destination: ExpoDirRef | ExpoFileRef, options?: { overwrite?: boolean }): Promise<void>;
}

export interface ExpoDirRef {
  /** 原生对象（给 copy/move 时解包用） */
  readonly raw?: unknown;
  readonly exists: boolean;
  readonly size?: number | null;
  readonly uri?: string;
  info(): { exists?: boolean; modificationTime?: number };
  list(): Array<{ name: string; isDirectory: boolean }>;
  create(options?: { intermediates?: boolean; idempotent?: boolean }): void;
  delete(): void;
  copy(destination: ExpoDirRef | ExpoFileRef, options?: { overwrite?: boolean }): Promise<void>;
  move(destination: ExpoDirRef | ExpoFileRef, options?: { overwrite?: boolean }): Promise<void>;
}

export interface ExpoFsApi {
  /** 工作区根的展示路径 */
  readonly rootLabel: string;
  file(segments: string[]): ExpoFileRef;
  dir(segments: string[]): ExpoDirRef;
}

export interface ExpoBackendOptions {
  api: ExpoFsApi;
}

export class ExpoBackend implements FsBackend {
  readonly kind = 'expo';
  readonly rootLabel: string;
  private readonly api: ExpoFsApi;

  constructor(options: ExpoBackendOptions) {
    this.api = options.api;
    this.rootLabel = options.api.rootLabel;
  }

  private segments(rel: string): string[] {
    return splitPath(rel);
  }

  private fileRef(rel: string): ExpoFileRef {
    return this.api.file(this.segments(rel));
  }

  private dirRef(rel: string): ExpoDirRef {
    return this.api.dir(this.segments(rel));
  }

  async ensureRoot(): Promise<void> {
    const root = this.dirRef('');
    if (!root.exists) root.create({ intermediates: true });
  }

  async readText(rel: string): Promise<string> {
    return this.fileRef(rel).readText();
  }

  async readBytes(rel: string): Promise<Uint8Array> {
    return this.fileRef(rel).readBytes();
  }

  async write(rel: string, data: string | Uint8Array, opts?: { append?: boolean }): Promise<void> {
    await this.fileRef(rel).write(data, opts?.append ? { append: true } : undefined);
  }

  async stat(rel: string): Promise<BackendEntry | null> {
    const dir = this.dirRef(rel);
    if (dir.exists) {
      const info = dir.info();
      return { type: 'dir', size: 0, mtime: info.modificationTime ?? 0 };
    }
    const file = this.fileRef(rel);
    if (!file.exists) return null;
    const mtime = file.lastModified ?? file.info().modificationTime ?? 0;
    return { type: 'file', size: file.size ?? 0, mtime };
  }

  async list(rel: string): Promise<BackendDirEntry[]> {
    return this.dirRef(rel)
      .list()
      .map((entry): BackendDirEntry => ({ name: entry.name, type: entry.isDirectory ? 'dir' : 'file' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async mkdir(rel: string, opts: { recursive: boolean }): Promise<void> {
    this.dirRef(rel).create({ intermediates: opts.recursive });
  }

  async remove(rel: string, opts: { recursive: boolean; force: boolean }): Promise<void> {
    const entry = await this.stat(rel);
    if (!entry) {
      if (opts.force) return;
      throw new Error(`ENOENT: no such file or directory, unlink '${rel}'`);
    }
    // expo 的 Directory.delete() 本身就是递归删除
    if (entry.type === 'dir') this.dirRef(rel).delete();
    else this.fileRef(rel).delete();
  }

  async copy(src: string, dest: string, opts: { recursive: boolean }): Promise<void> {
    const entry = await this.stat(src);
    if (!entry) throw new Error(`ENOENT: no such file or directory, copyfile '${src}'`);
    if (entry.type === 'dir') {
      await this.dirRef(src).copy(this.dirRef(dest), { overwrite: true });
    } else {
      await this.fileRef(src).copy(this.fileRef(dest), { overwrite: true });
    }
  }

  async move(src: string, dest: string): Promise<void> {
    const entry = await this.stat(src);
    if (!entry) throw new Error(`ENOENT: no such file or directory, rename '${src}'`);
    if (entry.type === 'dir') {
      await this.dirRef(src).move(this.dirRef(dest), { overwrite: true });
    } else {
      await this.fileRef(src).move(this.fileRef(dest), { overwrite: true });
    }
  }
}
