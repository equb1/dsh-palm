/**
 * 设备密钥的存储（默认实现：浏览器 localStorage / Node 内存）。
 *
 * 原生端走 `deviceKey.native.ts`（expo-secure-store）。Metro 会优先挑 .native.ts，
 * Node 跑测试时挑这个文件——所以这里不能 import react-native 或 expo。
 */

const KEY = 'dsh-palm.device-key';

const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

export async function loadDeviceKey(): Promise<string | null> {
  const store = storage();
  if (store) return store.getItem(KEY);
  return memory.get(KEY) ?? null;
}

export async function saveDeviceKey(key: string): Promise<void> {
  const store = storage();
  if (store) {
    store.setItem(KEY, key);
    return;
  }
  memory.set(KEY, key);
}

export async function clearDeviceKey(): Promise<void> {
  const store = storage();
  if (store) {
    store.removeItem(KEY);
    return;
  }
  memory.delete(KEY);
}
