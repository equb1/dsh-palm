import React from 'react';
import { Alert, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { SessionSummary } from '../protocol';
import type { SessionRow } from '../state/sessionList';
import { store, useStore } from './useStore';
import { IconButton } from './parts';
import { EmptyState } from './components';
import { loadAccountPhone } from '../lib/accountPhone';
import type { ConversationLink } from '../lib/handoff';
import { motion, radius, space, topInset, useTheme, useThemedStyles, type Theme } from './theme';

const PANEL_WIDTH = 302;

/** U6：抽屉筛选胶囊（文件夹/整页搜索还没做） */
type SessionFilter = 'all' | 'running' | 'waiting' | 'unread';

const FILTERS: Array<{ id: SessionFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'running', label: '运行中' },
  { id: 'waiting', label: '待确认' },
  { id: 'unread', label: '未读' },
];

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
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  if (!link) return null;
  const full = link.activeSide === 'full';
  return (
    <View
      style={[
        styles.tag,
        { backgroundColor: full ? palette.blueSoft : palette.glassStrong },
      ]}
    >
      <Text style={[styles.tagText, { color: full ? palette.blue : palette.textFaint }]}>
        {full ? '完整' : '轻'}
      </Text>
    </View>
  );
}

/** 另一个引擎的会话：行上标「轻/完整」，点了先切引擎再打开 */
function EngineTag({ engine }: { engine: SessionRow['engine'] }): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const full = engine === 'full';
  return (
    <View style={[styles.tag, { backgroundColor: full ? palette.blueSoft : palette.glassStrong }]}>
      <Text style={[styles.tagText, { color: full ? palette.blue : palette.textFaint }]}>
        {full ? '完整' : '轻'}
      </Text>
    </View>
  );
}

function StatusTag({ s }: { s: SessionSummary }): React.ReactElement | null {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  if (s.status === 'waiting_approval') {
    return (
      <View style={[styles.tag, { backgroundColor: palette.warnSoft }]}>
        <Text style={[styles.tagText, { color: palette.warn }]}>待确认</Text>
      </View>
    );
  }
  if (s.status === 'error') {
    return (
      <View style={[styles.tag, { backgroundColor: palette.dangerSoft }]}>
        <Text style={[styles.tagText, { color: palette.danger }]}>出错</Text>
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
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
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
  const mountedRef = React.useRef(mounted);
  mountedRef.current = mounted;
  const [q, setQ] = React.useState('');
  const [filter, setFilter] = React.useState<SessionFilter>('all');
  /** U6 文件夹：筛选 + 给会话改名/移动 */
  const [folderFilter, setFolderFilter] = React.useState<string | null>(null);
  const [folderPromptFor, setFolderPromptFor] = React.useState<string | null>(null);
  const [folderText, setFolderText] = React.useState('');
  const anim = React.useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  const [renameText, setRenameText] = React.useState('');
  const [searchFocused, setSearchFocused] = React.useState(false);

  /**
   * 抽屉内容提前 mount（Home 空闲 350ms 后）并保持挂载。
   *
   * 之前每次展开都在动画启动的同一帧挂载整棵会话树，129 个原生 View 的
   * layout 会和位移动画抢帧，表现就是展开瞬间卡一下。预挂载后展开只是一次
   * native transform；关闭只把面板移出屏幕，不再卸载/重建。
   */
  React.useEffect(() => {
    if (visible || mounted) return;
    const timer = setTimeout(() => setMounted(true), 350);
    return () => clearTimeout(timer);
  }, [visible, mounted]);

  React.useEffect(() => {
    if (visible) setMounted(true);
    const animation = Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: motion.duration.base,
      easing: motion.easing.standard,
      useNativeDriver: true,
    });
    if (visible && !mountedRef.current) {
      // 极端情况下用户在预挂载前就点开：等一帧让内容完成 layout 再动画。
      const timer = setTimeout(() => animation.start(), 16);
      return () => {
        clearTimeout(timer);
        animation.stop();
      };
    }
    animation.start();
    return () => animation.stop();
  }, [visible, anim]);

  React.useEffect(() => {
    if (!visible) return;
    void loadAccountPhone().then(setLocalPhone);
  }, [visible]);

  const presets = state.caps?.presets ?? [];
  const currentEngine = state.engineKind === 'light' ? 'light' : 'full';
  const sessions = React.useMemo(
    () => store.sessionRows(),
    [state.sessions, state.sessionCache, state.engineKind],
  );
  const keyword = q.trim().toLowerCase();
  const matched = React.useMemo(
    () =>
      keyword
        ? sessions.filter((s) => `${s.title}${s.preview}`.toLowerCase().includes(keyword))
        : sessions,
    [sessions, keyword],
  );
  const folderNames = React.useMemo(
    () => Array.from(new Set(Object.values(state.sessionFolders))).sort(),
    [state.sessionFolders],
  );
  const filtered = React.useMemo(
    () =>
      matched.filter((s) => {
        if (folderFilter && state.sessionFolders[s.id] !== folderFilter) return false;
        if (filter === 'running') return s.status === 'running' || s.status === 'waiting_approval';
        if (filter === 'waiting') return s.status === 'waiting_approval';
        if (filter === 'unread') return s.unread > 0;
        return true;
      }),
    [matched, folderFilter, state.sessionFolders, filter],
  );

  const groups = React.useMemo(() => {
    const running = filtered.filter((s) => s.status === 'running' || s.status === 'waiting_approval');
    const pinned = filtered.filter((s) => s.pinned === true && !running.includes(s));
    const today = filtered.filter(
      (s) => !running.includes(s) && !pinned.includes(s) && s.updatedAt >= startOfToday(),
    );
    const older = filtered.filter(
      (s) => !running.includes(s) && !pinned.includes(s) && s.updatedAt < startOfToday(),
    );
    return [
      { title: '置顶', items: pinned },
      { title: '运行中', items: running },
      { title: '今天', items: today },
      { title: '更早', items: older },
    ].filter((g) => g.items.length > 0);
  }, [filtered]);

  if (!mounted) return null;

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
            {state.sessionFolders[s.id] ? (
              <View style={styles.folderTag}>
                <Text style={styles.folderTagText}>{state.sessionFolders[s.id]}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>

      {menuFor === s.id ? (
        <View style={styles.menu}>
          {currentEngine === 'full' ? (
            <Pressable
              onPress={() => {
                setMenuFor(null);
                onClose();
                void store.continueFullInLight(s.id);
              }}
            >
              <Text style={styles.menuItem}>在轻引擎继续（摘要交接）</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              setFolderPromptFor(s.id);
              setFolderText(state.sessionFolders[s.id] ?? '');
              setMenuFor(null);
            }}
          >
            <Text style={styles.menuItem}>移到文件夹…</Text>
          </Pressable>
          <Pressable onPress={() => { void store.setSessionPinned(s.id, true); setMenuFor(null); }}>
            <Text style={styles.menuItem}>置顶</Text>
          </Pressable>
          <Pressable onPress={() => { void store.setSessionPinned(s.id, false); setMenuFor(null); }}>
            <Text style={styles.menuItem}>取消置顶</Text>
          </Pressable>
          <Pressable onPress={() => { void store.archiveSession(s.id, true); setMenuFor(null); }}>
            <Text style={[styles.menuItem, { color: palette.danger }]}>归档</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setMenuFor(null);
              Alert.alert('删除会话', `删除「${s.title}」？只删会话记录，不影响工作区文件。`, [
                { text: '取消', style: 'cancel' },
                {
                  text: '删除',
                  style: 'destructive',
                  onPress: () => void store.deleteSession(s.id),
                },
              ]);
            }}
          >
            <Text style={[styles.menuItem, { color: palette.danger }]}>删除</Text>
          </Pressable>
          <View style={styles.renameRow}>
            <TextInput
              style={styles.renameInput}
              value={renameText}
              onChangeText={setRenameText}
              placeholder="会话标题"
              placeholderTextColor={palette.textFaint}
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
    <View
      style={styles.overlay}
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
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
          <View style={styles.panelHeaderActions}>
            <IconButton
              glyph="⊞"
              label="全部功能"
              size={32}
              onPress={() => {
                onClose();
                store.openFeatures();
              }}
            />
            <IconButton glyph="✕" label="关闭" onPress={onClose} size={32} />
          </View>
        </View>

        <View style={[styles.searchWrap, searchFocused && styles.searchWrapFocused]}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            style={styles.search}
            value={q}
            onChangeText={setQ}
            placeholder="搜索会话"
            placeholderTextColor={palette.textFaint}
            accessibilityLabel="搜索会话"
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="搜索全部会话正文"
            hitSlop={6}
            onPress={() => {
              onClose();
              store.openSearch();
            }}
          >
            <Text style={styles.searchAll}>全文</Text>
          </Pressable>
        </View>

        <View style={styles.filters}>
          {FILTERS.map((item) => {
            const active = filter === item.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`筛选：${item.label}`}
                accessibilityState={{ selected: active }}
                onPress={() => setFilter(item.id)}
                style={[styles.filterPill, active && styles.filterPillActive]}
              >
                <Text style={[styles.filterText, active && styles.filterTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {folderNames.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.folderScroll}
            contentContainerStyle={styles.folderRow}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="全部文件夹"
              onPress={() => setFolderFilter(null)}
              style={[styles.filterPill, folderFilter === null && styles.filterPillActive]}
            >
              <Text style={[styles.filterText, folderFilter === null && styles.filterTextActive]}>
                全部文件夹
              </Text>
            </Pressable>
            {folderNames.map((name) => {
              const active = folderFilter === name;
              return (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  accessibilityLabel={`文件夹 ${name}`}
                  onPress={() => setFolderFilter(active ? null : name)}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>
                    {name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {folderPromptFor ? (
          <View style={styles.folderEditorTop}>
            <Text style={styles.folderLabel} numberOfLines={1}>
              移到文件夹：{sessions.find((s) => s.id === folderPromptFor)?.title ?? '会话'}
            </Text>
            <View style={styles.renameRow}>
              <TextInput
                style={styles.renameInput}
                value={folderText}
                onChangeText={setFolderText}
                placeholder="留空则移出文件夹"
                placeholderTextColor={palette.textFaint}
                autoFocus
                accessibilityLabel="文件夹名"
                onSubmitEditing={() => {
                  store.setSessionFolder(folderPromptFor, folderText);
                  setFolderPromptFor(null);
                }}
              />
              <Pressable
                hitSlop={10}
                onPress={() => {
                  store.setSessionFolder(folderPromptFor, folderText);
                  setFolderPromptFor(null);
                }}
              >
                <Text style={styles.menuItem}>保存</Text>
              </Pressable>
              <Pressable hitSlop={10} onPress={() => setFolderPromptFor(null)}>
                <Text style={styles.menuItem}>取消</Text>
              </Pressable>
            </View>
            {folderNames.length > 0 ? (
              <View style={styles.folderQuick}>
                {folderNames.map((name) => (
                  <Pressable
                    key={name}
                    accessibilityRole="button"
                    onPress={() => {
                      store.setSessionFolder(folderPromptFor, name);
                      setFolderPromptFor(null);
                    }}
                  >
                    <Text style={styles.folderQuickText}>{name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

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
              title={
                keyword
                  ? '没有匹配的会话'
                  : filter !== 'all'
                    ? '没有符合条件的会话'
                    : '还没有会话'
              }
              description={
                keyword
                  ? '换个关键词试试。'
                  : filter !== 'all'
                    ? '换个筛选，或点「全部」看所有会话。'
                    : '发第一条消息，或从锦囊里选一个开始。'
              }
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

const createStyles = ({ palette: c, semantic: s }: Theme) =>
  StyleSheet.create({
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'flex-start',
    },
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.backdrop,
    },
    panel: {
      width: PANEL_WIDTH,
      height: '100%',
      backgroundColor: s.sidebar,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: c.border,
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
    panelTitle: { color: c.text, fontSize: 16, lineHeight: 28, fontWeight: '500', letterSpacing: 0.2 },
    panelHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginHorizontal: space.md,
      paddingHorizontal: 12,
      height: 36,
      borderRadius: radius.sm,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.border,
    },
    searchWrapFocused: {
      borderColor: c.blue,
      backgroundColor: c.glass,
    },
    searchIcon: { color: c.textFaint, fontSize: 13 },
    search: { flex: 1, color: c.text, fontSize: 13, lineHeight: 20, paddingVertical: 0 },
    searchAll: { color: c.blue, fontSize: 11.5, fontWeight: '600' },
    filters: {
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: space.md,
      paddingTop: space.sm,
    },
    filterPill: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: c.glass,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    filterPillActive: { backgroundColor: c.blueSoft, borderColor: c.blue },
    filterText: { color: c.textDim, fontSize: 11.5 },
    filterTextActive: { color: c.blue, fontWeight: '600' },
    folderScroll: { flexGrow: 0, flexShrink: 0, height: 42 },
    folderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: space.md,
      paddingVertical: 3,
    },
    folderEditorTop: {
      marginHorizontal: space.md,
      marginTop: 8,
      padding: 10,
      borderRadius: radius.sm,
      backgroundColor: c.bgElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      gap: 6,
    },
    folderEditor: {
      marginLeft: 46,
      marginBottom: 6,
      padding: 8,
      borderRadius: radius.sm,
      backgroundColor: c.bgElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      gap: 6,
    },
    folderLabel: { color: c.textFaint, fontSize: 11 },
    folderQuick: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    folderQuickText: {
      color: c.blue,
      fontSize: 11.5,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      backgroundColor: c.blueSoft,
    },
    folderTag: {
      backgroundColor: c.glassStrong,
      borderRadius: radius.xs,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    folderTagText: { color: c.textDim, fontSize: 10 },
    listScroll: { flex: 1 },
    list: { padding: space.md, gap: space.lg, paddingBottom: space.xl },
    workspaceBlock: {
      marginTop: space.md,
      marginHorizontal: space.md,
      padding: space.md,
      borderRadius: radius.sm,
      backgroundColor: c.glass,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      gap: 6,
    },
    workspaceLabel: { color: s.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: '500' },
    workspaceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    workspaceGlyph: { color: c.textFaint, fontSize: 14 },
    workspaceTexts: { flex: 1 },
    workspaceName: { color: c.text, fontSize: 13, lineHeight: 20, fontWeight: '500' },
    workspacePath: { color: c.textFaint, fontSize: 11, lineHeight: 16 },
    workspaceHint: { color: c.textFaint, fontSize: 12, lineHeight: 18 },
    workspaceEmpty: { color: c.textFaint, fontSize: 12, lineHeight: 18 },
    autoRouteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: space.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.sm,
      backgroundColor: c.glass,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    autoRouteLabel: { color: c.text, fontSize: 13, lineHeight: 20, fontWeight: '500' },
    autoRouteHint: { color: c.textFaint, fontSize: 11, lineHeight: 16 },
    autoRoutePill: {
      minWidth: 34,
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      backgroundColor: c.glassStrong,
    },
    autoRoutePillOn: { backgroundColor: c.blueSoft },
    autoRouteValue: { color: c.textFaint, fontSize: 11, fontWeight: '600' },
    autoRouteValueOn: { color: c.blue },
    groupTitle: {
      color: s.textSecondary,
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
      backgroundColor: c.bgElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      gap: 4,
    },
    menuItem: { color: c.blue, fontSize: 13, lineHeight: 20, paddingVertical: 5 },
    renameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
    renameInput: {
      flex: 1,
      color: c.text,
      fontSize: 12.5,
      backgroundColor: c.glassStrong,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: radius.sm },
    rowActive: { backgroundColor: s.sidebarActive },
    rowPressed: { backgroundColor: s.sidebarHover },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    rowTitle: { color: c.text, fontSize: 13, lineHeight: 20, fontWeight: '500', flex: 1 },
    rowTime: { color: c.textFaint, fontSize: 11, lineHeight: 16 },
    rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    rowPreview: { color: c.textFaint, fontSize: 12, lineHeight: 18, flex: 1 },
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
      borderTopColor: c.border,
      backgroundColor: s.sidebar,
    },
    accountPressed: { backgroundColor: s.sidebarHover },
    accountInfo: { flex: 1 },
    accountName: { color: c.text, fontSize: 13, lineHeight: 20, fontWeight: '500' },
    accountSub: { color: c.textFaint, fontSize: 11, lineHeight: 16 },
    accountGear: { color: c.textFaint, fontSize: 16 },
  });
