import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Preset, SessionSummary } from '../protocol';
import { store, useStore } from './useStore';
import { Dot, Pill } from './parts';
import { colors, radius, space, topInset } from './theme';

function relTime(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.round(hour / 24);
  if (day === 1) return '昨天';
  if (day < 7) return `${day} 天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

function StatusTag({ s }: { s: SessionSummary }): React.ReactElement | null {
  const map = {
    running: { label: '生成中', color: colors.blue, bg: colors.blueSoft },
    waiting_approval: { label: '待确认', color: colors.warn, bg: colors.warnSoft },
    error: { label: '出错', color: colors.danger, bg: colors.dangerSoft },
  } as const;
  const tone = map[s.status as keyof typeof map];
  if (!tone) return null;
  return (
    <View style={[styles.tag, { backgroundColor: tone.bg }]}>
      <Text style={[styles.tagText, { color: tone.color }]}>{tone.label}</Text>
    </View>
  );
}

export function SessionsScreen(): React.ReactElement {
  const state = useStore();
  const presets: Preset[] = state.caps?.presets ?? [];
  const [refreshing, setRefreshing] = React.useState(false);

  const connColor =
    state.conn === 'connected' ? colors.ok : state.conn === 'reconnecting' ? colors.warn : colors.danger;
  const connLabel =
    state.conn === 'connected'
      ? (state.caps?.host.name ?? '已连接')
      : state.conn === 'reconnecting'
        ? '重连中'
        : state.conn === 'connecting'
          ? '连接中'
          : '未连接';

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.brandMark}>
          <Text style={styles.brandGlyph}>锦</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>锦囊</Text>
          <View style={styles.connRow}>
            <Dot color={connColor} size={5} />
            <Text style={styles.connText}>{connLabel}</Text>
          </View>
        </View>
        <Pressable onPress={() => store.disconnect()} accessibilityRole="button" accessibilityLabel="断开连接">
          <Pill>
            <Text style={styles.disconnect}>断开</Text>
          </Pill>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollOuter}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.textDim}
            onRefresh={() => {
              setRefreshing(true);
              void store.refreshSessions().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <View style={styles.scroll}>
          <View style={[styles.sectionRow, { marginTop: space.md }]}>
            <Text style={styles.sectionTitle}>收一个锦囊</Text>
            <Text style={styles.sectionHint}>点一下直接开新会话</Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
            {presets.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={`新建${p.name}会话`}
                onPress={() => void store.createSession(p.id)}
                style={({ pressed }) => [styles.presetCard, pressed && { backgroundColor: colors.glassPressed }]}
              >
                <View style={styles.presetGlyph}>
                  <Text style={styles.presetGlyphText}>{p.glyph}</Text>
                </View>
                <Text style={styles.presetName}>{p.name}</Text>
                <Text style={styles.presetTag} numberOfLines={2}>
                  {p.tagline}
                </Text>
                <Text style={styles.presetNet}>{p.contract.net === 'deny' ? '禁网' : '联网'}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={[styles.sectionRow, { marginTop: space.xl }]}>
            <Text style={styles.sectionTitle}>最近</Text>
            {state.sessions.length > 0 ? (
              <Text style={styles.sectionHint}>{state.sessions.length} 个会话</Text>
            ) : null}
          </View>

          {state.sessions.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>还没有会话</Text>
              <Text style={styles.emptyText}>上面收一个锦囊，开第一场。</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {state.sessions.map((s) => {
                const preset = presets.find((p) => p.id === s.presetId);
                return (
                  <Pressable
                    key={s.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.title}${s.preview ? '，' + s.preview : ''}`}
                    onPress={() => void store.openSession(s.id)}
                    style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.glassPressed }]}
                  >
                    <View style={styles.glyph}>
                      <Text style={styles.glyphText}>{preset?.glyph ?? '·'}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={styles.rowTop}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {s.title}
                        </Text>
                        <Text style={styles.rowTime}>{relTime(s.updatedAt)}</Text>
                      </View>
                      <View style={styles.rowBottom}>
                        <Text style={styles.rowPreview} numberOfLines={1}>
                          {s.preview || preset?.name || ''}
                        </Text>
                        <StatusTag s={s} />
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {state.error ? (
            <Pressable onPress={() => store.clearError()}>
              <Text style={styles.error}>{state.error}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: topInset },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  brandMark: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandGlyph: { color: colors.gold, fontSize: 18, fontWeight: '700' },
  brand: { color: colors.text, fontSize: 19, fontWeight: '700', letterSpacing: 1.5 },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  connText: { color: colors.textFaint, fontSize: 11 },
  disconnect: { color: colors.textDim, fontSize: 12 },

  scrollOuter: { paddingBottom: space.xxl },
  scroll: { paddingHorizontal: space.lg },

  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  sectionHint: { color: colors.textFaint, fontSize: 11 },

  presetRow: { gap: 10, paddingRight: space.lg },
  presetCard: {
    width: 148,
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 4,
  },
  presetGlyph: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  presetGlyphText: { color: colors.gold, fontSize: 15, fontWeight: '700' },
  presetName: { color: colors.text, fontSize: 14.5, fontWeight: '600' },
  presetTag: { color: colors.textFaint, fontSize: 11.5, lineHeight: 16, minHeight: 32 },
  presetNet: { color: colors.textFaint, fontSize: 10, marginTop: 2 },

  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  glyph: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphText: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600', flex: 1 },
  rowTime: { color: colors.textFaint, fontSize: 10.5 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowPreview: { color: colors.textDim, fontSize: 12.5, flex: 1 },
  tag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  tagText: { fontSize: 10, fontWeight: '600' },

  empty: { paddingVertical: 40, alignItems: 'center', gap: 6 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  emptyText: { color: colors.textFaint, fontSize: 12.5 },
  error: { color: colors.danger, fontSize: 12, marginTop: space.lg },
});
