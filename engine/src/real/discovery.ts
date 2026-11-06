/**
 * LAN 直连的 mDNS 广播（M3.2）。
 *
 * 只广播「我是谁、WS 端口、指纹」，不广播任何会话正文或凭据。
 * 手机端用 Android NsdManager 发现 `_dsh-palm._tcp`；电脑/模拟器也可以用
 * 任意 mDNS 浏览器看到。找不到组播（部分 Wi-Fi/容器）时静默降级，UI 仍可手填地址。
 */
import createMdns from 'multicast-dns';
import { networkInterfaces } from 'node:os';

export interface BridgeAdvertiser {
  close(): void;
}

export interface AdvertiseInput {
  port: number;
  hostId: string;
  name: string;
  kind: 'phone' | 'desktop';
  fingerprint: string;
}

const SERVICE = '_dsh-palm._tcp.local';
const SERVICE_ENUM = '_services._dns-sd._udp.local';

function safeLabel(value: string): string {
  const label = value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  return label.length > 0 ? label.slice(0, 63) : 'dsh-palm';
}

function localAddresses(): string[] {
  const out: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (!entry.internal && entry.family === 'IPv4' && entry.address) out.push(entry.address);
    }
  }
  return [...new Set(out)];
}

export function advertiseBridge(input: AdvertiseInput): BridgeAdvertiser | null {
  let mdns: ReturnType<typeof createMdns> | null = null;
  try {
    mdns = createMdns({ loopback: true });
  } catch {
    return null;
  }

  const instance = `${safeLabel(input.hostId)}.${SERVICE}`;
  const target = `${safeLabel(input.hostId)}.local`;
  const txt = [
    'v=1',
    `id=${input.hostId}`,
    `name=${input.name}`,
    `kind=${input.kind}`,
    `path=/ws`,
    `fp=${input.fingerprint}`,
  ];
  const ttl = 120;

  const answers = (): Array<Record<string, unknown>> => {
    const records: Array<Record<string, unknown>> = [
      { name: SERVICE, type: 'PTR', ttl, data: instance },
      {
        name: instance,
        type: 'SRV',
        ttl,
        data: { port: input.port, weight: 0, priority: 0, target },
      },
      { name: instance, type: 'TXT', ttl, data: txt },
    ];
    for (const address of localAddresses()) {
      records.push({ name: target, type: 'A', ttl, data: address });
    }
    return records;
  };

  const respond = (): void => {
    try {
      mdns?.respond({ answers: answers() });
    } catch {
      /* 组播被系统拒绝时不影响桥本身 */
    }
  };

  mdns.on('query', (packet) => {
    const questions = packet.questions ?? [];
    const asked = questions.some(
      (q) =>
        q.name === SERVICE
        || q.name === SERVICE_ENUM
        || q.name.toLowerCase() === instance.toLowerCase()
        || q.name.toLowerCase() === target,
    );
    if (!asked) return;
    const records = answers();
    if (questions.some((q) => q.name === SERVICE_ENUM)) {
      records.unshift({ name: SERVICE_ENUM, type: 'PTR', ttl, data: SERVICE });
    }
    try {
      mdns?.respond({ answers: records });
    } catch {
      /* ignore */
    }
  });
  mdns.on('error', () => {
    /* 网络切换/组播不可用时静默；手动地址仍然可用 */
  });

  respond();
  const timer = setInterval(respond, 30_000);
  (timer as unknown as { unref?: () => void }).unref?.();

  return {
    close: () => {
      clearInterval(timer);
      try {
        mdns?.destroy();
      } catch {
        /* ignore */
      }
      mdns = null;
    },
  };
}
