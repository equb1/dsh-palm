/**
 * 完整引擎（proot）的工作区文件接口。
 *
 * 桥跑在 proot 里，能直接读 /root/work；fs.list/rename/delete 不经过 dsh HTTP。
 * 这里只允许 /root/work 以内，路径穿越、根目录改名/删除一律拒绝。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { WorkspaceEntry } from '../../../app/src/protocol';
import { PROOT_WORKSPACE_ROOT } from './promptParts';

export const MAX_WORKSPACE_ENTRIES = 500;

export class WorkspaceFsError extends Error {
  readonly code = 'bad_request' as const;

  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceFsError';
  }
}

function bad(message: string): never {
  throw new WorkspaceFsError(message);
}

/** UI 传的是工作区绝对路径（/、/docs、/uploads/x），统一成 POSIX 绝对路径 */
export function normalizeWorkspacePath(input: string | undefined): string {
  const raw = (input ?? '/').trim() || '/';
  if (raw.includes('\0') || raw.includes('\\')) bad('路径不合法');
  if (!raw.startsWith('/')) bad('只接受工作区绝对路径');
  if (raw.split('/').some((segment) => segment === '..')) bad('路径越出工作区');
  const normalized = path.posix.normalize(raw);
  if (normalized === '..' || normalized.startsWith('../')) bad('路径越出工作区');
  return normalized === '.' ? '/' : normalized;
}

/** 把工作区路径落到真实目录；任何越界都拒绝 */
export function resolveWorkspacePath(root: string, input: string | undefined): {
  rel: string;
  abs: string;
} {
  const rel = normalizeWorkspacePath(input);
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, `.${rel}`);
  if (abs !== rootAbs && !abs.startsWith(`${rootAbs}${path.sep}`)) {
    bad('路径越出工作区');
  }
  return { rel, abs };
}

export async function listWorkspace(
  root: string,
  input?: string,
): Promise<{ path: string; entries: WorkspaceEntry[] }> {
  const { rel, abs } = resolveWorkspacePath(root, input);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch (error) {
    bad(`读不了这个目录：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isDirectory()) bad('这不是目录');

  const items = await fs.readdir(abs, { withFileTypes: true });
  const entries: WorkspaceEntry[] = [];
  for (const item of items.slice(0, MAX_WORKSPACE_ENTRIES)) {
    // 不跟随软链，避免把工作区外的文件带进列表
    if (item.isSymbolicLink()) continue;
    const childAbs = path.join(abs, item.name);
    let size = 0;
    let mtime = 0;
    try {
      const info = await fs.lstat(childAbs);
      size = info.isDirectory() ? 0 : info.size;
      mtime = info.mtime.getTime();
    } catch {
      // 单个子项刚被删/没权限，不影响整页
    }
    entries.push({
      name: item.name,
      kind: item.isDirectory() ? 'dir' : 'file',
      size,
      mtime,
    });
  }
  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
  );
  return { path: rel, entries };
}

export async function renameWorkspace(
  root: string,
  from: string,
  to: string,
): Promise<void> {
  const src = resolveWorkspacePath(root, from);
  const dest = resolveWorkspacePath(root, to);
  if (src.rel === '/' || dest.rel === '/') bad('不能重命名工作区根目录');
  try {
    await fs.rename(src.abs, dest.abs);
  } catch (error) {
    bad(`重命名失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function deleteWorkspace(root: string, input: string): Promise<void> {
  const target = resolveWorkspacePath(root, input);
  if (target.rel === '/') bad('不能删除工作区根目录');
  try {
    const info = await fs.lstat(target.abs);
    if (info.isDirectory()) await fs.rm(target.abs, { recursive: true, force: true });
    else await fs.unlink(target.abs);
  } catch (error) {
    bad(`删除失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

export const FULL_ENGINE_WORKSPACE_ROOT = PROOT_WORKSPACE_ROOT;
