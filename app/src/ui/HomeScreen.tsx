import React from 'react';
import {
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { SessionSummary } from '../protocol';
import type { AttachmentKind } from '../lib/attachments/types';
import { store, useStore } from './useStore';
import { Dot, IconButton } from './parts';
import { EngineBadge } from './EngineBadge';
import { badgeFor, canSwitch } from '../state/engineManager';
import { EmptyState } from './components';
import { SessionDrawer } from './SessionDrawer';
import { ModelSheet } from './ModelSheet';
import { Composer } from './Composer';
import { SmoothKeyboardAvoid } from './SmoothKeyboardAvoid';
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

  // 从系统分享菜单进来的文字：填进输入框（只填一次；回前台再分享也生效）
  React.useEffect(() => {
    const shared = store.takeShareText();
    if (shared) setDraft((d) => (d.trim().length > 0 ? d : shared));
  }, [state.pendingShare?.text]);

  React.useEffect(() => {
    if (!drawer) return;
    const onBackPress = (): boolean => {
      setDrawer(false);
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [drawer]);

  const presets = state.caps?.presets ?? [];
  const preset = presets.find((p) => p.id === state.draftPresetId) ?? presets[0];
  const activeModel = state.defaultModel;
  const activeModelOption = state.models.find(
    (m) => m.provider === activeModel?.provider && m.id === activeModel?.model
  );
  const effortName = activeModelOption?.efforts?.find(
    (e) => e.id === (activeModel?.reasoningEffort ?? activeModelOption?.defaultEffort)
  )?.name;
  const modelLabel = `${(activeModelOption?.name ?? activeModel?.model ?? '模型').replace(/^DeepSeek-?/i, '')}${
    effortName ? ' · ' + effortName : ''
  }`;
  const hasText = draft.trim().length > 0;

  // 首装解压 + 完整引擎冷启动有 10 多秒，这段时间首页别只显示"未连接"
  const engine = state.engine;
  const engineBadge = badgeFor(engine);
  const engineSwitch = canSwitch(engine);
  const booting = engine.mode === 'starting-proot';
  const bootHost = engine.host ?? state.host;
  const bootPct = engine.progress > 0 ? engine.progress : (bootHost?.progress ?? 0);
  const bootLabel = bootHost?.phase
    ? bootHost.phase + (bootPct > 0 && bootPct < 100 ? ` ${bootPct}%` : '')
    : '完整引擎启动中';

  const connColor =
    state.conn === 'connected' ? colors.ok : state.conn === 'reconnecting' || booting ? colors.warn : colors.danger;
  const connLabel =
    booting
      ? bootLabel
      : state.conn === 'connected'
        ? (state.caps?.host.name ?? '已连接')
        : state.conn === 'reconnecting'
          ? '重连中'
          : state.conn === 'connecting'
            ? '连接中'
            : '未连接';

  const send = (): void => {
    if (!hasText && state.pendingAttachments.length === 0) return;
    const text = draft.trim();
    // 发送成功才清空草稿：引擎没连上/切完整引擎失败时，用户这句话不能丢
    void store.startWith(text).then((ok) => {
      if (ok) setDraft((current) => (current === draft ? '' : current));
      else setDraft((current) => (current.trim().length > 0 ? current : text));
    });
  };

  const handlePickAttachment = (kind: AttachmentKind): void => {
    // 原生收件落盘 → store 里分类、去重；错误由 store 统一展示
    void store.attachFromPicker(kind);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="☰" label="打开会话列表" onPress={() => setDrawer(true)} />
        <View style={styles.brandMark}>
          <Text style={styles.brandGlyph}>锦</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>锦囊</Text>
          <View style={styles.subRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="查看引擎连接状态"
              onPress={() => store.openConnectModal()}
              style={styles.connRow}
            >
              <Dot color={connColor} size={5} />
              <Text style={styles.connText} numberOfLines={1}>
                {connLabel}
              </Text>
            </Pressable>
            {/* 轻/完整角标：空闲时点一下切引擎，忙/有审批时不给点 */}
            <EngineBadge
              kind={engineBadge.kind}
              label={engineBadge.label}
              onPress={
                engineSwitch.ok
                  ? () => {
                      void store.switchEngine(engine.mode === 'light' ? 'full' : 'light');
                    }
                  : undefined
              }
            />
          </View>
        </View>
        {/* 模型胶囊在顶栏，和 dsh-go/聊天页一致 */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`模型：${modelLabel}`}
          onPress={() => store.openModelSheet()}
          style={({ pressed }) => [styles.headerModel, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.headerModelText} numberOfLines={1}>
            {modelLabel}
          </Text>
          <Text style={styles.headerModelChevron}>▾</Text>
        </Pressable>
      </View>

      {engine.mode === 'light' && !engine.lightReady && Boolean(engine.error) ? (
        <Pressable accessibilityRole="button" onPress={() => store.openLightSetup()} style={styles.lightSetup}>
          <Text style={styles.lightSetupText}>轻引擎未就绪 · 点这里配置模型渠道 ›</Text>
        </Pressable>
      ) : null}

      <SmoothKeyboardAvoid style={styles.bodyWrap}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollOuter}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
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
          ) : (
            <EmptyState
              glyph="💬"
              title="还没有会话"
              description="发第一条消息，或者从下面的锦囊开始。"
            />
          )}

          {Boolean(state.error) ? (
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
          permissions={state.permissions}
          activePermission={state.defaultPermission}
          onPickPermission={(value) => void store.setPermission(value)}
          attachments={state.pendingAttachments}
          attaching={state.attaching}
          onPickAttachment={handlePickAttachment}
          onRemoveAttachment={(id) => store.removeAttachment(id)}
        />
      </SmoothKeyboardAvoid>

      <SessionDrawer visible={drawer} onClose={() => setDrawer(false)} />
      <ModelSheet />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: topInset },
  bodyWrap: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  headerModel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 32,
    maxWidth: 172,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.glassStrong,
  },
  headerModelText: { color: colors.text, fontSize: 12, flexShrink: 1 },
  headerModelChevron: { color: colors.textFaint, fontSize: 9 },
  brandMark: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandGlyph: { color: colors.gold, fontSize: 18, fontWeight: '700' },
  brand: { color: colors.text, fontSize: 16, fontWeight: '600', letterSpacing: 1.2 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  lightSetup: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 16 },
  lightSetupText: { color: colors.blue, fontSize: 11.5, textAlign: 'center' },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  connText: { color: colors.textFaint, fontSize: 11 },
  disconnect: { color: colors.textDim, fontSize: 12 },

  scrollOuter: { paddingBottom: space.lg, flexGrow: 1 },

  greeting: { paddingHorizontal: space.xl, paddingTop: 64, paddingBottom: 40, alignItems: 'center', gap: 10 },
  greetingTitle: { color: colors.text, fontSize: 24, lineHeight: 32, fontWeight: '600', letterSpacing: 0.2 },
  greetingSub: { color: colors.textFaint, fontSize: 13, lineHeight: 20 },

  list: { paddingHorizontal: space.lg, gap: 8 },
  sectionTitle: { color: colors.textFaint, fontSize: 12, lineHeight: 18, letterSpacing: 0.2, marginBottom: 2 },
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
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  rowTitle: { color: colors.text, fontSize: 14, lineHeight: 22, fontWeight: '500', flex: 1 },
  rowTime: { color: colors.textFaint, fontSize: 11, lineHeight: 16 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowPreview: { color: colors.textDim, fontSize: 13, lineHeight: 20, flex: 1 },
  tag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  tagText: { fontSize: 10, fontWeight: '600' },

  error: { color: colors.danger, fontSize: 12, paddingHorizontal: space.lg, marginTop: space.md },
});
