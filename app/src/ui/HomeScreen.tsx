import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { SessionSummary } from '../protocol';
import { store, useStore } from './useStore';
import { Dot, IconButton } from './parts';
import { SessionDrawer } from './SessionDrawer';
import { Composer } from './Composer';
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

export function HomeScreen(): React.ReactElement {
  const state = useStore();
  const [draft, setDraft] = React.useState('');
  const [refreshing, setRefreshing] = React.useState(false);
  const [drawer, setDrawer] = React.useState(false);

  const presets = state.caps?.presets ?? [];
  const preset = presets.find((p) => p.id === state.draftPresetId) ?? presets[0];
  const hasText = draft.trim().length > 0;

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

  const send = (): void => {
    if (!hasText) return;
    const text = draft.trim();
    setDraft('');
    void store.startWith(text);
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
        <IconButton glyph="☰" label="打开会话列表" onPress={() => setDrawer(true)} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollOuter}
        keyboardShouldPersistTaps="handled"
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
        <View style={styles.greeting}>
          <Text style={styles.greetingTitle}>需要我做点什么？</Text>
          <Text style={styles.greetingSub}>下面选一个锦囊，或者直接说</Text>
        </View>

        {state.sessions.length > 0 ? (
          <View style={styles.list}>
            <Text style={styles.sectionTitle}>最近</Text>
            {state.sessions.slice(0, 8).map((s) => {
              const p = presets.find((x) => x.id === s.presetId);
              return (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${s.title}${s.preview ? '，' + s.preview : ''}`}
                  onPress={() => void store.openSession(s.id)}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.glassPressed }]}
                >
                  <View style={styles.glyph}>
                    <Text style={styles.glyphText}>{p?.glyph ?? '·'}</Text>
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
                        {s.preview || p?.name || ''}
                      </Text>
                      <StatusTag s={s} />
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {state.error ? (
          <Pressable onPress={() => store.clearError()}>
            <Text style={styles.error}>{state.error}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Composer
        draft={draft}
        onChangeDraft={setDraft}
        onSend={send}
        placeholder="给锦囊发消息…"
        presets={presets}
        activePresetId={state.draftPresetId}
        onPickPreset={(id) => store.setDraftPreset(id)}
      />

      {/* 抽屉必须在最后一个子节点：后渲染的兄弟节点画在上层 */}
      <SessionDrawer visible={drawer} onClose={() => setDrawer(false)} />
    </KeyboardAvoidingView>
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
    paddingBottom: space.sm,
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

  scrollOuter: { paddingBottom: space.lg, flexGrow: 1 },

  greeting: { paddingHorizontal: space.xl, paddingTop: 64, paddingBottom: 40, alignItems: 'center', gap: 10 },
  greetingTitle: { color: colors.text, fontSize: 26, fontWeight: '600', letterSpacing: 0.5 },
  greetingSub: { color: colors.textFaint, fontSize: 13 },

  list: { paddingHorizontal: space.lg, gap: 8 },
  sectionTitle: { color: colors.textFaint, fontSize: 11.5, letterSpacing: 0.5, marginBottom: 2 },
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

  error: { color: colors.danger, fontSize: 12, paddingHorizontal: space.lg, marginTop: space.md },
});
