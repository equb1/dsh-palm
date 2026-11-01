/**
 * 设备密钥存储：配对一次，记住这台设备，之后不用再输配对码。
 *
 * 存在桥旁边的一个 JSON 文件里（默认 `<cwd>/.dsh-palm-devices.json`），
 * 权限 0600。纯本地，不上传。
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export interface DeviceRecord {
  /** 设备密钥（32 字节 hex） */
  key: string;
  /** 备注名，方便在宿主上认人 */
  label: string;
  createdAt: number;
  lastSeenAt: number;
}

interface Store {
  devices: DeviceRecord[];
}

export class DeviceStore {
  private readonly file: string;
  private data: Store;

  constructor(file: string) {
    this.file = file;
    this.data = { devices: [] };
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Store;
        if (Array.isArray(parsed.devices)) this.data = { devices: parsed.devices };
      } catch {
        // 文件坏了就当没有，别让桥起不来
      }
    }
  }

  /** 新配一台设备，返回它的密钥 */
  issue(label = 'phone'): DeviceRecord {
    const record: DeviceRecord = {
      key: randomBytes(32).toString('hex'),
      label,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    };
    this.data.devices.push(record);
    this.flush();
    return record;
  }

  /** 校验一把密钥，顺便更新 lastSeenAt */
  verify(key: string): DeviceRecord | null {
    const found = this.data.devices.find((d) => d.key === key);
    if (!found) return null;
    found.lastSeenAt = Date.now();
    this.flush();
    return found;
  }

  /** 撤销一把密钥（手机上「忘记这台设备」时清掉即可，宿主要能手动删） */
  revoke(key: string): boolean {
    const before = this.data.devices.length;
    this.data.devices = this.data.devices.filter((d) => d.key !== key);
    const changed = this.data.devices.length !== before;
    if (changed) this.flush();
    return changed;
  }

  list(): DeviceRecord[] {
    return [...this.data.devices];
  }

  private flush(): void {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    try {
      chmodSync(this.file, 0o600);
    } catch {
      // Windows 上 chmod 基本无效，忽略
    }
  }
}
