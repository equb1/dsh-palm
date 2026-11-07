import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generateDshCookie } from './dshClient';

export interface DetectedDsh {
  baseUrl: string;
  token: string;
  port: number;
}

/**
 * 自动探测本机运行的 DeepSeek Harness 实例。
 * 1. 从 ~/.dsh/.credentials.yaml 提取 client-connection secret
 * 2. 扫描本机处于 LISTEN 状态的 127.0.0.1 端口
 * 3. 快速并发验证 session/list，锁定真实 DSH
 */
export async function detectRealDsh(timeoutMs = 1500): Promise<DetectedDsh | null> {
  const credPath = join(homedir(), '.dsh', '.credentials.yaml');
  if (!existsSync(credPath)) {
    return null;
  }
  let content = '';
  try {
    content = readFileSync(credPath, 'utf8');
  } catch {
    return null;
  }

  const match = content.match(/client-connection\/browser-session:[\s\S]*?secret:\s*([^\s\r\n]+)/);
  if (!match || !match[1]) {
    return null;
  }
  const secretStr = match[1];

  const ports: number[] = [];
  try {
    const netstat = execSync('netstat -ano', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of netstat.split('\n')) {
      if (line.includes('LISTENING') && line.includes('127.0.0.1:')) {
        const m = line.match(/127\.0\.0\.1:(\d+)/);
        if (m && m[1]) {
          const p = parseInt(m[1], 10);
          if (p > 1024 && !ports.includes(p)) ports.push(p);
        }
      }
    }
  } catch {
    // 默认常见备选端口
    ports.push(62708, 8899, 8788);
  }

  const results = await Promise.all(
    ports.map(async (port) => {
      const host = `127.0.0.1:${port}`;
      const cookie = generateDshCookie(host, secretStr);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`http://${host}/api/session/list`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            host,
            cookie,
          },
          body: JSON.stringify({
            type: 'client-request',
            rpcId: 'probe-' + port,
            method: 'session/list',
            payload: { args: { _request: {} } },
          }),
          signal: controller.signal as never,
        });
        clearTimeout(timer);
        if (res.ok) {
          const json = (await res.json()) as { result?: { ok?: boolean } };
          if (json.result?.ok) {
            return { port, baseUrl: `http://${host}`, token: secretStr };
          }
        }
      } catch {}
      return null;
    }),
  );

  return results.find((r): r is DetectedDsh => r !== null) ?? null;
}
