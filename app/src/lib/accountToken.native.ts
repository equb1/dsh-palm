import { File, Paths } from 'expo-file-system';

/** dsh 账号凭据：与完整引擎共用的 `<filesDir>/home/.dsh/.credentials.yaml` */
const CREDENTIALS = new File(Paths.document, 'home/.dsh/.credentials.yaml');

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
 * 不引 YAML 库：文件是 dsh 自己写的固定结构，按段落 + 字段名取就够；
 * 解析失败一律返回 null，让上层回退到“配置 API Key / 完整模式”。
 */
export async function loadAccountToken(): Promise<string | null> {
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
