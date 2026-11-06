import {
  PLUGIN_COMPAT,
  PLUGIN_COMPAT_SNAPSHOT,
  type PluginCompatEntry,
  type PluginTier,
} from '../data/pluginCompat';

export { PLUGIN_COMPAT, PLUGIN_COMPAT_SNAPSHOT };
export type { PluginCompatEntry, PluginTier };

export type PluginFilter = 'all' | PluginTier;
export type PluginTone = 'blue' | 'green' | 'amber' | 'violet' | 'slate' | 'danger';

export const TIER_ORDER: PluginTier[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'no-code'];

export const TIER_RANK: Record<PluginTier, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
  'no-code': 0,
};

export interface TierMeta {
  /** 短标签：L0 / L1 / … / 无代码 */
  short: string;
  /** 给用户看的运行时名字 */
  label: string;
  hint: string;
  tone: PluginTone;
}

export const TIER_META: Record<PluginTier, TierMeta> = {
  L0: { short: 'L0', label: 'Web UI', hint: '官方 WebView 直接跑', tone: 'blue' },
  L1: { short: 'L1', label: '轻引擎', hint: '轻引擎 + shim', tone: 'green' },
  L2: { short: 'L2', label: 'Node 内建', hint: '需 Node 内建；实际走 proot 或由轻引擎重写', tone: 'amber' },
  L3: { short: 'L3', label: '完整引擎', hint: '需真实二进制，走 proot', tone: 'violet' },
  L4: { short: 'L4', label: '电脑端', hint: '需要桌面能力', tone: 'danger' },
  'no-code': { short: '无代码', label: '无代码', hint: '没有 JS 代码，不参与运行时分级', tone: 'slate' },
};

/** 按「含依赖」等级计数：这是用户实际关心的运行时 */
export function effectiveTierCounts(
  entries: PluginCompatEntry[] = PLUGIN_COMPAT,
): Record<PluginTier, number> {
  const counts: Record<PluginTier, number> = {
    L0: 0,
    L1: 0,
    L2: 0,
    L3: 0,
    L4: 0,
    'no-code': 0,
  };
  for (const entry of entries) counts[entry.effectiveTier] += 1;
  return counts;
}

function flagsText(entry: PluginCompatEntry): string {
  return [
    entry.hasNativeAddon ? 'native-addon' : '',
    entry.hasChildProcess ? 'child_process' : '',
    entry.hasElectron ? 'electron' : '',
    entry.usesProcess ? 'process' : '',
    entry.usesDynamicImport ? 'dynamic-import' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function pluginSearchText(entry: PluginCompatEntry): string {
  return [
    entry.name,
    entry.version,
    entry.tier,
    entry.effectiveTier,
    TIER_META[entry.tier].label,
    TIER_META[entry.effectiveTier].label,
    entry.reasons.join(' '),
    entry.nodeBuiltins.join(' '),
    entry.dshDeps.join(' '),
    entry.engines ?? '',
    flagsText(entry),
  ]
    .join(' ')
    .toLowerCase();
}

/** 搜索 + 等级过滤；多个关键词按 AND 匹配，等级过滤看 effectiveTier */
export function filterPlugins(
  entries: PluginCompatEntry[],
  query: string,
  filter: PluginFilter = 'all',
): PluginCompatEntry[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const filtered = entries.filter((entry) => {
    if (filter !== 'all' && entry.effectiveTier !== filter) return false;
    if (tokens.length === 0) return true;
    const haystack = pluginSearchText(entry);
    return tokens.every((token) => haystack.includes(token));
  });
  return sortByRelevance(filtered, query.trim().toLowerCase());
}

function nameRelevance(entry: PluginCompatEntry, query: string): number {
  if (!query) return 0;
  const name = entry.name.toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  return 3;
}

function sortByRelevance(entries: PluginCompatEntry[], query: string): PluginCompatEntry[] {
  return [...entries].sort((a, b) => {
    const relevance = nameRelevance(a, query) - nameRelevance(b, query);
    if (relevance !== 0) return relevance;
    const rank = TIER_RANK[a.effectiveTier] - TIER_RANK[b.effectiveTier];
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name);
  });
}

/** 轻的排前面；同等级按包名，方便从 L0 往下看 */
export function sortPlugins(entries: PluginCompatEntry[]): PluginCompatEntry[] {
  return [...entries].sort((a, b) => {
    const rank = TIER_RANK[a.effectiveTier] - TIER_RANK[b.effectiveTier];
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name);
  });
}

export function tierSummary(entries: PluginCompatEntry[] = PLUGIN_COMPAT): string {
  const counts = effectiveTierCounts(entries);
  const parts = TIER_ORDER.filter((tier) => counts[tier] > 0).map(
    (tier) => `${TIER_META[tier].short} ${counts[tier]}`,
  );
  return `${entries.length} 个包 · ${parts.join(' / ')}`;
}
