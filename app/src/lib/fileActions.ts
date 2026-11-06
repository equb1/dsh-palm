/**
 * 打开/分享工作区文件（web / 非原生兜底）。
 *
 * 手机实现见 `fileActions.native.ts`；web 上没有 expo 的文件预览/原生分享，
 * 明确告诉用户去真机，而不是静默失败。
 */
import type { OpenFileResult } from './fileActions.types';

export type { OpenFileResult } from './fileActions.types';

export async function openWorkspaceFile(_relPath: string, _mime?: string): Promise<OpenFileResult> {
  return {
    ok: false,
    reason: 'unsupported',
    message: 'web 预览里没有手机工作区；请在 Android 真机上打开生成文件。',
  };
}

export async function shareWorkspaceFile(_relPath: string, _mime?: string): Promise<OpenFileResult> {
  return {
    ok: false,
    reason: 'unsupported',
    message: 'web 预览里没有原生分享；请在 Android 真机上分享生成文件。',
  };
}
