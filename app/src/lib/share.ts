/** 分享菜单（非原生端空实现）。 */

export interface InitialShare {
  text?: string;
  path?: string;
  name?: string;
  mime?: string;
}

export const shareAvailable = false;

export async function getInitialShare(): Promise<InitialShare | null> {
  return null;
}

export async function readFileBase64(_path: string): Promise<string | null> {
  return null;
}
