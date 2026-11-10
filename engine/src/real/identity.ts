/**
 * 桥的稳定身份（M3.2）。
 *
 * 以前所有桥都叫 host-real-dsh，第二台宿主会把第一台的会话/密钥覆盖。
 * 现在身份落在 DSH_PALM_DEVICES 同目录的 identity.json（proot 的 /bridge），
 * 换镜像不丢；名字可用 DSH_PALM_HOST_NAME 覆盖。
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

export interface BridgeIdentity {
  hostId: string;
  name: string;
  fingerprint: string;
  createdAt: number;
}

function defaultIdentityFile(): string {
  if (process.env.DSH_PALM_IDENTITY) return process.env.DSH_PALM_IDENTITY;
  if (process.env.DSH_PALM_DEVICES) return join(dirname(process.env.DSH_PALM_DEVICES), 'identity.json');
  return join(process.cwd(), '.dsh-palm-identity.json');
}

function makeIdentity(name?: string): BridgeIdentity {
  const hostId = `host-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const displayName = (name ?? process.env.DSH_PALM_HOST_NAME ?? hostname() ?? '锦囊宿主').trim() || '锦囊宿主';
  const fingerprint = createHash('sha256').update(`${hostId}:${displayName}`).digest('hex').slice(0, 16);
  return { hostId, name: displayName, fingerprint, createdAt: Date.now() };
}

export function loadBridgeIdentity(file?: string, name?: string): BridgeIdentity {
  const target = file ?? defaultIdentityFile();
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as Partial<BridgeIdentity>;
    if (
      typeof parsed.hostId === 'string'
      && parsed.hostId.startsWith('host-')
      && typeof parsed.name === 'string'
      && typeof parsed.fingerprint === 'string'
    ) {
      return {
        hostId: parsed.hostId,
        name: name ?? parsed.name,
        fingerprint: parsed.fingerprint,
        createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
      };
    }
  } catch {
    /* 第一次启动或文件损坏：重新生成 */
  }
  const identity = makeIdentity(name);
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  } catch {
    /* 只读环境仍可使用内存身份 */
  }
  return identity;
}
