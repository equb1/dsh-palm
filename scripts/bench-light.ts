/**
 * 轻引擎性能基准（P0 1.5 / E7）：TTFT 与整轮耗时 P50/P90。
 *
 * 默认不联网：起一个进程内 SSE mock（8ms/块），warmup 1 次 + N=20 次；
 * `--url` 指向真实 OpenAI 兼容端点（Key/模型走参数或环境变量）。
 *
 * 用法：
 *   node --import tsx scripts/bench-light.ts
 *   node --import tsx scripts/bench-light.ts --n 30
 *   node --import tsx scripts/bench-light.ts --url https://api.example.com/v1 --key sk-… --model deepseek-chat
 *
 * 输出：JSON（stdout）；诊断信息写 stderr，方便 `> bench.json`。
 * 注意：`npm run verify` 不跑这个脚本（会起网络/耗时）。
 */
import { createServer, type Server } from 'node:http';

import { streamChat } from '../app/src/engine/light/provider';
import type { LightModelConfig } from '../app/src/engine/light/types';

interface Sample {
  firstDeltaMs: number;
  totalMs: number;
  chars: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface Percentiles {
  p50: number;
  p90: number;
  min: number;
  max: number;
  mean: number;
}

interface BenchReport {
  endpoint: string;
  model: string;
  warmup: number;
  runs: number;
  ok: boolean;
  failures: number;
  errors: string[];
  firstDeltaMs: Percentiles | null;
  totalMs: Percentiles | null;
  tokens: { input: number; output: number };
  samples: Sample[];
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function intArg(name: string, fallback: number): number {
  const raw = arg(name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** 最近秩（nearest-rank）：第 ceil(p/100 × n) 个，1-based */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarize(values: number[]): Percentiles | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    p50: round(percentile(sorted, 50) as number),
    p90: round(percentile(sorted, 90) as number),
    min: round(sorted[0] as number),
    max: round(sorted[sorted.length - 1] as number),
    mean: round(sum / sorted.length),
  };
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** 进程内 SSE mock：首块 10ms，之后每块 8ms，共 5 块 */
async function startMockServer(): Promise<{ server: Server; baseURL: string }> {
  const server = createServer((req, res) => {
    req.on('data', () => {
      /* 请求体用不到，但要读完才能回 */
    });
    req.on('end', () => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const chunks = ['基准', '测试', '：轻', '引擎', '回答。'];
      let index = 0;
      const tick = (): void => {
        if (index < chunks.length) {
          res.write(sse({ choices: [{ delta: { content: chunks[index] } }] }));
          index += 1;
          setTimeout(tick, 8);
          return;
        }
        res.write(sse({ choices: [{ finish_reason: 'stop' }] }));
        res.write(sse({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 10 } }));
        res.write('data: [DONE]\n\n');
        res.end();
      };
      setTimeout(tick, 10);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock server 拿不到端口');
  return { server, baseURL: `http://127.0.0.1:${address.port}/v1` };
}

async function runOnce(config: LightModelConfig): Promise<Sample> {
  const started = performance.now();
  let firstDeltaAt: number | null = null;
  const result = await streamChat(
    config,
    {
      messages: [
        { role: 'system', content: '你是基准测试。' },
        { role: 'user', content: '用一句话说明轻引擎在做什么。' },
      ],
      idleTimeoutMs: 45_000,
    },
    {
      onText: () => {
        if (firstDeltaAt === null) firstDeltaAt = performance.now();
      },
      onThinking: () => {
        if (firstDeltaAt === null) firstDeltaAt = performance.now();
      },
      onToolCallDelta: () => {
        if (firstDeltaAt === null) firstDeltaAt = performance.now();
      },
    },
  );
  const totalMs = performance.now() - started;
  return {
    firstDeltaMs: round(firstDeltaAt === null ? totalMs : firstDeltaAt - started),
    totalMs: round(totalMs),
    chars: result.text.length,
    ...(result.usage?.inputTokens !== undefined ? { inputTokens: result.usage.inputTokens } : {}),
    ...(result.usage?.outputTokens !== undefined ? { outputTokens: result.usage.outputTokens } : {}),
  };
}

async function main(): Promise<void> {
  const n = intArg('n', 20);
  const warmup = intArg('warmup', 1);
  const url = arg('url');
  const model = arg('model') ?? process.env.LIGHT_MODEL ?? 'mock-light';
  const apiKey = arg('key') ?? process.env.LIGHT_API_KEY ?? '';

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.error('用法: node --import tsx scripts/bench-light.ts [--n 20] [--url <baseURL> --key <key> --model <model>]');
    return;
  }
  if (url && !apiKey) {
    console.error('缺少 Key：--key 或环境变量 LIGHT_API_KEY');
    process.exitCode = 2;
    return;
  }

  let mock: { server: Server; baseURL: string } | null = null;
  if (!url) mock = await startMockServer();
  const baseURL = url ?? (mock as { baseURL: string }).baseURL;
  const config: LightModelConfig = {
    baseURL,
    apiKey: apiKey || 'bench-local',
    model,
    providerName: url ? 'real' : 'mock',
  };

  const samples: Sample[] = [];
  let failures = 0;
  const errors: string[] = [];
  try {
    for (let i = 0; i < warmup; i += 1) {
      try {
        await runOnce(config);
      } catch (error) {
        console.error(`warmup ${i + 1} 失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (let i = 0; i < n; i += 1) {
      try {
        samples.push(await runOnce(config));
      } catch (error) {
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        console.error(`第 ${i + 1} 次失败：${message}`);
      }
    }
  } finally {
    if (mock) {
      await new Promise<void>((resolve) => {
        mock?.server.closeAllConnections?.();
        mock?.server.close(() => resolve());
      });
    }
  }

  const report: BenchReport = {
    endpoint: url ? 'real' : 'mock',
    model,
    warmup,
    runs: n,
    ok: failures === 0 && samples.length === n,
    failures,
    errors: [...new Set(errors.map((message) => message.slice(0, 160)))],
    firstDeltaMs: summarize(samples.map((sample) => sample.firstDeltaMs)),
    totalMs: summarize(samples.map((sample) => sample.totalMs)),
    tokens: {
      input: samples.reduce((sum, sample) => sum + (sample.inputTokens ?? 0), 0),
      output: samples.reduce((sum, sample) => sum + (sample.outputTokens ?? 0), 0),
    },
    samples,
  };
  if (!report.ok) {
    console.error(`基准未全部成功：${failures} 次失败（共 ${n} 次）。先看上面的错误和模型渠道配置。`);
    process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
