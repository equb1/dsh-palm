/**
 * 把 reports/plugin-compat.json 转成 App 可打包的 TypeScript 数据。
 *
 *   node scripts/plugin-data.mjs
 *
 * 数据来自 scripts/plugin-compat.ts（npm run plugin:check）的静态扫描快照；
 * 重新扫描后跑一次本脚本，保持 App 内插件徽章与矩阵一致。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SRC = 'reports/plugin-compat.json';
const OUT = 'app/src/data/pluginCompat.ts';
const TIERS = new Set(['L0', 'L1', 'L2', 'L3', 'L4', 'no-code']);

const raw = JSON.parse(readFileSync(SRC, 'utf8'));
if (!Array.isArray(raw)) throw new Error(`${SRC} 不是数组`);
if (raw.length === 0) throw new Error(`${SRC} 为空`);

const rows = raw.map((item) => {
  if (!item || typeof item.name !== 'string' || typeof item.version !== 'string') {
    throw new Error(`报告条目缺 name/version：${JSON.stringify(item).slice(0, 120)}`);
  }
  if (!TIERS.has(item.tier) || !TIERS.has(item.effectiveTier)) {
    throw new Error(`报告条目等级不合法：${item.name} ${item.tier}/${item.effectiveTier}`);
  }
  return {
    name: item.name,
    version: item.version,
    tier: item.tier,
    effectiveTier: item.effectiveTier,
    reasons: Array.isArray(item.reasons) ? item.reasons : [],
    nodeBuiltins: Array.isArray(item.nodeBuiltins) ? item.nodeBuiltins : [],
    dshDeps: Array.isArray(item.dshDeps) ? item.dshDeps : [],
    hasNativeAddon: item.hasNativeAddon === true,
    hasChildProcess: item.hasChildProcess === true,
    hasElectron: item.hasElectron === true,
    usesProcess: item.usesProcess === true,
    usesDynamicImport: item.usesDynamicImport === true,
    jsFiles: typeof item.jsFiles === 'number' ? item.jsFiles : 0,
    ...(typeof item.engines === 'string' ? { engines: item.engines } : {}),
  };
});

rows.sort((a, b) => a.name.localeCompare(b.name));

const lines = [
  '// 由 scripts/plugin-data.mjs 从 reports/plugin-compat.json 生成，不要手改。',
  '// 快照：dsh 0.2.1-rc.5 / 305 个包；复跑：npm run plugin:check && npm run plugin:data',
  '',
  "export type PluginTier = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'no-code';",
  '',
  'export interface PluginCompatEntry {',
  '  name: string;',
  '  version: string;',
  '  tier: PluginTier;',
  '  effectiveTier: PluginTier;',
  '  reasons: string[];',
  '  nodeBuiltins: string[];',
  '  dshDeps: string[];',
  '  hasNativeAddon: boolean;',
  '  hasChildProcess: boolean;',
  '  hasElectron: boolean;',
  '  usesProcess: boolean;',
  '  usesDynamicImport: boolean;',
  '  jsFiles: number;',
  '  engines?: string;',
  '}',
  '',
  'export const PLUGIN_COMPAT: PluginCompatEntry[] = [',
  ...rows.map(
    (row) =>
      `  ${JSON.stringify(row)},`,
  ),
  '];',
  '',
  'export const PLUGIN_COMPAT_SNAPSHOT = {',
  "  dsh: '0.2.1-rc.5',",
  `  packages: ${rows.length},`,
  "  generatedFrom: 'reports/plugin-compat.json',",
  '} as const;',
  '',
];

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n'));
console.log(`wrote ${OUT}: ${rows.length} packages`);
