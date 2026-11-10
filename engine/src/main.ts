import { networkInterfaces } from 'node:os';
import { printBanner, startEngine } from './server';
import { detectRealDsh } from './real/detector';
import { startRealBridge } from './real/server';
import { loadBridgeIdentity } from './real/identity';

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8787);
  const targetPort = Number.isFinite(port) ? port : 8787;

  console.log('🔍 正在探测本机运行中的 DeepSeek Harness 电脑宿主...');
  const detected = await detectRealDsh();

  if (detected) {
    console.log(`✅ 成功接入本机 DeepSeek Harness！(上游: ${detected.baseUrl})`);
    const bridge = await startRealBridge({
      baseUrl: detected.baseUrl,
      token: detected.token,
      port: targetPort,
      pairCode: '', // 关闭配对码，局域网免密直连
      devicesFile: '.dsh-palm-devices.json',
    });

    const identity = loadBridgeIdentity(undefined, process.env.DSH_PALM_HOST_NAME);
    const lan = Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => !entry.internal && entry.family === 'IPv4')
      .map((entry) => entry.address)
      .filter((address): address is string => typeof address === 'string');

    console.log('');
    console.log('  ======================================================');
    console.log('  🚀 dsh-palm 真引擎桥已启动（已连通电脑 DeepSeek Harness）');
    console.log(`  WS  : ws://localhost:${bridge.port}/ws`);
    for (const addr of lan) {
      console.log(`  LAN : ws://${addr}:${bridge.port}/ws`);
    }
    console.log(`  宿主: ${identity.name} · ${identity.hostId}`);
    console.log('  配对: 已免密放行（手机输入 IP 直接连）');
    console.log('  执行: 手机发出的消息将真正投递到电脑 DSH 并实时流式回传');
    console.log('  ======================================================');
    console.log('  按 Ctrl+C 停止\n');

    const shutdown = async (): Promise<void> => {
      await bridge.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
    return;
  }

  console.log('⚠️ 未检测到运行中的 DeepSeek Harness，启动独立轻引擎服务...');
  const engine = await startEngine(targetPort);
  printBanner(engine.port);
  console.log('  按 Ctrl+C 停止\n');

  const shutdown = async (): Promise<void> => {
    await engine.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('引擎启动失败：', err);
  process.exit(1);
});
