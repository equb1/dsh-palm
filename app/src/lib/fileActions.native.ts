/**
 * 打开工作区文件（Android / iOS）：`expo-file-system` 的 File.preview。
 *
 * 工作区是 `<document>/workspace`，和轻引擎、proot 完整引擎用的是同一个目录。
 * `can preview` 由系统判断：没有对应查看器就返回 false，界面给中文提示。
 * 不需要 FileProvider / Manifest 改动（expo 的 preview 走系统 ACTION_VIEW）。
 */
import { File, Paths } from 'expo-file-system';

import type { OpenFileResult } from './fileActions.types';

export type { OpenFileResult } from './fileActions.types';

// TODO(1.5): 分享文件暂缓。RN 的 Share.share 只支持文本/URL，分享二进制要么加
// expo-sharing，要么走原生 FileProvider；本轮只做“打开”。

function invalidPath(): OpenFileResult {
  return { ok: false, reason: 'invalid-path', message: '文件路径不合法：只能打开工作区里的文件。' };
}

export async function openWorkspaceFile(relPath: string, mime?: string): Promise<OpenFileResult> {
  const segments = String(relPath ?? '')
    .split('/')
    .filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0'),
    )
  ) {
    return invalidPath();
  }

  try {
    const file = new File(Paths.document, 'workspace', ...segments);
    if (!file.exists) {
      return {
        ok: false,
        reason: 'missing',
        message: '文件不在了：可能被清理、改名，或还没生成完。回到会话里重新生成一次。',
      };
    }

    const mimeType = mime || file.type || 'application/octet-stream';
    const name = segments[segments.length - 1] ?? '';
    let canPreview = false;
    try {
      canPreview = await file.canPreview({ mimeType });
    } catch {
      canPreview = false;
    }
    if (!canPreview) {
      return {
        ok: false,
        reason: 'no-viewer',
        message: `手机上没有能打开「${name}」的应用。可以让模型换个格式（例如 docx/xlsx），或导出后再看。`,
      };
    }
    await file.preview({ mimeType, title: name });
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: 'error',
      message: `打开文件失败：${detail.slice(0, 160)}`,
    };
  }
}
