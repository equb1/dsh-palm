/**
 * 打开工作区文件（web / 非原生兜底）。
 *
 * 手机实现见 `fileActions.native.ts`；web 上没有 expo 的文件预览，
 * 明确告诉用户去真机，而不是静默失败。
 */
import type { OpenFileResult } from './fileActions.types';

export type { OpenFileResult } from './fileActions.types';

// TODO(1.5): 分享文件暂缓。RN 的 Share.share 只支持文本/URL，分享二进制要么加
// expo-sharing，要么走原生 FileProvider；本轮只做“打开”。
export async function openWorkspaceFile(_relPath: string, _mime?: string): Promise<OpenFileResult> {
  return {
    ok: false,
    reason: 'unsupported',
    message: 'web 预览里没有手机工作区；请在 Android 真机上打开生成文件。',
  };
}
