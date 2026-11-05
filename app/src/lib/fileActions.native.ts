/**
 * 打开/分享工作区文件（Android / iOS）。
 *
 * 工作区是 `<document>/workspace`，和轻引擎、proot 完整引擎用的是同一个目录。
 * 打开走 `File.preview`（系统 ACTION_VIEW）；分享走 expo File 的 `contentUri`
 * + 原生 `HostModule.shareFile`（ACTION_SEND，带读权限）。
 * expo-file-system 已注册 FileProvider（files-path "." 覆盖 workspace），不需要改 Manifest。
 */
import { File, Paths } from 'expo-file-system';

import { shareWorkspaceFileNative } from './host';
import type { OpenFileResult } from './fileActions.types';

export type { OpenFileResult } from './fileActions.types';

function invalidPath(): OpenFileResult {
  return { ok: false, reason: 'invalid-path', message: '文件路径不合法：只能打开工作区里的文件。' };
}

/** 拆路径并拒绝 . / .. / 反斜杠 / NUL；空数组表示非法 */
function workspaceSegments(relPath: string): string[] {
  const segments = String(relPath ?? '')
    .split('/')
    .filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0'),
    )
  ) {
    return [];
  }
  return segments;
}

export async function openWorkspaceFile(relPath: string, mime?: string): Promise<OpenFileResult> {
  const segments = workspaceSegments(relPath);
  if (segments.length === 0) return invalidPath();

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

/** 分享工作区文件：contentUri 交给原生 ACTION_SEND，接收方拿临时读权限 */
export async function shareWorkspaceFile(relPath: string, mime?: string): Promise<OpenFileResult> {
  const segments = workspaceSegments(relPath);
  if (segments.length === 0) return invalidPath();

  try {
    const file = new File(Paths.document, 'workspace', ...segments);
    if (!file.exists) {
      return {
        ok: false,
        reason: 'missing',
        message: '文件不在了：可能被清理、改名，或还没生成完。回到会话里重新生成一次。',
      };
    }
    const name = segments[segments.length - 1] ?? '';
    const mimeType = mime || file.type || 'application/octet-stream';
    const contentUri = String(file.contentUri ?? '');
    if (!contentUri.startsWith('content://')) {
      return {
        ok: false,
        reason: 'error',
        message: '这个文件没有可分享的 content:// 地址，可能是系统文件服务不可用。',
      };
    }
    const ok = await shareWorkspaceFileNative(contentUri, mimeType, name);
    if (!ok) {
      return {
        ok: false,
        reason: 'unsupported',
        message: '当前安装包还没有原生分享能力（老 APK），请升级后重试。',
      };
    }
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: 'error',
      message: `分享文件失败：${detail.slice(0, 160)}`,
    };
  }
}
