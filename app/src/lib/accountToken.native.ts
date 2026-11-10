import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';

/** dsh 账号凭据：与完整引擎共用 `<filesDir>/home/.dsh/.credentials.yaml` */
const CREDENTIALS = new File(Paths.document, 'home/.dsh/.credentials.yaml');
/** App 内登录（轻引擎）拿到的 token：完整引擎不读它，但轻引擎优先用它 */
const TOKEN_KEY = 'dsh-palm.deepseek.token';
const DEVICE_KEY = 'dsh-palm.deepseek.device';

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * 解析 `records."deepseek-account-platform/default".payload.token`。
 *
 * 优先用 App 内登录保存的 token（轻引擎不需要完整引擎也能登录）；
 * 没有的话再读完整引擎写的 .credentials.yaml。
 *
 * 不引 YAML 库：文件是 dsh 自己写的固定结构，按段落 + 字段名取就够；
 * 解析失败一律返回 null，让上层回退到“配置 API Key / 完整模式”。
 */
export async function loadAccountToken(): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(TOKEN_KEY);
    if (stored && stored.trim().length > 0) return stored.trim();
  } catch {
    /* SecureStore 不可用时继续读文件 */
  }
  try {
    if (!CREDENTIALS.exists) return null;
    const text = await CREDENTIALS.text();
    const start = text.indexOf('deepseek-account-platform/default:');
    if (start < 0) return null;
    const block = text.slice(start);
    const match = block.match(/\btoken:\s*([^\n\r]+)/);
    if (!match) return null;
    const token = unquote(match[1] ?? '');
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** App 内登录成功：把 token 存进 SecureStore，轻引擎下次连接直接复用 */
export async function saveAccountToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearAccountToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    /* 已经没了就算了 */
  }
}

/** 设备 id：auth_exchange 需要，随机生成一次后固定 */
export async function loadDeepseekDeviceId(): Promise<string | null> {
  try {
    const value = await SecureStore.getItemAsync(DEVICE_KEY);
    return value && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

export async function saveDeepseekDeviceId(id: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(DEVICE_KEY, id);
  } catch {
    /* 存不上就每次重新生成，不影响登录 */
  }
}
