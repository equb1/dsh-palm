import * as SecureStore from 'expo-secure-store';

const KEY = 'dsh-palm.account-phone';

/** 手机号只用于本地展示，存 SecureStore，不上传宿主 */
export async function loadAccountPhone(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(KEY)) ?? '';
  } catch {
    return '';
  }
}

export async function saveAccountPhone(value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, value.trim());
  } catch {
    /* ignore */
  }
}
