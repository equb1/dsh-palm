/**
 * 读取 dsh 官方账号的授权 token（非原生端空实现）。
 *
 * 账号登录由完整引擎完成，token 落在 `<filesDir>/home/.dsh/.credentials.yaml`。
 * 轻引擎在手机内可以直接读这个文件，用 `x-dsh-auth-token` 调 DeepSeek 的
 * OpenAI 兼容端点，所以不需要用户再填 API Key。
 */
export async function loadAccountToken(): Promise<string | null> {
  return null;
}
