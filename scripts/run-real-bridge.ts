import { detectRealDsh } from '../engine/src/real/detector';
import { startRealBridge } from '../engine/src/real/server';

async function run() {
  const detected = await detectRealDsh();
  if (!detected) {
    console.error('未检测到本地 DeepSeek Harness！请确保 DSH 正在运行。');
    process.exit(1);
  }
  console.log('检测到 DSH:', detected);

  const bridge = await startRealBridge({
    baseUrl: detected.baseUrl,
    token: detected.token,
    port: 8799, // 测试端口
    pairCode: '', // 关闭配对码，免密直连
  });

  console.log(`真机桥启动成功！端口：${bridge.port}`);
  await bridge.close();
  console.log('真机桥正常关闭。');
}

run().catch(console.error);

