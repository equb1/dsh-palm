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
 * 图片被视觉模型消费时标「视觉输入」；其余附件仍只给路径，不塞内容。
 */
export interface FilePromptOptions {
  /** 这些 relPath 会作为视觉输入发给模型 */
  visionPaths?: ReadonlySet<string>;
  /** 视觉降级/超限时追加的一句说明 */
  visionNote?: string;
}

export function buildFileLines(
  files: readonly FileRef[] | undefined,
  root: string,
  options: FilePromptOptions = {},
): string[] {
  if (!files || files.length === 0) return [];
  return files.map((file) => {
    const relPath = assertSafeRelPath(file.relPath);
    const mime = file.mime?.trim() || 'application/octet-stream';
    const state = options.visionPaths?.has(relPath) ? '视觉输入' : '未解析';
    return `- ${joinRoot(root, relPath)} (${mime}, ${formatBytes(file.bytes)}, ${state})`;
  });
}

/** 把附件清单放在用户正文前面；没有正文时只发清单 */
export function promptWithFiles(
  text: string,
  files: readonly FileRef[] | undefined,
  root: string,
  options: FilePromptOptions = {},
): string {
  const body = text.trim();
  const lines = buildFileLines(files, root, options);
  if (lines.length === 0) return body;
  const block = `[附件]\n${lines.join('\n')}`;
  const note = options.visionNote ? `\n${options.visionNote}` : '';
  return body ? `${block}${note}\n\n${body}` : `${block}${note}`;
}
