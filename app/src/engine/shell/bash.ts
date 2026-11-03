/**
 * bash 工具的执行器：just-bash + 真实工作区 + 手机上的限额。
 *
 * docs/25 的结论是 just-bash 在 Hermes 上「常用命令毫秒级、重文本处理秒级」，
 * 所以缺的不是性能，而是**边界**：
 *  - 一个 `seq 1 100000 | awk ...` 要 4.6s，必须有时限；
 *  - 输出可能很大，模型 prompt 装不下，必须截断；
 *  - 手机没有进程，`kill` 不存在，只能靠 AbortSignal 在语句边界停。
 */
import type { IFileSystem } from 'just-bash/browser';
import type { BashOptions } from 'just-bash';

import { Bash } from './runtime';

/** just-bash 的 ExecutionLimits 没有从包入口导出，从 BashOptions 里取 */
export type ExecutionLimits = NonNullable<BashOptions['executionLimits']>;

export interface ShellRunOptions {
  /** 外部取消（用户点停止 / 引擎关闭） */
  signal?: AbortSignal;
  /** 单条命令的墙钟上限，默认 30s */
  timeoutMs?: number;
  /** stdout/stderr 各自的截断上限，默认 24k 字符 */
  maxOutputChars?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
  timedOut: boolean;
  truncated: boolean;
  /** 给模型看的一段文本（带退出码和截断标记） */
  text: string;
}

export interface ShellRunnerOptions {
  fs: IFileSystem;
  cwd?: string;
  env?: Record<string, string>;
  limits?: ExecutionLimits;
  timeoutMs?: number;
  maxOutputChars?: number;
  /** 每次执行前跑一下（例如刷新 glob 索引） */
  beforeRun?: () => unknown;
}

/**
 * 手机的默认限额：比 just-bash 的 normal 紧一档。
 * 依据 docs/25：10 万行 awk 要 4.6s，手机不该让模型随手跑这种量。
 */
export const MOBILE_EXECUTION_LIMITS: ExecutionLimits = {
  maxSourceBytes: 256 * 1024,
  maxCommandCount: 2_000,
  maxLoopIterations: 5_000,
  maxAwkIterations: 5_000,
  maxSedIterations: 5_000,
  maxJqIterations: 5_000,
  maxSubstitutionDepth: 20,
  maxHeredocSize: 256 * 1024,
  maxStringLength: 2 * 1024 * 1024,
  maxOutputSize: 2 * 1024 * 1024,
  maxGlobOperations: 20_000,
  maxTraversalEntries: 5_000,
  maxTraversalDepth: 64,
  maxExecutionTimeMs: 30_000,
};

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_OUTPUT = 24_000;

/** 头 2/3 + 尾 1/3，中间写明截掉了多少 */
export function truncateMiddle(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const head = Math.floor(max * 0.66);
  const tail = max - head;
  const removed = text.length - max;
  return {
    text: `${text.slice(0, head)}\n…[截断 ${removed} 字符]…\n${text.slice(text.length - tail)}`,
    truncated: true,
  };
}

export class ShellRunner {
  readonly cwd: string;
  private readonly options: ShellRunnerOptions;

  constructor(options: ShellRunnerOptions) {
    this.options = options;
    this.cwd = options.cwd ?? '/workspace';
  }

  /**
   * 每次执行都新建一个 Bash。
   *
   * 不是为了"干净"——是因为并发。两个会话同时调 bash 时，复用同一个
   * interpreter 会共享 env/cwd/FS 状态；而 just-bash 的语义本来就是
   * 「exec 之间环境不保留、文件保留」，所以新建实例没有额外代价。
   * Node 上实测构造约 2–3ms（默认布局写进内存根，不碰真实目录）。
   */
  private instance(): Bash {
    return new Bash({
      fs: this.options.fs,
      cwd: this.cwd,
      env: {
        HOME: this.cwd,
        PWD: this.cwd,
        PATH: '/usr/bin:/bin',
        LANG: 'C.UTF-8',
        TERM: 'dumb',
        ...(this.options.env ?? {}),
      },
      executionLimits: { ...MOBILE_EXECUTION_LIMITS, ...(this.options.limits ?? {}) },
      // 手机上没有 python / QuickJS / 网络；显式关掉，别让模型以为能用
      python: false,
      javascript: false,
    });
  }

  async run(command: string, options: ShellRunOptions = {}): Promise<ShellResult> {
    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT;
    const maxOutput = options.maxOutputChars ?? this.options.maxOutputChars ?? DEFAULT_MAX_OUTPUT;
    const started = Date.now();

    if (!command.trim()) {
      return this.finish('', '', 0, started, false);
    }

    await this.options.beforeRun?.();

    const bash = this.instance();
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort(options.signal?.reason);
    if (options.signal) {
      if (options.signal.aborted) forwardAbort();
      else options.signal.addEventListener('abort', forwardAbort, { once: true });
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('timeout'));
    }, timeoutMs);
    // 兜底：即使解释器在纯 JS 循环里没及时响应 abort，也要在超时后交还控制权
    let guardTimer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_resolve, reject) => {
      guardTimer = setTimeout(() => reject(new Error('timeout')), timeoutMs + 1_000);
    });

    try {
      const result = await Promise.race([
        bash.exec(command, {
          signal: controller.signal,
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.env ? { env: options.env } : {}),
        }),
        guard,
      ]);
      if (timedOut) {
        return this.finish(result.stdout ?? '', `命令超时（${timeoutMs}ms）`, 124, started, true, maxOutput);
      }
      return this.finish(result.stdout ?? '', result.stderr ?? '', result.exitCode, started, false, maxOutput);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (timedOut) {
        return this.finish('', `命令超时（${timeoutMs}ms）`, 124, started, true, maxOutput);
      }
      const aborted = controller.signal.aborted;
      return this.finish(
        '',
        aborted ? `命令已取消：${message}` : message,
        aborted ? 130 : 1,
        started,
        false,
        maxOutput,
      );
    } finally {
      clearTimeout(timer);
      if (guardTimer) clearTimeout(guardTimer);
      options.signal?.removeEventListener('abort', forwardAbort);
    }
  }

  private finish(
    stdout: string,
    stderr: string,
    exitCode: number,
    started: number,
    timedOut: boolean,
    max = DEFAULT_MAX_OUTPUT,
  ): ShellResult {
    const out = truncateMiddle(stdout, max);
    const err = truncateMiddle(stderr, max);
    const ms = Date.now() - started;
    return {
      stdout: out.text,
      stderr: err.text,
      exitCode,
      ms,
      timedOut,
      truncated: out.truncated || err.truncated,
      text: formatShellResult({ stdout: out.text, stderr: err.text, exitCode, ms, timedOut, truncated: out.truncated || err.truncated }),
    };
  }
}

/** 把结果压成给模型的一小段文本（DSH 的 bash 工具也是这个形状） */
export function formatShellResult(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
  ms?: number;
  timedOut?: boolean;
  truncated?: boolean;
}): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(parts.length > 0 ? `stderr:\n${result.stderr}` : result.stderr);
  if (parts.length === 0) parts.push('(no output)');
  const meta: string[] = [`exit code: ${result.exitCode}`];
  if (result.ms != null) meta.push(`${result.ms}ms`);
  if (result.timedOut) meta.push('timed out');
  if (result.truncated) meta.push('output truncated');
  parts.push(`[${meta.join(', ')}]`);
  return parts.join('\n');
}
