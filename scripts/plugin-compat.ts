/**
 * dsh-plugin-check：静态分析一个 DSH 插件/包目录，给出手机兼容等级（L0–L4）。
 *
 * 用法：
 *   node --import tsx scripts/plugin-compat.ts [node_modules 目录] [输出目录]
 *
 * 默认扫手机运行时镜像里的 dsh 依赖：
 *   runtime/build/stage/opt/dsh/node_modules
 *
 * 等级定义（见 docs/23-requirements.md 第 4 节）：
 *   L0  Web UI 插件：官方 web 前端 + WebView，零改动
 *   L1  纯 JS 服务端插件：只需 path/events/url 等轻内建，轻 TS 引擎 + shim 可跑
 *   L2  需要 Node 内建（fs/http/net/crypto/worker_threads…）：内嵌 Node 或完整引擎
 *   L3  需要真实二进制（child_process / python / git / ffmpeg / libreoffice）：完整引擎（proot）
 *   L4  需要桌面能力（Electron 等）：电脑端执行
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';

type Tier = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'no-code';

interface PackageReport {
  name: string;
  version: string;
  tier: Tier;
  effectiveTier: Tier;
  reasons: string[];
  engines?: string;
  nodeBuiltins: string[];
  dshDeps: string[];
  hasNativeAddon: boolean;
  hasChildProcess: boolean;
  hasElectron: boolean;
  usesProcess: boolean;
  usesDynamicImport: boolean;
  jsFiles: number;
}

const TIER_RANK: Record<Tier, number> = { 'no-code': 0, L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };
const RANK_TIER: Record<number, Tier> = { 1: 'L1', 2: 'L2', 3: 'L3', 4: 'L4' };

/** 轻内建：纯 JS 实现，shim 成本低 */
const LIGHT_BUILTINS = new Set([
  'path',
  'url',
  'events',
  'util',
  'assert',
  'querystring',
  'string_decoder',
  'buffer',
  'stream',
  'timers',
  'punycode',
  'constants',
]);

/** 重内建：需要真正的宿主能力 */
const HEAVY_BUILTINS = new Set([
  'fs',
  'http',
  'https',
  'http2',
  'net',
  'tls',
  'dns',
  'crypto',
  'zlib',
  'os',
  'worker_threads',
  'cluster',
  'v8',
  'vm',
  'async_hooks',
  'readline',
  'repl',
  'tty',
  'dgram',
  'inspector',
  'module',
  'process',
  'child_process',
]);

const KNOWN_BUILTINS = new Set([
  ...LIGHT_BUILTINS,
  ...HEAVY_BUILTINS,
]);

const BUILTIN_RE = /(?:from\s+|require\(\s*)['"](?:node:)?([a-z_][a-z0-9_]*)['"]/gi;
const CHILD_PROCESS_RE = /child_process|execFileSync|execSync|spawnSync|\bspawn\(|\bexecFile\(/;
/** 只认真正的 electron 导入，避免被注释/文档里的 "electron" 误判 */
const ELECTRON_RE = /from\s+['"]electron['"]|require\(\s*['"]electron['"]\s*\)/;
const NATIVE_ADDON_RE = /require\([^)]*\.node['"]\)|\.node['"]\s*\)/;
const PROCESS_RE = /\bprocess\.(env|argv|platform|cwd|exit|versions)\b/;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(/;
/** 只作为注记，不参与定级（避免注释里的字样误判） */
const EXTERNAL_BIN_RE = /['"`](python3?|ffmpeg|pandoc|libreoffice|git)['"`]/;

function listFiles(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 6) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      listFiles(full, out, depth + 1);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.cjs')) {
      out.push(full);
    }
  }
  return out;
}

function classify(pkgDir: string, nm: string): PackageReport | null {
  const pkgJsonPath = join(pkgDir, 'package.json');
  let pkg: {
    name?: string;
    version?: string;
    engines?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  } catch {
    return null;
  }
  const name = pkg.name ?? relative(nm, pkgDir);
  const deps = Object.keys({ ...(pkg.dependencies ?? {}) });
  const engines = pkg.engines?.node;

  const files = listFiles(pkgDir);
  const builtins = new Set<string>();
  let hasChildProcess = false;
  let hasElectron = false;
  let hasNativeAddon = deps.some((d) => /node-addon|node-gyp|prebuild|bindings|napi/i.test(d));
  let usesProcess = false;
  let usesDynamicImport = false;
  let externalBin = '';

  for (const file of files) {
    let text: string;
    try {
      if (statSync(file).size > 6 * 1024 * 1024) continue;
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(BUILTIN_RE)) {
      const raw = match[1] ?? '';
      if (!raw) continue;
      const head = raw.split('/')[0] ?? raw;
      const isNodePrefix = /['"]node:/.test(match[0] ?? '');
      if (!isNodePrefix && !KNOWN_BUILTINS.has(head)) continue;
      builtins.add(head);
    }
    if (CHILD_PROCESS_RE.test(text)) hasChildProcess = true;
    if (ELECTRON_RE.test(text)) hasElectron = true;
    if (NATIVE_ADDON_RE.test(text)) hasNativeAddon = true;
    if (PROCESS_RE.test(text)) usesProcess = true;
    if (DYNAMIC_IMPORT_RE.test(text)) usesDynamicImport = true;
    if (!externalBin) {
      const m = text.match(EXTERNAL_BIN_RE);
      if (m) externalBin = m[0];
    }
  }

  const heavy = [...builtins].filter((b) => HEAVY_BUILTINS.has(b));
  const light = [...builtins].filter((b) => LIGHT_BUILTINS.has(b));

  const reasons: string[] = [];
  let tier: Tier;
  const short = name.replace(/^@[^/]+\//, '');

  if (/^dsh-client-|^dsh-web-frontend$/.test(short)) {
    tier = 'L0';
    reasons.push('web UI 包（官方 web 前端里渲染）');
  } else if (hasElectron) {
    tier = 'L4';
    reasons.push('引用 Electron / 桌面 API');
  } else if (hasChildProcess || hasNativeAddon) {
    tier = 'L3';
    if (hasChildProcess) reasons.push('使用 child_process');
    if (hasNativeAddon) reasons.push('含原生扩展（.node / node-gyp）');
    if (externalBin) reasons.push(`调用了外部程序 ${externalBin}`);
  } else if (heavy.length > 0) {
    tier = 'L2';
    reasons.push(`需要 Node 内建：${heavy.slice(0, 5).join(', ')}`);
  } else if (files.length > 0) {
    tier = 'L1';
    reasons.push(light.length > 0 ? `只用轻内建：${light.join(', ')}` : '纯 JS');
  } else {
    tier = 'no-code';
    reasons.push('无 JS 代码（数据/样式包）');
  }

  if (engines) reasons.push(`engines: node ${engines}`);

  return {
    name,
    version: pkg.version ?? '?',
    tier,
    effectiveTier: tier,
    reasons,
    engines,
    nodeBuiltins: [...builtins].sort(),
    dshDeps: deps.filter((d) => d.startsWith('@deepseek-ai/')),
    hasNativeAddon,
    hasChildProcess,
    hasElectron,
    usesProcess,
    usesDynamicImport,
    jsFiles: files.length,
  };
}

/**
 * 依赖闭包：一个包自身是 L2、但依赖了 L3 的包，实际也得按 L3 算。
 * UI 包（L0）是渲染产物，不参与传播（它的依赖是打包进 web 前端的）。
 */
function applyDependencyTiers(reports: PackageReport[]): void {
  const byName = new Map(reports.map((r) => [r.name, r]));
  const memo = new Map<string, Tier>();

  const visit = (report: PackageReport, stack: Set<string>): Tier => {
    if (report.tier === 'L0' || report.tier === 'no-code') return report.tier;
    const cached = memo.get(report.name);
    if (cached) return cached;
    if (stack.has(report.name)) return report.tier;
    stack.add(report.name);

    let rank = TIER_RANK[report.tier];
    let driver = '';
    for (const dep of report.dshDeps) {
      const child = byName.get(dep);
      if (!child) continue;
      const childTier = visit(child, stack);
      if (TIER_RANK[childTier] > rank) {
        rank = TIER_RANK[childTier];
        driver = dep;
      }
    }
    stack.delete(report.name);

    const effective = rank === TIER_RANK[report.tier] ? report.tier : (RANK_TIER[rank] ?? report.tier);
    if (driver) report.reasons.push(`依赖 ${driver.replace('@deepseek-ai/', '')} 需要更高运行时`);
    memo.set(report.name, effective);
    return effective;
  };

  for (const report of reports) report.effectiveTier = visit(report, new Set());
}

function main(): void {
  const input = resolve(process.argv[2] ?? 'runtime/build/stage/opt/dsh/node_modules');

  // 单包模式：直接传一个插件目录，打印判定结果，不写报告文件
  if (statSync(input).isDirectory() && existsSync(join(input, 'package.json'))) {
    const report = classify(input, dirname(input));
    if (!report) {
      console.error(`读不出 package.json: ${input}`);
      process.exit(1);
    }
    console.log(`包：${report.name}@${report.version}`);
    console.log(`等级：${report.tier}`);
    console.log(`理由：${report.reasons.join('；')}`);
    console.log(`Node 内建：${report.nodeBuiltins.join(', ') || '（无）'}`);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const nm = input;
  const outDir = resolve(process.argv[3] ?? 'reports');
  const scope = join(nm, '@deepseek-ai');
  const dirs = readdirSync(scope, { withFileTypes: true }).filter((d) => d.isDirectory());
  const reports: PackageReport[] = [];
  for (const dir of dirs) {
    const report = classify(join(scope, dir.name), nm);
    if (report) reports.push(report);
  }
  applyDependencyTiers(reports);
  reports.sort(
    (a, b) =>
      a.effectiveTier.localeCompare(b.effectiveTier) ||
      a.tier.localeCompare(b.tier) ||
      a.name.localeCompare(b.name),
  );

  const selfCounts = new Map<Tier, number>();
  const effectiveCounts = new Map<Tier, number>();
  for (const r of reports) {
    selfCounts.set(r.tier, (selfCounts.get(r.tier) ?? 0) + 1);
    effectiveCounts.set(r.effectiveTier, (effectiveCounts.get(r.effectiveTier) ?? 0) + 1);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'plugin-compat.json'), JSON.stringify(reports, null, 2));

  const lines: string[] = [];
  lines.push('# DSH 插件手机兼容矩阵（自动生成）', '');
  lines.push(`> 生成命令：\`node --import tsx scripts/plugin-compat.ts ${relative(process.cwd(), nm)}\``);
  lines.push(`> 扫描包数：${reports.length}；等级定义见 docs/23-requirements.md 第 4 节。`, '');
  lines.push('「自身」只看这个包自己的代码；「含依赖」按依赖闭包取最高等级——');
  lines.push('一个包自己只用了 `path`，但它依赖的包要 `child_process`，实际也得按更重的运行时算。', '');
  lines.push('| 等级 | 含义 | 自身 | 含依赖 |');
  lines.push('|---|---|---|---|');
  const meaning: Record<Tier, string> = {
    L0: 'Web UI：官方 web 前端 + WebView，零改动',
    L1: '纯 JS：轻 TS 引擎 + 内建 shim',
    L2: '需 Node 内建：内嵌 Node / 完整引擎',
    L3: '需真实二进制：proot 完整引擎',
    L4: '需桌面能力：电脑端执行',
    'no-code': '无 JS 代码',
  };
  for (const tier of ['L0', 'L1', 'L2', 'L3', 'L4', 'no-code'] as Tier[]) {
    lines.push(
      `| ${tier} | ${meaning[tier]} | ${selfCounts.get(tier) ?? 0} | ${effectiveCounts.get(tier) ?? 0} |`,
    );
  }
  lines.push('');
  for (const tier of ['L0', 'L1', 'L2', 'L3', 'L4', 'no-code'] as Tier[]) {
    const items = reports.filter((r) => r.effectiveTier === tier);
    if (items.length === 0) continue;
    lines.push(`## ${tier}（${items.length}）`, '');
    lines.push('| 包 | 版本 | 自身 | 判定理由 |');
    lines.push('|---|---|---|---|');
    for (const item of items) {
      const self = item.effectiveTier === item.tier ? '—' : item.tier;
      lines.push(
        `| \`${item.name}\` | ${item.version} | ${self} | ${item.reasons.join('；').replace(/\|/g, '/')} |`,
      );
    }
    lines.push('');
  }
  writeFileSync(join(outDir, 'plugin-compat.md'), lines.join('\n'));

  for (const tier of ['L0', 'L1', 'L2', 'L3', 'L4', 'no-code'] as Tier[]) {
    console.log(`${tier}: 自身 ${selfCounts.get(tier) ?? 0} / 含依赖 ${effectiveCounts.get(tier) ?? 0}`);
  }
  console.log(`报告：${join(outDir, 'plugin-compat.md')} / ${join(outDir, 'plugin-compat.json')}`);
}

main();
