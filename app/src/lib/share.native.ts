import { NativeModules, Platform } from 'react-native';

/**
 * 「分享到锦囊」的入口。
 *
 * Android 的 ACTION_SEND 由原生模块读取（冷启动时读 Intent），
 * 文本直接进输入框；图片先复制到缓存，等有会话时再上传。
 */
export interface InitialShare {
  text?: string;
  path?: string;
  name?: string;
  mime?: string;
}

interface ShareNative {
  getInitialShare(): Promise<InitialShare | null>;
  readFileBase64(path: string): Promise<string>;
}

const native: ShareNative | null =
  Platform.OS === 'android' ? ((NativeModules.DshPalmHost as ShareNative | undefined) ?? null) : null;

export const shareAvailable = typeof native?.getInitialShare === 'function';

export async function getInitialShare(): Promise<InitialShare | null> {
  if (!native?.getInitialShare) return null;
  try {
    return await native.getInitialShare();
  } catch {
    return null;
  }
}

export async function readFileBase64(path: string): Promise<string | null> {
  if (!native?.readFileBase64) return null;
  try {
    return await native.readFileBase64(path);
  } catch {
    return null;
  }
}
