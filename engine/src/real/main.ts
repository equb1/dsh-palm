import { networkInterfaces } from 'node:os';
import { startRealBridge } from './server';
import { loadBridgeIdentity } from './identity';

/**
 * 用法：
 *   node --import tsx engine/src/real/main.ts <baseUrl> <token> [port]
 * 例：
 *   node --import tsx engine/src/real/main.ts http://127.0.0.1:8899 iqMrfs… 8788
 *
 * 环境变量：
 *   DSH_PALM_NO_PAIR=1   关闭鉴权（只在本机调试时用）
 *   DSH_PALM_DEVICES     设备密钥文件路径，默认 ./.dsh-palm-devices.json
 */
async function main(): Promise<void> {
  const baseUrl = process.argv[2];
  const token = process.argv[3];
  const port = Number(process.argv[4] ?? 8788);

  if (!baseUrl || !token) {
    console.error('用法: node --import tsx engine/src/real/main.ts <baseUrl> <token> [port]');
    process.exit(1);
  }

  const pairCode =
    process.env.DSH_PALM_NO_PAIR === '1' ? '' : String(Math.floor(100000 + Math.random() * 900000));

  // 设备密钥存在桥旁边；换目录就等于清空所有已配对设备
  const devicesFile = process.env.DSH_PALM_DEVICES ?? '.dsh-palm-devices.json';

  const bridge = await startRealBridge({ baseUrl, token, port, pairCode, devicesFile });
  const identity = loadBridgeIdentity(undefined, process.env.DSH_PALM_HOST_NAME);
  const lan = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal && entry.family === 'IPv4')
    .map((entry) => entry.address)
    .filter((address): address is string => typeof address === 'string');

  console.log('');
  console.log('  dsh-palm 真引擎桥');
  console.log(`  WS     ws://localhost:${bridge.port}/ws`);
  for (const address of lan) console.log(`  LAN    ws://${address}:${bridge.port}/ws`);
  console.log(`  宿主   ${identity.name} · ${identity.hostId} · ${identity.fingerprint}`);
  console.log(`  mDNS   _dsh-palm._tcp（局域网可发现）`);
  console.log(`  上游   ${baseUrl}`);
  if (pairCode) {
    console.log(`  配对码  ${pairCode}   首次连要输，之后这台设备免输`);
  } else {
    console.log('  配对码  已关闭鉴权（仅限本机调试）');
  }
  console.log('  按 Ctrl+C 停止');
  console.log('');

  const stop = async (): Promise<void> => {
    await bridge.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

void main();
