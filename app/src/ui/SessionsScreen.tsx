import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Preset, SessionSummary } from '../protocol';
import { store, useStore } from './useStore';
import { Chip, Dot } from './parts';
import { colors, radius, space, topInset } from './theme';

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60_000);
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

function statusChip(s: SessionSummary): React.ReactElement | null {
  if (s.status === 'running') return <Chip label="运行中" color={colors.blue} bg="rgba(108,138,240,0.14)" />;
  if (s.status === 'waiting_approval') return <Chip label="待确认" color={colors.warn} bg="rgba(201,162,39,0.14)" />;
  if (s.status === 'error') return <Chip label="出错" color={colors.danger} bg="rgba(196,85,59,0.14)" />;
  return null;
}

export function SessionsScreen(): React.ReactElement {
  const state = useStore();
  const presets: Preset[] = state.caps?.presets ?? [];
  const [refreshing, setRefreshing] = React.useState(false);

  const connColor =
    state.conn === 'connected' ? colors.ok : state.conn === 'reconnecting' ? colors.warn : colors.danger;
  const connLabel =
    state.conn === 'connected'
      ? state.caps?.host.name ?? '已连接'
      : state.conn === 'reconnecting'
        ? '重连中'
        : state.conn === 'connecting'
          ? '连接中'
          : '未连接';

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>锦囊</Text>
          <View style={styles.connRow}>
            <Dot color={connColor} />
            <Text style={styles.connText}>{connLabel}</Text>
          </View>
        </View>
        <Pressable onPress={() => store.disconnect()} accessibilityRole="button" accessibilityLabel="断开连接">
          <Text style={styles.disconnect}>断开</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollOuter}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.dim}
            onRefresh={() => {
              setRefreshing(true);
              void store.refreshSessions().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <View style={styles.scroll}>
        <Text style={styles.sectionTitle}>收一个锦囊</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
          {presets.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`新建${p.name}会话`}
              onPress={() => void store.createSession(p.id)}
              style={({ pressed }) => [styles.presetCard, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.presetGlyph}>
                <Text style={styles.presetGlyphText}>{p.glyph}</Text>
              </View>
              <Text style={styles.presetName}>{p.name}</Text>
              <Text style={styles.presetTag} numberOfLines={2}>
                {p.tagline}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={[styles.sectionTitle, { marginTop: space.xl }]}>最近</Text>

        {state.sessions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>还没有会话</Text>
            <Text style={styles.emptyText}>上面选一个锦囊，开第一场。</Text>
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
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.cardAlt }]}
                >
                  <View style={styles.glyph}>
                    <Text style={styles.glyphText}>{preset?.glyph ?? '·'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
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
                      {statusChip(s)}
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
    alignItems: 'flex-start',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  brand: { color: colors.text, fontSize: 26, fontWeight: '700', letterSpacing: 2 },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  connText: { color: colors.dim, fontSize: 12 },
  disconnect: { color: colors.faint, fontSize: 13, paddingTop: 6 },
  scrollOuter: { paddingBottom: space.xxl },
  scroll: { padding: space.lg },
  sectionTitle: { color: colors.faint, fontSize: 12, letterSpacing: 1, marginBottom: space.md },
  presetRow: { gap: space.md, paddingRight: space.lg },
  presetCard: {
    width: 132,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    gap: 6,
  },
  presetGlyph: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetGlyphText: { color: colors.gold, fontSize: 16, fontWeight: '700' },
  presetName: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 4 },
  presetTag: { color: colors.faint, fontSize: 11, lineHeight: 16 },
  list: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  glyph: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphText: { color: colors.dim, fontSize: 15, fontWeight: '600' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600', flex: 1 },
  rowTime: { color: colors.faint, fontSize: 11 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 3 },
  rowPreview: { color: colors.dim, fontSize: 12, flex: 1 },
  empty: { paddingVertical: space.xxl, alignItems: 'center', gap: 6 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  emptyText: { color: colors.faint, fontSize: 12 },
  error: { color: colors.danger, fontSize: 12, marginTop: space.lg },
});
