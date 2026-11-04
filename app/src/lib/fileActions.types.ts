/** 生成文件“打开”的返回形状（native / web 两套实现共用） */
export type OpenFileFailure = 'invalid-path' | 'missing' | 'no-viewer' | 'unsupported' | 'error';

export interface OpenFileResult {
  ok: boolean;
  reason?: OpenFileFailure;
  /** 给用户看的中文提示 */
  message?: string;
}
