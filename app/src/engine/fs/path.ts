/**
 * 虚拟路径工具。
 *
 * 这里不用 `node:path`：Hermes 上没有 Node 标准库，而手机端的
 * IFileSystem 适配器（expo-file-system）和 Node 测试必须共用同一套规则。
 *
 * 语义是 POSIX 的、chroot 式的：
 *  - 只有绝对路径，`/` 是根；
 *  - `..` 到根就停住（不越界），和 chroot 里一样；
 *  - 空串 / `.` / 重复斜杠都被折叠掉；
 *  - 含 NUL 的路径直接拒绝（POSIX 也不允许）。
 */

export function splitPath(path: string): string[] {
  return path.split('/').filter((part) => part.length > 0 && part !== '.');
}

/** 规范化成绝对虚拟路径；`/a/../b` → `/b`，`../..` → `/` */
export function normalizePath(path: string): string {
  if (typeof path !== 'string') throw new TypeError('path 必须是字符串');
  if (path.includes('\0')) throw new Error('EINVAL: invalid argument, path contains null byte');
  const out: string[] = [];
  for (const part of splitPath(path)) {
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

/** 相对基准路径解析（base 必须是绝对路径） */
export function joinPath(base: string, path: string): string {
  if (path.startsWith('/')) return normalizePath(path);
  const root = normalizePath(base);
  return normalizePath(root === '/' ? '/' + path : root + '/' + path);
}

export function dirname(path: string): string {
  const parts = splitPath(path);
  parts.pop();
  return '/' + parts.join('/');
}

export function basename(path: string): string {
  const parts = splitPath(path);
  return parts.length === 0 ? '/' : (parts[parts.length - 1] as string);
}

/** 父目录是否为根（`/a` 的父是 `/`） */
export function isRoot(path: string): boolean {
  return normalizePath(path) === '/';
}
