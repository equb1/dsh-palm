/**
 * 完整引擎（桥）里的附件提示词拼装。
 *
 * 附件由 App 原生收件落在手机 `<filesDir>/workspace/uploads`，
 * proot 里同一物理目录是 `/root/work/uploads`（轻引擎叫 `/workspace/uploads`）。
 * 桥只把路径给模型，不再走 `fileUploads/upload` 的 base64。
 */
import type { FileRef } from '../../../app/src/protocol';
import { buildFileLines, promptWithFiles } from '../../../app/src/lib/attachments/prompt';

/** proot 里的工作区根（与轻引擎的 /workspace 是同一个目录） */
export const PROOT_WORKSPACE_ROOT = '/root/work';

export { buildFileLines, promptWithFiles };

/** 完整引擎根目录下的附件行 */
export function buildProotFileLines(files?: readonly FileRef[]): string[] {
  return buildFileLines(files, PROOT_WORKSPACE_ROOT);
}

/** 完整引擎里发给模型的正文（附件清单在前） */
export function promptWithProotFiles(text: string, files?: readonly FileRef[]): string {
  return promptWithFiles(text, files, PROOT_WORKSPACE_ROOT);
}
