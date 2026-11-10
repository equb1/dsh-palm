import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';

function encodeBase64Url(buf) {
  return Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function decodeBase64Url(str) {
  let b64 = str.replaceAll('-', '+').replaceAll('_', '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return Buffer.from(b64, 'base64');
}

export function generateDshCookie(host, secretStr) {
  const secret = decodeBase64Url(secretStr);
  const authority = host;
  const cName = 'dsh-auth-' + encodeBase64Url(createHash('sha256').update(authority).digest());
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 1440 * 60 * 1000 * 30;
  const payload = { version: 1, authority, issuedAt, expiresAt };
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', secret).update(body).digest();
  const cValue = `v1.${body}.${encodeBase64Url(sig)}`;
  return `${cName}=${cValue}`;
}

export async function detectRealDsh() {
  const credPath = join(homedir(), '.dsh', '.credentials.yaml');
  if (!existsSync(credPath)) {
    console.log('No .credentials.yaml found at', credPath);
    return null;
  }
  const content = readFileSync(credPath, 'utf8');
  const match = content.match(/client-connection\/browser-session:[\s\S]*?secret:\s*([^\s\r\n]+)/);
  if (!match) {
    console.log('No secret found in .credentials.yaml');
    return null;
  }
  const secretStr = match[1];

  // 获取本机 127.0.0.1 上正在监听的端口
  let ports = [];
  try {
    const netstat = execSync('netstat -ano', { encoding: 'utf8' });
    const lines = netstat.split('\n');
    for (const line of lines) {
      if (line.includes('LISTENING') && line.includes('127.0.0.1:')) {
        const m = line.match(/127\.0\.0\.1:(\d+)/);
        if (m) {
          const p = parseInt(m[1], 10);
          if (p > 1024 && !ports.includes(p)) ports.push(p);
        }
      }
    }
  } catch (e) {
    console.error('netstat error:', e);
  }

  console.log('Found listening ports:', ports);

  // 并发测试每个端口
  const results = await Promise.all(
    ports.map(async (port) => {
      const host = `127.0.0.1:${port}`;
      const cookie = generateDshCookie(host, secretStr);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1000);
        const res = await fetch(`http://${host}/api/session/list`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'host': host,
            'cookie': cookie,
          },
          body: JSON.stringify({
            type: 'client-request',
            rpcId: 'probe-' + port,
            method: 'session/list',
            payload: { args: { _request: {} } },
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const json = await res.json();
          if (json.result?.ok) {
            return { port, count: json.result.value.items?.length ?? 0 };
          }
        }
      } catch {}
      return null;
    })
  );

  const found = results.find(Boolean);
  if (found) {
    console.log(`Detected DSH on port ${found.port} with ${found.count} sessions!`);
    return { port: found.port, secret: secretStr, cookie: generateDshCookie(`127.0.0.1:${found.port}`, secretStr) };
  }
  return null;
}

detectRealDsh();

