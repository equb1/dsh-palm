/**
 * Node 后端：测试与桌面端用 `node:fs/promises` 真读写目录。
 *
 * 手机上不会走到这里（Metro 解析不到 `node:fs`），真机用的是
 * `expoBackend.ts`。两个后端实现同一份 `FsBackend`，所以 SandboxFs 的
 * 路径/errno/覆盖层逻辑在两端是同一套代码。
 */
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  appendFile,
} from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import type { BackendDirEntry, BackendEntry, FsBackend } from './backend';

export interface NodeBackendOptions {
  /** 工作区根目录（绝对路径或相对 cwd） */
  root: string;
}

export class NodeBackend implements FsBackend {
  readonly kind = 'node';
  readonly rootLabel: string;
  private readonly root: string;

  constructor(options: NodeBackendOptions) {
    this.root = resolve(options.root);
    this.rootLabel = this.root;
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  /** 相对路径 → 真实路径，并确认没有越出根（防御纵深，正常路径已被 SandboxFs 规范化） */
  private real(rel: string): string {
    const target = rel === '' ? this.root : resolve(this.root, rel);
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error(`EACCES: path escapes workspace root, '${rel}'`);
    }
    return target;
  }

  async readText(rel: string): Promise<string> {
    return readFile(this.real(rel), 'utf8');
  }

  async readBytes(rel: string): Promise<Uint8Array> {
    const buffer = await readFile(this.real(rel));
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  async write(rel: string, data: string | Uint8Array, opts?: { append?: boolean }): Promise<void> {
    if (opts?.append) await appendFile(this.real(rel), data);
    else await writeFile(this.real(rel), data);
  }

  async stat(rel: string): Promise<BackendEntry | null> {
    const target = this.real(rel);
    let info;
    try {
      info = await lstat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    // 软链会把读写带到工作区外面：明确拒绝（和 just-bash 的 ReadWriteFs 默认一致）
    if (info.isSymbolicLink()) {
      throw new Error(`EACCES: symbolic link is not supported, '${rel}'`);
    }
    return {
      type: info.isDirectory() ? 'dir' : 'file',
      size: info.size,
      mtime: info.mtimeMs,
    };
  }

  async list(rel: string): Promise<BackendDirEntry[]> {
    const entries = await readdir(this.real(rel), { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      // 软链在 stat 里会被拒绝；这里先当文件列出来，读的时候再报错
      type: entry.isDirectory() ? 'dir' : 'file',
    }));
  }

  async mkdir(rel: string, opts: { recursive: boolean }): Promise<void> {
    await mkdir(this.real(rel), { recursive: opts.recursive });
  }

  async remove(rel: string, opts: { recursive: boolean; force: boolean }): Promise<void> {
    await rm(this.real(rel), { recursive: opts.recursive, force: opts.force });
  }

  async copy(src: string, dest: string, opts: { recursive: boolean }): Promise<void> {
    await cp(this.real(src), this.real(dest), { recursive: opts.recursive, force: true });
  }

  async move(src: string, dest: string): Promise<void> {
    try {
      await rename(this.real(src), this.real(dest));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      // 跨设备：先复制再删（mv 的 EXDEV 兜底）
      await cp(this.real(src), this.real(dest), { recursive: true, force: true });
      await rm(this.real(src), { recursive: true, force: true });
    }
  }
}

/** 测试用：临时目录（调用方负责清理） */
export function makeNodeBackend(root: string): NodeBackend {
  return new NodeBackend({ root });
}
