/**
 * 把附件路径拼进模型提示词（纯函数，轻 / 完整引擎共用）。
 *
 * 附件由原生收件直接落在工作区，两个引擎只把路径告诉模型：
 * 轻引擎根目录 `/workspace`，完整引擎（proot）根目录 `/root/work`。
 */
import type { FileRef } from '../../protocol';
import { formatBytes } from './classify';

export const UPLOADS_PREFIX = 'uploads/';

/** relPath 不合法时抛出；桥/轻引擎会把它映射成 bad_request */
export class AttachmentPathError extends Error {
  readonly code = 'bad_request' as const;

  constructor(message: string) {
    super(message);
    this.name = 'AttachmentPathError';
  }
}

function invalid(): never {
  throw new AttachmentPathError('附件路径不合法，只接受 uploads/<文件名>');
}

/**
 * 校验附件相对路径：必须形如 `uploads/<文件名>`，不含 `..` 段、NUL 或反斜杠。
 * 模型只看到这个路径，绝不允许它跳出工作区的 uploads 目录。
 */
export function assertSafeRelPath(relPath: unknown): string {
  const value = typeof relPath === 'string' ? relPath.trim() : '';
  if (!value || value.includes('\0') || value.startsWith('/') || value.includes('\\')) invalid();
  const parts = value.split('/');
  if (parts.length !== 2 || parts[0] !== 'uploads') invalid();
  const file = parts[1] ?? '';
  if (!file || file === '.' || file === '..') invalid();
  return value;
}

function joinRoot(root: string, relPath: string): string {
  const base = root.trim().replace(/\/+$/, '');
  return base ? `${base}/${relPath}` : `/${relPath}`;
}

/**
 * 每个附件一行：`- /root/work/uploads/x.md (text/markdown, 1.5 KB, 未解析)`。
 * 目前所有附件都只给路径，不把内容塞进上下文，所以统一标「未解析」。
 */
export function buildFileLines(files: readonly FileRef[] | undefined, root: string): string[] {
  if (!files || files.length === 0) return [];
  return files.map((file) => {
    const relPath = assertSafeRelPath(file.relPath);
    const mime = file.mime?.trim() || 'application/octet-stream';
    return `- ${joinRoot(root, relPath)} (${mime}, ${formatBytes(file.bytes)}, 未解析)`;
  });
}

/** 把附件清单放在用户正文前面；没有正文时只发清单 */
export function promptWithFiles(text: string, files: readonly FileRef[] | undefined, root: string): string {
  const body = text.trim();
  const lines = buildFileLines(files, root);
  if (lines.length === 0) return body;
  const block = `[附件]\n${lines.join('\n')}`;
  return body ? `${block}\n\n${body}` : block;
}
