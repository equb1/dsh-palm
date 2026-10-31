import { printBanner, startEngine } from './server';

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8787);
  const engine = await startEngine(Number.isFinite(port) ? port : 8787);
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
