import React from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { SessionSummary } from '../protocol';
import type { SessionRow } from '../state/sessionList';
import { store, useStore } from './useStore';
import { IconButton } from './parts';
import { EmptyState } from './components';
import { loadAccountPhone } from '../lib/accountPhone';
import type { ConversationLink } from '../lib/handoff';
import { colors, motion, radius, semantic, space, topInset } from './theme';

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

/** 11 位手机号脱敏成 159****70；宿主已脱敏的直接透传 */
function maskPhone(raw: string): string {
  const digits = raw.replace(/[\s-]/g, '');
  if (/^\d{11}$/.test(digits)) return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
  return raw;
}

/** 逻辑会话当前在哪一侧：轻 / 完整。第二个物理会话在列表里不出现。 */
function SideTag({ link }: { link?: ConversationLink }): React.ReactElement | null {
  if (!link) return null;
  const full = link.activeSide === 'full';
  return (
    <View
      style={[
        styles.tag,
        { backgroundColor: full ? colors.blueSoft : colors.glassStrong },
      ]}
    >
      <Text style={[styles.tagText, { color: full ? colors.blue : colors.textFaint }]}>
        {full ? '完整' : '轻'}
      </Text>
    </View>
  );
}

/** 另一个引擎的会话：行上标「轻/完整」，点了先切引擎再打开 */
function EngineTag({ engine }: { engine: SessionRow['engine'] }): React.ReactElement {
  const full = engine === 'full';
  return (
    <View style={[styles.tag, { backgroundColor: full ? colors.blueSoft : colors.glassStrong }]}>
      <Text style={[styles.tagText, { color: full ? colors.blue : colors.textFaint }]}>
        {full ? '完整' : '轻'}
      </Text>
    </View>
  );
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
  const account = state.account;
  const [localPhone, setLocalPhone] = React.useState('');
  const phone =
    account?.user?.maskedPhone ??
    account?.user?.phone ??
    account?.user?.phoneNumber ??
    localPhone;
  const accountLabel = phone
    ? account?.user?.maskedPhone
      ? phone
      : maskPhone(phone)
    : 'DeepSeek 账号';
  const [mounted, setMounted] = React.useState(visible);
  const [q, setQ] = React.useState('');
  const anim = React.useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  const [renameText, setRenameText] = React.useState('');
  const [searchFocused, setSearchFocused] = React.useState(false);

  React.useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: motion.duration.base,
      easing: motion.easing.standard,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, anim]);

  React.useEffect(() => {
    if (!visible) return;
    void loadAccountPhone().then(setLocalPhone);
  }, [visible]);

  if (!mounted) return null;

  const presets = state.caps?.presets ?? [];
  const currentEngine = state.engineKind === 'light' ? 'light' : 'full';
  const sessions = store.sessionRows();
  const keyword = q.trim().toLowerCase();
  const filtered = keyword
    ? sessions.filter((s) => `${s.title}${s.preview}`.toLowerCase().includes(keyword))
    : sessions;

  const running = filtered.filter((s) => s.status === 'running' || s.status === 'waiting_approval');
  const today = filtered.filter(
    (s) => !running.includes(s) && s.updatedAt >= startOfToday(),
  );
  const older = filtered.filter((s) => !running.includes(s) && s.updatedAt < startOfToday());

  const groups: Array<{ title: string; items: SessionRow[] }> = [
    { title: '运行中', items: running },
    { title: '今天', items: today },
    { title: '更早', items: older },
  ].filter((g) => g.items.length > 0);

  const renderRow = (s: SessionRow): React.ReactElement => {
    const preset = presets.find((p) => p.id === s.presetId);
    const link = state.links.find((item) => item.id === s.id);
    const otherEngine = s.engine !== currentEngine;
    return (
      <React.Fragment key={s.id}>
      <Pressable
        key={s.id}
        accessibilityRole="button"
        accessibilityLabel={`会话：${s.title}`}
        onPress={() => {
          onClose();
          void store.openSessionRow(s.id, s.engine);
        }}
        onLongPress={
          otherEngine
            ? undefined
            : () => {
                setMenuFor(menuFor === s.id ? null : s.id);
                setRenameText(s.title);
              }
        }
        style={({ pressed }) => [styles.row, s.id === state.currentId && styles.rowActive, pressed && styles.rowPressed]}
      >
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
            {otherEngine ? <EngineTag engine={s.engine} /> : null}
            <SideTag link={link} />
            <StatusTag s={s} />
          </View>
        </View>
      </Pressable>

      {menuFor === s.id ? (
        <View style={styles.menu}>
          <Pressable onPress={() => { void store.setSessionPinned(s.id, true); setMenuFor(null); }}>
            <Text style={styles.menuItem}>置顶</Text>
          </Pressable>
          <Pressable onPress={() => { void store.setSessionPinned(s.id, false); setMenuFor(null); }}>
            <Text style={styles.menuItem}>取消置顶</Text>
          </Pressable>
          <Pressable onPress={() => { void store.archiveSession(s.id, true); setMenuFor(null); }}>
            <Text style={[styles.menuItem, { color: colors.danger }]}>归档</Text>
          </Pressable>
          <View style={styles.renameRow}>
            <TextInput
              style={styles.renameInput}
              value={renameText}
              onChangeText={setRenameText}
              placeholder="会话标题"
              placeholderTextColor={colors.textFaint}
            />
            <Pressable onPress={() => { void store.renameSession(s.id, renameText); setMenuFor(null); }}>
              <Text style={styles.menuItem}>保存</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      </React.Fragment>
    );
  };

  return (
    <View style={styles.overlay}>
      <Animated.View
        renderToHardwareTextureAndroid
        style={[styles.backdrop, { opacity: anim }]}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="关闭会话抽屉" />
      </Animated.View>

      <Animated.View
        renderToHardwareTextureAndroid
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

        <View style={[styles.searchWrap, searchFocused && styles.searchWrapFocused]}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            style={styles.search}
            value={q}
            onChangeText={setQ}
            placeholder="搜索会话"
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="搜索会话"
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
        </View>

        <View style={styles.workspaceBlock}>
          <Text style={styles.workspaceLabel}>工作区</Text>
          {state.workspaces.length === 0 ? (
            <Text style={styles.workspaceEmpty}>宿主没有报告工作区</Text>
          ) : (
            state.workspaces.map((ws) => (
              <View key={ws.id} style={styles.workspaceRow}>
                <Text style={styles.workspaceGlyph}>▢</Text>
                <View style={styles.workspaceTexts}>
                  <Text style={styles.workspaceName} numberOfLines={1}>
                    {ws.name}
                  </Text>
                  <Text style={styles.workspacePath} numberOfLines={1}>
                    {ws.root}
                  </Text>
                </View>
              </View>
            ))
          )}
          <Text style={styles.workspaceHint}>工作区限制可访问目录与可用锦囊</Text>
        </View>

        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="自动选择引擎"
          accessibilityState={{ checked: state.autoRoute }}
          onPress={() => store.setAutoRoute(!state.autoRoute)}
          style={({ pressed }) => [styles.autoRouteRow, pressed && styles.accountPressed]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.autoRouteLabel}>自动选择引擎</Text>
            <Text style={styles.autoRouteHint}>代码 / 后台 / pptx 自动走完整引擎</Text>
          </View>
          <View style={[styles.autoRoutePill, state.autoRoute && styles.autoRoutePillOn]}>
            <Text style={[styles.autoRouteValue, state.autoRoute && styles.autoRouteValueOn]}>
              {state.autoRoute ? '开' : '关'}
            </Text>
          </View>
        </Pressable>

        <ScrollView style={styles.listScroll} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {groups.length === 0 ? (
            <EmptyState
              glyph="🗂"
              title={keyword ? '没有匹配的会话' : '还没有会话'}
              description={keyword ? '换个关键词试试。' : '发第一条消息，或从锦囊里选一个开始。'}
              style={styles.emptyState}
            />
          ) : (
            groups.map((g) => (
              <View key={g.title} style={{ gap: 6 }}>
                <Text style={styles.groupTitle}>{g.title}</Text>
                {g.items.map(renderRow)}
              </View>
            ))
          )}
        </ScrollView>

        <Pressable
          onPress={() => {
            onClose();
            void store.openSettings();
          }}
          accessibilityRole="button"
          accessibilityLabel="账号与设置"
          style={({ pressed }) => [styles.account, pressed && styles.accountPressed]}
        >
          <View style={styles.accountInfo}>
            <Text style={styles.accountName}>{accountLabel}</Text>
            <Text style={styles.accountSub}>
              {account?.status === 'credential-stored' ? '已登录' : '未登录'} · 账号与设置
            </Text>
          </View>
          <Text style={styles.accountGear}>⚙</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-start',
    pointerEvents: 'box-none',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,17,21,0.28)',
  },
  panel: {
    width: PANEL_WIDTH,
    height: '100%',
    backgroundColor: semantic.sidebar,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    paddingTop: topInset + 12,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  panelTitle: { color: colors.text, fontSize: 16, lineHeight: 28, fontWeight: '500', letterSpacing: 0.2 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: space.md,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchWrapFocused: {
    borderColor: colors.blue,
    backgroundColor: colors.glass,
  },
  searchIcon: { color: colors.textFaint, fontSize: 13 },
  search: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 20, paddingVertical: 0 },
  listScroll: { flex: 1 },
  list: { padding: space.md, gap: space.lg, paddingBottom: space.xl },
  workspaceBlock: {
    marginTop: space.md,
    marginHorizontal: space.md,
    padding: space.md,
    borderRadius: radius.sm,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 6,
  },
  workspaceLabel: { color: semantic.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '500' },
  workspaceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  workspaceGlyph: { color: colors.textFaint, fontSize: 14 },
  workspaceTexts: { flex: 1 },
  workspaceName: { color: colors.text, fontSize: 13, lineHeight: 20, fontWeight: '500' },
  workspacePath: { color: colors.textFaint, fontSize: 11, lineHeight: 16 },
  workspaceHint: { color: colors.textFaint, fontSize: 12, lineHeight: 18 },
  workspaceEmpty: { color: colors.textFaint, fontSize: 12, lineHeight: 18 },
  autoRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  autoRouteLabel: { color: colors.text, fontSize: 13, lineHeight: 20, fontWeight: '500' },
  autoRouteHint: { color: colors.textFaint, fontSize: 11, lineHeight: 16 },
  autoRoutePill: {
    minWidth: 34,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.glassStrong,
  },
  autoRoutePillOn: { backgroundColor: colors.blueSoft },
  autoRouteValue: { color: colors.textFaint, fontSize: 11, fontWeight: '600' },
  autoRouteValueOn: { color: colors.blue },
  groupTitle: {
    color: semantic.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
    letterSpacing: 0.2,
    marginLeft: 8,
    marginBottom: 4,
  },
  emptyState: { paddingTop: space.md },
  menu: {
    marginLeft: 46,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 4,
  },
  menuItem: { color: colors.blue, fontSize: 13, lineHeight: 20, paddingVertical: 5 },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  renameInput: {
    flex: 1,
    color: colors.text,
    fontSize: 12.5,
    backgroundColor: colors.glassStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: radius.sm },
  rowActive: { backgroundColor: semantic.sidebarActive },
  rowPressed: { backgroundColor: semantic.sidebarHover },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { color: colors.text, fontSize: 13, lineHeight: 20, fontWeight: '500', flex: 1 },
  rowTime: { color: colors.textFaint, fontSize: 11, lineHeight: 16 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowPreview: { color: colors.textFaint, fontSize: 12, lineHeight: 18, flex: 1 },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.xs },
  tagText: { fontSize: 10, fontWeight: '500' },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: semantic.sidebar,
  },
  accountPressed: { backgroundColor: semantic.sidebarHover },
  accountInfo: { flex: 1 },
  accountName: { color: colors.text, fontSize: 13, lineHeight: 20, fontWeight: '500' },
  accountSub: { color: colors.textFaint, fontSize: 11, lineHeight: 16 },
  accountGear: { color: colors.textFaint, fontSize: 16 },
});
