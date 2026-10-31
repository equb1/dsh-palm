import { startRealBridge } from './server';

/**
 * 用法：
 *   node --import tsx engine/src/real/main.ts <baseUrl> <token> [port]
 * 例：
 *   node --import tsx engine/src/real/main.ts http://127.0.0.1:8899 iqMrfs… 8788
 */
async function main(): Promise<void> {
  const baseUrl = process.argv[2];
  const token = process.argv[3];
  const port = Number(process.argv[4] ?? 8788);

  if (!baseUrl || !token) {
    console.error('用法: node --import tsx engine/src/real/main.ts <baseUrl> <token> [port]');
    process.exit(1);
  }

  const pairCode = process.env.DSH_PALM_NO_PAIR === '1'
    ? ''
    : String(Math.floor(100000 + Math.random() * 900000));

  const bridge = await startRealBridge({ baseUrl, token, port, pairCode });
  console.log('');
  console.log('  dsh-palm 真引擎桥');
  console.log(`  WS     ws://localhost:${bridge.port}/ws`);
  console.log(`  上游   ${baseUrl}`);
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
