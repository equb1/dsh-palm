/**
 * 读取 dsh 官方账号的授权 token（非原生端空实现）。
 *
 * 原生端：App 内登录保存到 SecureStore，或读完整引擎写的
 * `<filesDir>/home/.dsh/.credentials.yaml`；轻引擎用 `x-dsh-auth-token`
 * 调 DeepSeek 的 OpenAI 兼容端点，不需要用户再填 API Key。
 */
export async function loadAccountToken(): Promise<string | null> {
  return null;
}

export async function saveAccountToken(_token: string): Promise<void> {
  return;
}

export async function clearAccountToken(): Promise<void> {
  return;
}

export async function loadDeepseekDeviceId(): Promise<string | null> {
  return null;
}

export async function saveDeepseekDeviceId(_id: string): Promise<void> {
  return;
}
