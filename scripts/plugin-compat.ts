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
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

type Tier = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'no-code';

interface PackageReport {
  name: string;
  version: string;
  tier: Tier;
  reasons: string[];
  engines?: string;
  nodeBuiltins: string[];
  hasNativeAddon: boolean;
  hasChildProcess: boolean;
  hasElectron: boolean;
  usesProcess: boolean;
  usesDynamicImport: boolean;
  jsFiles: number;
}

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
    reasons,
    engines,
    nodeBuiltins: [...builtins].sort(),
    hasNativeAddon,
    hasChildProcess,
    hasElectron,
    usesProcess,
    usesDynamicImport,
    jsFiles: files.length,
  };
}

function main(): void {
  const nm = resolve(process.argv[2] ?? 'runtime/build/stage/opt/dsh/node_modules');
  const outDir = resolve(process.argv[3] ?? 'reports');
  const scope = join(nm, '@deepseek-ai');
  const dirs = readdirSync(scope, { withFileTypes: true }).filter((d) => d.isDirectory());
  const reports: PackageReport[] = [];
  for (const dir of dirs) {
    const report = classify(join(scope, dir.name), nm);
    if (report) reports.push(report);
  }
  reports.sort((a, b) => a.tier.localeCompare(b.tier) || a.name.localeCompare(b.name));

  const counts = new Map<Tier, number>();
  for (const r of reports) counts.set(r.tier, (counts.get(r.tier) ?? 0) + 1);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'plugin-compat.json'), JSON.stringify(reports, null, 2));

  const lines: string[] = [];
  lines.push('# DSH 插件手机兼容矩阵（自动生成）', '');
  lines.push(`> 生成命令：\`node --import tsx scripts/plugin-compat.ts ${relative(process.cwd(), nm)}\``);
  lines.push(`> 扫描包数：${reports.length}；等级定义见 docs/23-requirements.md 第 4 节。`, '');
  lines.push('| 等级 | 含义 | 包数 |');
  lines.push('|---|---|---|');
  const meaning: Record<Tier, string> = {
    L0: 'Web UI：官方 web 前端 + WebView，零改动',
    L1: '纯 JS：轻 TS 引擎 + 内建 shim',
    L2: '需 Node 内建：内嵌 Node / 完整引擎',
    L3: '需真实二进制：proot 完整引擎',
    L4: '需桌面能力：电脑端执行',
    'no-code': '无 JS 代码',
  };
  for (const tier of ['L0', 'L1', 'L2', 'L3', 'L4', 'no-code'] as Tier[]) {
    lines.push(`| ${tier} | ${meaning[tier]} | ${counts.get(tier) ?? 0} |`);
  }
  lines.push('');
  for (const tier of ['L0', 'L1', 'L2', 'L3', 'L4', 'no-code'] as Tier[]) {
    const items = reports.filter((r) => r.tier === tier);
    if (items.length === 0) continue;
    lines.push(`## ${tier}（${items.length}）`, '');
    lines.push('| 包 | 版本 | 判定理由 |');
    lines.push('|---|---|---|');
    for (const item of items) {
      lines.push(`| \`${item.name}\` | ${item.version} | ${item.reasons.join('；').replace(/\|/g, '/')} |`);
    }
    lines.push('');
  }
  writeFileSync(join(outDir, 'plugin-compat.md'), lines.join('\n'));

  for (const tier of ['L0', 'L1', 'L2', 'L3', 'L4', 'no-code'] as Tier[]) {
    console.log(`${tier}: ${counts.get(tier) ?? 0}`);
  }
  console.log(`报告：${join(outDir, 'plugin-compat.md')} / ${join(outDir, 'plugin-compat.json')}`);
}

main();
