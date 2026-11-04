/**
 * 轻引擎能力门（纯函数）。
 *
 * 在工具真正执行 **之前** 判断轻引擎能不能做：
 *  - bash 里只要有一个 shell 段调用了 python/node/git/ffmpeg/apt/make/编译器，
 *    整条命令都拒绝（绝不执行前缀，避免半截副作用）；
 *  - read_file 目标 >10MB；
 *  - 轻引擎工具表里没有的工具 / proot 专属工具；
 *  - generate_image 不在这里拦（它需要的是渠道配置，执行时会报可读错误）。
 *
 * 返回 capability_missing 后 agent 会补 `[CAPABILITY_MISSING] not executed` 的
 * tool 结果、生成 capability block、结束这一轮（见 light/agent.ts）。
 */

export const LIGHT_READ_MAX_BYTES = 10 * 1024 * 1024;

export interface CapabilityFailure {
  ok: false;
  code: 'capability_missing';
  tool: string;
  summary: string;
  reason: string;
  missing: string[];
  command?: string;
}

export type CapabilityResult = { ok: true } | CapabilityFailure;

export interface CapabilityInput {
  name: string;
  args: Record<string, unknown>;
  /** 工具是否在轻引擎工具表里；false = 未知 / proot 专属 */
  known?: boolean;
  /** read_file 目标文件大小（agent 先 stat）；优先于 args 里的 bytes */
  size?: number;
}

/** 被能力门拦下的程序 → 归一化名字（python3.12 算 python） */
const BLOCKED_PROGRAMS: Record<string, string> = {
  python: 'python',
  'python2': 'python',
  'python3': 'python',
  py: 'python',
  node: 'node',
  nodejs: 'node',
  npm: 'npm',
  npx: 'npx',
  pnpm: 'pnpm',
  yarn: 'yarn',
  bun: 'bun',
  deno: 'deno',
  pip: 'pip',
  'pip3': 'pip',
  pipenv: 'pip',
  poetry: 'poetry',
  conda: 'conda',
  uv: 'uv',
  git: 'git',
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  apt: 'apt',
  'apt-get': 'apt',
  dpkg: 'dpkg',
  make: 'make',
  cmake: 'cmake',
  gcc: 'gcc',
  'g++': 'g++',
  cc: 'gcc',
  clang: 'clang',
  'clang++': 'clang',
  javac: 'javac',
  java: 'java',
  rustc: 'rustc',
  cargo: 'cargo',
  go: 'go',
  ruby: 'ruby',
  php: 'php',
  perl: 'perl',
  mvn: 'mvn',
  gradle: 'gradle',
  tsc: 'tsc',
  pytest: 'pytest',
  jest: 'jest',
  vitest: 'vitest',
  docker: 'docker',
  unzip: 'unzip',
  zip: 'zip',
};

/** 这些词出现在脚本/解释器前后都说明是「完整引擎的命令」 */
const COMPILER_WORDS = new Set([
  'gcc',
  'g++',
  'cc',
  'clang',
  'clang++',
  'javac',
  'rustc',
  'cargo',
  'go',
  'make',
  'cmake',
  'mvn',
  'gradle',
  'tsc',
  'pytest',
  'jest',
  'vitest',
]);

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'fish']);

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function basename(token: string): string {
  const value = token.replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  const leaf = value.split('/').pop() ?? value;
  return leaf.replace(/\.exe$/i, '').trim();
}

/** 程序名去掉版本号：python3.12 → python3，再映射成 python */
function canonicalProgram(token: string): string {
  const base = basename(token).toLowerCase();
  if (/^python[0-9.]*$/.test(base)) return 'python';
  if (/^pip[0-9.]*$/.test(base)) return 'pip';
  if (/^node[0-9.]*$/.test(base)) return 'node';
  return BLOCKED_PROGRAMS[base] ?? base;
}

function isBlockedProgram(token: string): string | null {
  const canonical = canonicalProgram(token);
  const normalized = token.toLowerCase().replace(/\.exe$/i, '');
  if (BLOCKED_PROGRAMS[normalized]) return BLOCKED_PROGRAMS[normalized] as string;
  if (/^python[0-9.]*$/.test(normalized)) return 'python';
  if (/^pip[0-9.]*$/.test(normalized)) return 'pip';
  if (/^node[0-9.]*$/.test(normalized)) return 'node';
  return BLOCKED_PROGRAMS[canonical] ?? null;
}

/** 粗略按 shell 分隔符切段；引号里的分隔符不切，括号/命令替换也当作段边界。 */
export function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: "'" | '"' | '`' | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] as string;
    const next = command[i + 1];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '\\' && next) {
      current += ch + next;
      i += 1;
      continue;
    }
    if (ch === '#' && (current.trim() === '' || /\s$/.test(current))) {
      // 行内注释
      while (i < command.length && command[i] !== '\n') i += 1;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '|' || ch === '&' || ch === '(' || ch === ')') {
      // `&&` / `||` / `$(` 都切成段；连续分隔符会产生空段，后面过滤
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
    if (ch === '$' && next === '(') {
      // 把 $( 后面的内容当下一条命令
      if (current.slice(0, -1).trim()) segments.push(current.slice(0, -1).trim());
      current = '';
      i += 1;
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

/** 去掉 env 赋值、sudo/env/nohup 等前缀，取出真正要执行的命令名 */
function tokensOf(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i] as string;
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens.map((token) => token.replace(/^["']|["']$/g, '')).filter(Boolean);
}

const PREFIX_WORDS = new Set([
  '!',
  'sudo',
  'env',
  'command',
  'builtin',
  'exec',
  'nohup',
  'time',
  'nice',
  'stdbuf',
  'timeout',
  'then',
  'do',
  '{',
  '}',
  '[',
  ']',
]);

function commandWordOf(segment: string): { word: string; rest: string[] } | null {
  const tokens = tokensOf(segment);
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] as string;
    if (PREFIX_WORDS.has(token) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1;
      // `timeout 30 python ...`：跳过 timeout 的时长参数
      if (token === 'timeout' && index < tokens.length && /^[0-9]+[smhd]?$/.test(tokens[index] as string)) {
        index += 1;
      }
      continue;
    }
    return { word: token, rest: tokens.slice(index + 1) };
  }
  return null;
}

export interface BashCapability {
  blocked: boolean;
  missing: string[];
  segment?: string;
}

/**
 * 检查一条 bash 命令。任何一个段命中就整体拒绝；
 * `python -c "..."` / `bash -c "python ..."` / `xargs python` 都算。
 */
export function inspectBashCommand(command: string): BashCapability {
  const segments = splitShellSegments(command);
  const missing: string[] = [];
  const inspect = (segment: string, depth: number): boolean => {
    if (depth > 3) return false;
    const parsed = commandWordOf(segment);
    if (!parsed) return false;
    const word = basename(parsed.word).toLowerCase();

    // xargs / env 后面跟的才是真命令
    if (word === 'xargs' || word === 'env' || word === 'sudo') {
      let index = 0;
      while (index < parsed.rest.length) {
        const candidate = parsed.rest[index] as string;
        if (candidate.startsWith('-')) {
          index += 1;
          continue;
        }
        return inspect(parsed.rest.slice(index).join(' '), depth + 1);
      }
    }

    // bash/sh -c "python ..."
    if (SHELLS.has(word)) {
      const cIndex = parsed.rest.findIndex((arg) => arg === '-c' || arg === '--command');
      if (cIndex >= 0) {
        return inspect(parsed.rest.slice(cIndex + 1).join(' '), depth + 1);
      }
    }

    const blocked = isBlockedProgram(parsed.word);
    if (blocked) {
      if (!missing.includes(blocked)) missing.push(blocked);
      return true;
    }

    // 解释器/编译器出现在管道右边（如 `cat x | python -`）时，
    // 前面已经切段，这里只需要处理段首；保留对 `tee` 之类误伤为零。
    return false;
  };

  for (const segment of segments) {
    inspect(segment, 0);
    if (missing.length > 0) {
      return { blocked: true, missing, segment };
    }
  }
  return { blocked: false, missing: [] };
}

function shellSummary(command: string): string {
  const first = command.split('\n')[0] ?? '';
  const flat = first.replace(/\s+/g, ' ').trim();
  return flat.length <= 80 ? `执行命令：${flat}` : `执行命令：${flat.slice(0, 79)}…`;
}

function numberFrom(args: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

/**
 * 能力门入口。只判断「轻引擎能不能做」，不判断参数对不对、不碰副作用。
 */
export function checkToolCapability(input: CapabilityInput): CapabilityResult {
  const name = input.name;
  const args = input.args ?? {};

  // 生图缺的是渠道配置，不是 proot 能力；交给工具自己报错。
  if (name === 'generate_image') return { ok: true };

  const known = input.known ?? isLightToolName(name);
  if (!known) {
    return {
      ok: false,
      code: 'capability_missing',
      tool: name,
      summary: `调用 ${name}`,
      reason: `轻引擎没有「${name}」这个工具；它属于完整引擎（proot）的能力。`,
      missing: [name],
    };
  }

  if (name === 'bash') {
    const command = asString(args.command).trim();
    if (!command) return { ok: true };
    const inspected = inspectBashCommand(command);
    if (inspected.blocked) {
      return {
        ok: false,
        code: 'capability_missing',
        tool: 'bash',
        summary: shellSummary(command),
        reason:
          '轻引擎的 bash 是受限 shell，没有 Python/Node/git/ffmpeg/apt/make/编译器；' +
          '这条命令整条都不会执行（不会只跑前半段）。',
        missing: inspected.missing,
        command,
      };
    }
    return { ok: true };
  }

  if (name === 'read_file') {
    const size = input.size ?? numberFrom(args, ['bytes', 'size']);
    if (typeof size === 'number' && size > LIGHT_READ_MAX_BYTES) {
      const path = asString(args.path) || '/';
      return {
        ok: false,
        code: 'capability_missing',
        tool: 'read_file',
        summary: `读取 ${path}`,
        reason: `文件约 ${(size / 1024 / 1024).toFixed(1)}MB，超过轻引擎单次读取上限 10MB；完整引擎可以直接读。`,
        missing: ['read_file:>10MB'],
        command: path,
      };
    }
  }

  return { ok: true };
}

/** 给 UI 展示的缺失能力清单去重 */
export function describeMissing(missing: string[]): string {
  return [...new Set(missing)].join('、');
}

export const LIGHT_ONLY_TOOL_NAMES = [
  'bash',
  'read_file',
  'write_file',
  'list_dir',
  'create_docx',
  'create_xlsx',
  'read_docx',
  'read_xlsx',
  'generate_image',
  'ask_user_question',
] as const;

export function isLightToolName(name: string): boolean {
  return (LIGHT_ONLY_TOOL_NAMES as readonly string[]).includes(name);
}

export { COMPILER_WORDS };
