/**
 * 文件系统错误。
 *
 * just-bash 的命令靠错误消息里的 errno 前缀做二次判断（例如 `rm` 看
 * `ENOTEMPTY`、`cp` 看 `ENOENT`），所以这里统一产出
 * `CODE: message, op 'path'` 形状的 Error，而不是自定义错误类。
 * 原生（expo-file-system / node:fs）抛出来的错误经 `toFsError` 映射成同一形状。
 */

export type FsErrno =
  | 'ENOENT'
  | 'EISDIR'
  | 'ENOTDIR'
  | 'EEXIST'
  | 'ENOTEMPTY'
  | 'EACCES'
  | 'EPERM'
  | 'EFBIG'
  | 'EINVAL'
  | 'ENOSYS'
  | 'EXDEV'
  | 'EIO'
  | 'ETIMEDOUT';

export class FsError extends Error {
  readonly code: FsErrno;

  constructor(code: FsErrno, message: string) {
    super(`${code}: ${message}`);
    this.name = 'FsError';
    this.code = code;
  }
}

export function enoent(op: string, path: string): FsError {
  return new FsError('ENOENT', `no such file or directory, ${op} '${path}'`);
}

export function eisdir(op: string, path: string): FsError {
  return new FsError('EISDIR', `illegal operation on a directory, ${op} '${path}'`);
}

export function enotdir(op: string, path: string): FsError {
  return new FsError('ENOTDIR', `not a directory, ${op} '${path}'`);
}

export function eexist(op: string, path: string): FsError {
  return new FsError('EEXIST', `file already exists, ${op} '${path}'`);
}

export function enotempty(op: string, path: string): FsError {
  return new FsError('ENOTEMPTY', `directory not empty, ${op} '${path}'`);
}

export function eacces(op: string, path: string, detail = 'permission denied'): FsError {
  return new FsError('EACCES', `${detail}, ${op} '${path}'`);
}

export function eperm(op: string, path: string, detail = 'operation not permitted'): FsError {
  return new FsError('EPERM', `${detail}, ${op} '${path}'`);
}

export function enotsup(op: string, path: string): FsError {
  return new FsError('ENOSYS', `function not implemented, ${op} '${path}'`);
}

export function einval(op: string, path: string, detail = 'invalid argument'): FsError {
  return new FsError('EINVAL', `${detail}, ${op} '${path}'`);
}

const CODE_PATTERN = /\b(ENOENT|EISDIR|ENOTDIR|EEXIST|ENOTEMPTY|EACCES|EPERM|EFBIG|EINVAL|ENOSYS|EXDEV|EIO|ETIMEDOUT)\b/;

/** 从任意错误里认出 errno（先看 code，再看消息前缀） */
export function errnoOf(error: unknown): FsErrno | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && CODE_PATTERN.test(code)) return code as FsErrno;
  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string') {
    const m = CODE_PATTERN.exec(message);
    if (m) return m[1] as FsErrno;
    if (/no such file|does not exist|not found/i.test(message)) return 'ENOENT';
    if (/already exists/i.test(message)) return 'EEXIST';
    if (/not a directory/i.test(message)) return 'ENOTDIR';
    if (/is a directory/i.test(message)) return 'EISDIR';
    if (/not empty/i.test(message)) return 'ENOTEMPTY';
    if (/permission denied|denied|not permitted|read-only/i.test(message)) return 'EACCES';
    if (/too large|exceeds/i.test(message)) return 'EFBIG';
  }
  return null;
}

/** 原生错误 → 带 errno 前缀的 Error；没有可识别代码时用兜底 */
export function toFsError(error: unknown, op: string, path: string, fallback: FsErrno = 'EIO'): Error {
  const code = errnoOf(error) ?? fallback;
  if (error instanceof FsError) return error;
  const message = error instanceof Error ? error.message : String(error);
  // 原生消息里常带完整 file:// URI，压掉前缀只留可读部分
  const detail = message
    .replace(/^Error:\s*/, '')
    .replace(/file:\/\/\S+/g, path)
    .replace(/^E[A-Z]+:\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  return new FsError(code, `${op} '${path}'${detail ? `: ${detail}` : ''}`);
}
