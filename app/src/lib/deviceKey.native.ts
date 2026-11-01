import * as SecureStore from 'expo-secure-store';

/**
 * 设备密钥的存储（原生实现）。
 *
 * 存的是"这台设备已经配对过"的凭据，不是模型 API Key——后者永远只在宿主上。
 * Android 走 Keystore，iOS 走 Keychain。
 */

const KEY = 'dsh-palm.device-key';

export async function loadDeviceKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function saveDeviceKey(key: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, key);
  } catch {
    // 存不进去就算了，下次再输一遍配对码
  }
}

export async function clearDeviceKey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // ignore
  }
}
