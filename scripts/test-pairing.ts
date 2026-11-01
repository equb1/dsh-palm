/**
 * 验证配对鉴权：
 *   1) 没有配对码 -> 4001
 *   2) 配对码对 -> 连上，并收到 device.paired（设备密钥）
 *   3) 用设备密钥连 -> 不用配对码也能连
 *   4) 错的密钥 -> 4001
 *
 *   node --import tsx scripts/test-pairing.ts
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import WebSocket from 'ws';

import { startRealBridge } from '../engine/src/real/server';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8897';
const token = process.argv[3] ?? '';
const PAIR = '246810';

interface ConnectResult {
  ok: boolean;
  code?: number;
  reason?: string;
  deviceKey?: string;
  frames: Array<Record<string, unknown>>;
}

function connect(port: number, query: string, waitMs = 2500): Promise<ConnectResult> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
    const frames: Array<Record<string, unknown>> = [];
    let settled = false;
    const done = (r: ConnectResult): void => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(r);
    };

    ws.on('open', () => {
      setTimeout(() => done({ ok: true, frames, deviceKey: findKey(frames) }), waitMs);
    });
    ws.on('message', (raw) => {
      try {
        frames.push(JSON.parse(String(raw)) as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    });
    ws.on('close', (code, reason) => done({ ok: false, code, reason: reason.toString(), frames }));
    ws.on('error', () => done({ ok: false, code: -1 }));
    setTimeout(() => done({ ok: ws.readyState === WebSocket.OPEN, frames, deviceKey: findKey(frames) }), waitMs + 500);
  });
}

function findKey(frames: Array<Record<string, unknown>>): string | undefined {
  for (const f of frames) {
    if (f.event === 'device.paired') {
      const data = f.data as { key?: string } | undefined;
      if (data?.key) return data.key;
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  if (!token) {
    console.error('用法: node --import tsx scripts/test-pairing.ts <baseUrl> <token>');
    process.exit(1);
  }

  const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-pair-'));
  const devicesFile = join(dir, 'devices.json');
  const bridge = await startRealBridge({ baseUrl, token, port: 0, pairCode: PAIR, devicesFile });
  const port = bridge.port;
  console.log('桥起在', port, '| 配对码', PAIR);

  // 1) 无码
  const none = await connect(port, '');
  console.log('① 不带码:', none.ok ? '连上了（不对）' : `被拒 code=${none.code} reason=${none.reason}`);

  // 2) 错码
  const wrong = await connect(port, '?pair=000000');
  console.log('② 错码:', wrong.ok ? '连上了（不对）' : `被拒 code=${wrong.code}`);

  // 3) 正确配对码
  const paired = await connect(port, '?pair=' + PAIR);
  console.log('③ 正确配对码:', paired.ok ? '连上' : '被拒', '| 拿到设备密钥:', paired.deviceKey ? '有' : '没有');

  // 4) 用设备密钥
  const byKey = paired.deviceKey ? await connect(port, '?key=' + paired.deviceKey) : { ok: false, frames: [] };
  console.log('④ 用设备密钥:', byKey.ok ? '连上（免配对码）' : '被拒');

  // 5) 错密钥
  const badKey = await connect(port, '?key=' + 'f'.repeat(64));
  console.log('⑤ 错密钥:', badKey.ok ? '连上了（不对）' : `被拒 code=${badKey.code}`);

  // 文件里应该只有一把
  const saved = JSON.parse(readFileSync(devicesFile, 'utf8')) as { devices: Array<{ key: string }> };
  console.log('密钥文件里的设备数:', saved.devices.length);

  const ok = !none.ok && !wrong.ok && paired.ok && !!paired.deviceKey && byKey.ok && !badKey.ok && saved.devices.length === 1;
  console.log(ok ? '\n✓ 配对鉴权符合预期' : '\n✗ 配对鉴权有问题');

  await bridge.close();
  process.exit(ok ? 0 : 1);
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
