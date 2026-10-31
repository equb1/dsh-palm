import React from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { SessionSummary } from '../protocol';
import { store, useStore } from './useStore';
import { Dot, IconButton } from './parts';
import { colors, radius, space, topInset } from './theme';

const PANEL_WIDTH = 302;

function relTime(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour} 小时`;
  const day = Math.round(hour / 24);
  if (day === 1) return '昨天';
  if (day < 7) return `${day} 天`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function StatusTag({ s }: { s: SessionSummary }): React.ReactElement | null {
  if (s.status === 'waiting_approval') {
    return (
      <View style={[styles.tag, { backgroundColor: colors.warnSoft }]}>
        <Text style={[styles.tagText, { color: colors.warn }]}>待确认</Text>
      </View>
    );
  }
  if (s.status === 'error') {
    return (
      <View style={[styles.tag, { backgroundColor: colors.dangerSoft }]}>
        <Text style={[styles.tagText, { color: colors.danger }]}>出错</Text>
      </View>
    );
  }
  return null;
}

/**
 * 会话抽屉：所有会话都在这。
 * 首页只有一个输入框之后，这里是唯一能翻历史的地方。
 */
export function SessionDrawer({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): React.ReactElement | null {
  const state = useStore();
  const [mounted, setMounted] = React.useState(visible);
  const [q, setQ] = React.useState('');
  const anim = React.useRef(new Animated.Value(visible ? 1 : 0)).current;

  React.useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, anim]);

  if (!mounted) return null;

  const presets = state.caps?.presets ?? [];
  const sessions = state.sessions;
  const keyword = q.trim().toLowerCase();
  const filtered = keyword
    ? sessions.filter((s) => `${s.title}${s.preview}`.toLowerCase().includes(keyword))
    : sessions;

  const running = filtered.filter((s) => s.status === 'running' || s.status === 'waiting_approval');
  const today = filtered.filter(
    (s) => !running.includes(s) && s.updatedAt >= startOfToday(),
  );
  const older = filtered.filter((s) => !running.includes(s) && s.updatedAt < startOfToday());

  const groups: Array<{ title: string; items: SessionSummary[] }> = [
    { title: '运行中', items: running },
    { title: '今天', items: today },
    { title: '更早', items: older },
  ].filter((g) => g.items.length > 0);

  const renderRow = (s: SessionSummary): React.ReactElement => {
    const preset = presets.find((p) => p.id === s.presetId);
    return (
      <Pressable
        key={s.id}
        accessibilityRole="button"
        accessibilityLabel={`会话：${s.title}`}
        onPress={() => {
          onClose();
          void store.openSession(s.id);
        }}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.glassPressed }]}
      >
        <View style={styles.glyph}>
          <Text style={styles.glyphText}>{preset?.glyph ?? '·'}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
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
  };

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="关闭会话抽屉" />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          {
            transform: [
              {
                translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [-PANEL_WIDTH, 0] }),
              },
            ],
          },
        ]}
      >
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>会话</Text>
          <IconButton glyph="✕" label="关闭" onPress={onClose} size={32} />
        </View>

        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            style={styles.search}
            value={q}
            onChangeText={setQ}
            placeholder="搜索会话"
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="搜索会话"
          />
        </View>

        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {groups.length === 0 ? (
            <Text style={styles.empty}>{keyword ? '没有匹配的会话' : '还没有会话'}</Text>
          ) : (
            groups.map((g) => (
              <View key={g.title} style={{ gap: 6 }}>
                <Text style={styles.groupTitle}>{g.title}</Text>
                {g.items.map(renderRow)}
              </View>
            ))
          )}
        </ScrollView>

        <View style={styles.footer}>
          <View style={{ flex: 1 }}>
            <View style={styles.connRow}>
              <Dot color={state.conn === 'connected' ? colors.ok : colors.danger} size={5} />
              <Text style={styles.connText} numberOfLines={1}>
                {state.caps?.host.name ?? '未连接'}
              </Text>
            </View>
            <Text style={styles.connSub}>{state.caps?.host.engineVersion ?? ''}</Text>
          </View>
          <Pressable onPress={() => store.disconnect()} accessibilityRole="button" accessibilityLabel="断开连接">
            <Text style={styles.disconnect}>断开</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-start' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  panel: {
    width: PANEL_WIDTH,
    height: '100%',
    backgroundColor: '#12151A',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.borderStrong,
    paddingTop: topInset,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  panelTitle: { color: colors.text, fontSize: 17, fontWeight: '700', letterSpacing: 0.5 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: space.md,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.glass,
  },
  searchIcon: { color: colors.textFaint, fontSize: 13 },
  search: { flex: 1, color: colors.text, fontSize: 13, paddingVertical: 0 },
  list: { padding: space.md, gap: 14, paddingBottom: space.xl },
  groupTitle: { color: colors.textFaint, fontSize: 10.5, letterSpacing: 0.5, marginLeft: 2 },
  empty: { color: colors.textFaint, fontSize: 12.5, textAlign: 'center', marginTop: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 6, borderRadius: radius.md },
  glyph: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { color: colors.text, fontSize: 13.5, fontWeight: '500', flex: 1 },
  rowTime: { color: colors.textFaint, fontSize: 10 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowPreview: { color: colors.textFaint, fontSize: 11.5, flex: 1 },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill },
  tagText: { fontSize: 9.5, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  connText: { color: colors.textDim, fontSize: 11.5 },
  connSub: { color: colors.textFaint, fontSize: 10, marginTop: 2 },
  disconnect: { color: colors.danger, fontSize: 12.5 },
});
