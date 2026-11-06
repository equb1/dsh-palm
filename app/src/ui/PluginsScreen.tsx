import React from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  PLUGIN_COMPAT,
  PLUGIN_COMPAT_SNAPSHOT,
  TIER_META,
  TIER_ORDER,
  effectiveTierCounts,
  filterPlugins,
  tierSummary,
  type PluginCompatEntry,
  type PluginFilter,
  type PluginTone,
} from '../lib/pluginCatalog';
import { store } from './useStore';
import { IconButton } from './parts';
import { Chip, EmptyState } from './components';
import { radius, space, topInset, useTheme, useThemedStyles, type Palette, type Theme } from './theme';

function tierColors(c: Palette, tone: PluginTone): { bg: string; fg: string } {
  switch (tone) {
    case 'blue':
      return { bg: c.blueSoft, fg: c.blue };
    case 'green':
      return { bg: c.okSoft, fg: c.ok };
    case 'amber':
      return { bg: c.warnSoft, fg: c.warn };
    case 'violet':
      return { bg: c.violetSoft, fg: c.violet };
    case 'danger':
      return { bg: c.dangerSoft, fg: c.danger };
    case 'slate':
    default:
      return { bg: c.glassStrong, fg: c.textDim };
  }
}

function filterChips(counts: Record<string, number>): Array<{ id: PluginFilter; label: string }> {
  return [
    { id: 'all', label: `全部 ${PLUGIN_COMPAT.length}` },
    ...TIER_ORDER.filter((tier) => tier !== 'L4').map((tier) => ({
      id: tier,
      label: `${TIER_META[tier].short} ${counts[tier] ?? 0}`,
    })),
  ];
}

export function PluginsScreen(): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [query, setQuery] = React.useState('');
  const [tier, setTier] = React.useState<PluginFilter>('all');
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const counts = React.useMemo(() => effectiveTierCounts(), []);
  const chips = React.useMemo(() => filterChips(counts), [counts]);
  const results = React.useMemo(() => filterPlugins(PLUGIN_COMPAT, query, tier), [query, tier]);
  const filtering = query.trim().length > 0 || tier !== 'all';

  const renderItem = ({ item }: { item: PluginCompatEntry }): React.ReactElement => {
    const meta = TIER_META[item.effectiveTier];
    const own = TIER_META[item.tier];
    const tone = tierColors(palette, meta.tone);
    const open = expanded === item.name;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`插件 ${item.name}，${meta.label}`}
        onPress={() => setExpanded((current) => (current === item.name ? null : item.name))}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.rowTop}>
          <View style={[styles.badge, { backgroundColor: tone.bg }]}>
            <Text style={[styles.badgeText, { color: tone.fg }]}>{meta.short}</Text>
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.chevron}>{open ? '▴' : '▾'}</Text>
        </View>

        <Text style={styles.reason} numberOfLines={open ? undefined : 1}>
          {item.reasons.join('；') || '—'}
        </Text>

        <View style={styles.metaRow}>
          <Text style={styles.meta}>
            自身 {own.short}
            {own.short !== meta.short ? ` · 含依赖 ${meta.short}` : ''}
          </Text>
          <Text style={styles.meta}>v{item.version}</Text>
          {item.jsFiles > 0 ? <Text style={styles.meta}>{item.jsFiles} 个 JS</Text> : null}
          {(meta.short === 'L3' || meta.short === 'L4') && item.hasChildProcess ? (
            <Text style={styles.metaWarn}>child_process</Text>
          ) : null}
          {(meta.short === 'L3' || meta.short === 'L4') && item.hasNativeAddon ? (
            <Text style={styles.metaWarn}>native</Text>
          ) : null}
          {(meta.short === 'L3' || meta.short === 'L4') && item.hasElectron ? (
            <Text style={styles.metaWarn}>electron</Text>
          ) : null}
        </View>

        {open ? (
          <View style={styles.details}>
            <Text style={styles.detailLine}>
              运行时：{meta.label} · {meta.hint}
            </Text>
            <Text style={styles.detailLine}>
              Node 内建：{item.nodeBuiltins.length > 0 ? item.nodeBuiltins.join(', ') : '无'}
            </Text>
            {item.dshDeps.length > 0 ? (
              <Text style={styles.detailLine}>
                DSH 依赖（{item.dshDeps.length}）：
                {item.dshDeps.length > 6
                  ? `${item.dshDeps.slice(0, 6).join(', ')} … 等 ${item.dshDeps.length} 个`
                  : item.dshDeps.join(', ')}
              </Text>
            ) : null}
            {item.engines ? <Text style={styles.detailLine}>engines：{item.engines}</Text> : null}
            {item.usesProcess ? <Text style={styles.detailLine}>使用 process.*</Text> : null}
            {item.usesDynamicImport ? <Text style={styles.detailLine}>使用动态 import()</Text> : null}
            {item.hasChildProcess || item.hasNativeAddon || item.hasElectron ? (
              <Text style={styles.detailLine}>
                源码标记：
                {[
                  item.hasChildProcess ? 'child_process' : '',
                  item.hasNativeAddon ? 'native-addon' : '',
                  item.hasElectron ? 'electron' : '',
                ]
                  .filter(Boolean)
                  .join(' / ')}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回" onPress={() => store.closePlugins()} />
        <Text style={styles.title}>插件兼容</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.top}>
        <View style={styles.searchBox}>
          <Text style={styles.searchGlyph}>⌕</Text>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="搜索包名 / 理由 / 内建模块"
            placeholderTextColor={palette.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="搜索插件兼容"
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="清空插件搜索"
              onPress={() => setQuery('')}
              hitSlop={8}
            >
              <Text style={styles.clear}>×</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.summary}>{tierSummary()}</Text>
        <Text style={styles.note}>
          等级按「含依赖」算：L0 WebView / L1 轻引擎 / L2 Node 内建 / L3 proot / L4 电脑端。
          点任意包看判定理由、Node 内建和依赖。
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
          keyboardShouldPersistTaps="handled"
        >
          {chips.map((chip) => {
            const meta = chip.id === 'all' ? null : TIER_META[chip.id];
            const colors = meta ? tierColors(palette, meta.tone) : null;
            const active = tier === chip.id;
            return (
              <Chip
                key={chip.id}
                label={chip.label}
                active={active}
                {...(active && colors ? { color: colors.fg, bg: colors.bg } : {})}
                onPress={() => setTier(chip.id)}
              />
            );
          })}
        </ScrollView>

        {filtering ? (
          <Text style={styles.resultCount}>
            {results.length} 个结果{query.trim() ? ` · “${query.trim()}”` : ''}
          </Text>
        ) : (
          <Text style={styles.resultCount}>快照 {PLUGIN_COMPAT_SNAPSHOT.dsh} · 离线可看</Text>
        )}
      </View>

      <FlatList
        style={styles.list}
        data={results}
        keyExtractor={(item) => item.name}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <EmptyState
            glyph="◈"
            title="没有匹配的插件"
            description="换关键词，或切回「全部」。"
          />
        }
        keyboardShouldPersistTaps="handled"
        initialNumToRender={16}
        maxToRenderPerBatch={12}
        windowSize={9}
      />
    </View>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg, paddingTop: topInset },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    title: { flex: 1, color: c.text, fontSize: 17, fontWeight: '700' },
    top: {
      paddingHorizontal: space.lg,
      paddingBottom: space.sm,
      gap: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: 40,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: c.glassStrong,
    },
    searchGlyph: { color: c.textFaint, fontSize: 15 },
    searchInput: { flex: 1, color: c.text, fontSize: 13, paddingVertical: 0 },
    clear: { color: c.textFaint, fontSize: 16, paddingHorizontal: 2 },
    summary: { color: c.textDim, fontSize: 12, lineHeight: 18 },
    note: { color: c.textFaint, fontSize: 11.5, lineHeight: 17 },
    filters: { flexDirection: 'row', gap: 6, paddingRight: space.sm },
    resultCount: { color: c.textFaint, fontSize: 11.5 },
    list: { flex: 1 },
    listContent: { padding: space.lg, gap: 8, paddingBottom: space.xxl },
    row: {
      backgroundColor: c.glass,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: space.md,
      gap: 5,
    },
    rowPressed: { backgroundColor: c.glassStrong },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    badge: {
      minWidth: 30,
      height: 22,
      borderRadius: radius.pill,
      paddingHorizontal: 7,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3 },
    name: { flex: 1, color: c.text, fontSize: 13.5, fontWeight: '600' },
    chevron: { color: c.textFaint, fontSize: 11 },
    reason: { color: c.textDim, fontSize: 12, lineHeight: 18 },
    metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    meta: { color: c.textFaint, fontSize: 10.5 },
    metaWarn: { color: c.warn, fontSize: 10.5, fontWeight: '600' },
    details: {
      marginTop: 4,
      padding: 10,
      borderRadius: radius.sm,
      backgroundColor: c.bgElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      gap: 3,
    },
    detailLine: { color: c.textDim, fontSize: 11.5, lineHeight: 17 },
  });
