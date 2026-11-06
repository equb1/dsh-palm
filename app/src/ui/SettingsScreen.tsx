import React from 'react';
import { BackHandler, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { store, useStore } from './useStore';
import { IconButton } from './parts';
import { SmoothKeyboardAvoid } from './SmoothKeyboardAvoid';
import { radius, space, topInset, useTheme, useThemedStyles, type Theme } from './theme';
import { hostAvailable, hostBatteryWhitelisted, hostLogs } from '../lib/host';
import { EngineScreen } from './EngineScreen';
import { LightEngineScreen } from './LightEngineScreen';
import { AccountScreen } from './settings/AccountScreen';
import { CredentialsScreen } from './settings/CredentialsScreen';
import { HostScreen } from './settings/HostScreen';
import { LabScreen } from './settings/LabScreen';
import { ProvidersScreen } from './settings/ProvidersScreen';
import { ThemeScreen } from './settings/ThemeScreen';
import { SettingsGroup, type SettingsRow } from './settings/SettingsTile';

/** U4：设置首页只做导航；每行点进独立二级页 */
type SettingsRoute =
  | 'account'
  | 'credentials'
  | 'providers'
  | 'host'
  | 'lab'
  | 'engine'
  | 'light'
  | 'theme';

/**
 * 设置首页。
 *
 * 六组 SettingsTile + 搜索；具体控制都在二级页（账号 / Key / 提供商 / 宿主 / 实验室 / 引擎）。
 * 注意：Key 写给宿主，手机不保存——本机模式下宿主就是这台手机。
 */
export function SettingsScreen(): React.ReactElement {
  const state = useStore();
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  /** null = 问不到（非 Android / 老系统） */
  const [batteryOk, setBatteryOk] = React.useState<boolean | null>(null);
  const [route, setRoute] = React.useState<SettingsRoute | null>(null);
  /** U4：设置首页搜索 */
  const [query, setQuery] = React.useState('');
  const [notice, setNotice] = React.useState<string | null>(null);

  // 本机引擎状态：进设置页就每 2 秒拉一次（首页 tile 的右值要准）
  const host = state.host;
  const hostReady = host?.engine === 'ready' && host?.bridge === 'ready';
  const hostStarting = host?.engine === 'starting';
  const hostLabel = !hostAvailable
    ? '不支持'
    : hostReady
      ? '运行中'
      : host?.engine === 'failed' || host?.bridge === 'failed'
        ? '出错'
        : hostStarting
          ? host && (host.progress ?? 0) > 0
            ? `启动中 ${host.progress}%`
            : '启动中'
          : '已停止';

  React.useEffect(() => {
    if (!hostAvailable) return;
    void hostBatteryWhitelisted().then(setBatteryOk);
    void store.refreshHost();
    void store.loadHostCommands();
    // 首装解压只有 10 秒左右，启动时拉密一点才看得见进度
    const timer = setInterval(() => void store.refreshHost(), hostStarting ? 500 : 2000);
    return () => clearInterval(timer);
  }, [hostStarting]);

  // 账号 tile 的当前值；账号页自己负责刷新账号状态
  const account = state.account;
  const signedIn = account?.status === 'credential-stored';
  const waiting =
    account?.attempt?.phase === 'waiting-browser' || account?.attempt?.phase === 'initializing';

  // 首页也要读一次账号（账号页的 refresh 只在进账号页时跑，tile 不能一直是旧值）
  React.useEffect(() => {
    if (!state.caps) return;
    void store.refreshAccount();
  }, [state.caps]);

  // 二级页打开时接管安卓返回键：先回设置首页，而不是整页关掉设置
  React.useEffect(() => {
    if (!route) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setRoute(null);
      return true;
    });
    return () => sub.remove();
  }, [route]);

  const flash = (message: string): void => {
    setNotice(message);
    setTimeout(() => setNotice((current) => (current === message ? null : current)), 2600);
  };

  const exportLogs = (): void => {
    void (async () => {
      const lines = await hostLogs();
      await Share.share({ message: lines.slice(-300).join('\n') || '（暂无日志）' }).catch(
        () => undefined,
      );
    })();
  };

  const lightModel = state.defaultModel?.model ?? '未配置';
  const providerCount = state.providers.length;
  const allGroups: Array<{ key: string; title: string; rows: SettingsRow[] }> = [
    {
      key: 'ai',
      title: 'AI',
      rows: [
        {
          id: 'account',
          title: 'DeepSeek 账号',
          value: signedIn ? '已登录' : waiting ? '登录中' : '未登录',
          icon: '人',
          tone: 'blue',
          warn: !signedIn,
          onPress: () => setRoute('account'),
        },
        {
          id: 'key',
          title: 'API Key（备选）',
          value: state.credentials.DEEPSEEK_API_KEY?.configured === true ? '已配置' : '未配置',
          icon: '钥',
          tone: 'blue',
          onPress: () => setRoute('credentials'),
        },
        {
          id: 'providers',
          title: '模型提供商',
          value: `${providerCount} 个`,
          icon: '模',
          tone: 'blue',
          hint: lightModel !== '未配置' ? `当前 ${lightModel}` : undefined,
          onPress: () => setRoute('providers'),
        },
      ],
    },
    {
      key: 'capability',
      title: '能力',
      rows: [
        {
          id: 'light-engine',
          title: '轻引擎渠道',
          value: lightModel,
          icon: '轻',
          tone: 'green',
          onPress: () => setRoute('light'),
        },
        {
          id: 'full-engine',
          title: '完整引擎',
          value: hostAvailable ? hostLabel : '不支持',
          icon: '全',
          tone: 'green',
          warn: host?.engine === 'failed' || host?.bridge === 'failed',
          onPress: () => setRoute('engine'),
        },
      ],
    },
    {
      key: 'appearance',
      title: '外观',
      rows: [
        {
          id: 'theme',
          title: '主题',
          value:
            state.themeMode === 'system'
              ? '跟随系统'
              : state.themeMode === 'dark'
                ? '深色'
                : '浅色',
          icon: '◐',
          tone: 'violet',
          onPress: () => setRoute('theme'),
        },
        {
          id: 'font',
          title: '对话字号',
          value:
            state.chatFontScale >= 1.3
              ? '特大'
              : state.chatFontScale >= 1.15
                ? '大'
                : '标准',
          icon: 'A',
          tone: 'violet',
          onPress: () => store.cycleChatFontScale(),
        },
        {
          id: 'collapse',
          title: '完成后收起过程',
          value: state.collapseProcess ? '开' : '关',
          icon: '▾',
          tone: 'violet',
          onPress: () => store.setCollapseProcess(!state.collapseProcess),
        },
      ],
    },
    {
      key: 'general',
      title: '通用',
      rows: [
        {
          id: 'notify',
          title: '通知',
          value: '系统管理',
          icon: '铃',
          tone: 'amber',
          onPress: () => flash('通知权限由系统管理；会话完成/审批提醒已接原生通知。'),
        },
        {
          id: 'battery',
          title: '后台保活',
          value: batteryOk == null ? '未知' : batteryOk ? '已放行' : '受限制',
          icon: '电',
          tone: 'amber',
          warn: batteryOk === false,
          onPress: () => setRoute('engine'),
        },
      ],
    },
    {
      key: 'host',
      title: '主机',
      rows: [
        {
          id: 'engine',
          title: '本机引擎',
          value: hostLabel,
          icon: '引',
          tone: 'slate',
          onPress: () => setRoute('engine'),
        },
        {
          id: 'host-info',
          title: '宿主',
          value: state.caps?.host.name ?? '未连接',
          icon: '宿',
          tone: 'slate',
          onPress: () => setRoute('host'),
        },
        {
          id: 'lab',
          title: '实验室',
          value: '3 个入口',
          icon: '验',
          tone: 'slate',
          onPress: () => setRoute('lab'),
        },
      ],
    },
    {
      key: 'about',
      title: '帮助与关于',
      rows: [
        {
          id: 'version',
          title: '版本',
          value: state.caps?.host.engineVersion ?? '—',
          icon: 'v',
          tone: 'slate',
          onPress: () => flash(`引擎 ${state.caps?.host.engineVersion ?? '—'} · 轻引擎 0.1.0-light`),
        },
        {
          id: 'export',
          title: '导出宿主日志',
          icon: '⇪',
          tone: 'slate',
          hint: '最近 300 行，走系统分享',
          onPress: exportLogs,
        },
      ],
    },
  ];
  const q = query.trim().toLowerCase();
  const groups = allGroups
    .map((group) => ({
      ...group,
      rows: q
        ? group.rows.filter((row) =>
            `${row.title} ${row.value ?? ''} ${row.hint ?? ''}`.toLowerCase().includes(q),
          )
        : group.rows,
    }))
    .filter((group) => group.rows.length > 0);

  // HomeScreen 的「配置轻引擎」入口：进设置后直接落在这个页面
  if (state.lightSetupOpen) {
    return (
      <LightEngineScreen
        onClose={() => {
          store.closeLightSetup();
          store.closeSettings();
        }}
      />
    );
  }
  if (route === 'theme') {
    return <ThemeScreen onClose={() => setRoute(null)} />;
  }
  if (route === 'engine') {
    return <EngineScreen onClose={() => setRoute(null)} />;
  }
  if (route === 'light') {
    return <LightEngineScreen onClose={() => setRoute(null)} />;
  }
  if (route === 'account') {
    return <AccountScreen onClose={() => setRoute(null)} />;
  }
  if (route === 'credentials') {
    return <CredentialsScreen onClose={() => setRoute(null)} />;
  }
  if (route === 'providers') {
    return <ProvidersScreen onClose={() => setRoute(null)} />;
  }
  if (route === 'host') {
    return <HostScreen onClose={() => setRoute(null)} />;
  }
  if (route === 'lab') {
    return <LabScreen onClose={() => setRoute(null)} />;
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回" onPress={() => store.closeSettings()} />
        <Text style={styles.title}>设置</Text>
        <View style={{ width: 36 }} />
      </View>

      <SmoothKeyboardAvoid style={styles.bodyWrap}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.searchBox}>
            <Text style={styles.searchGlyph}>⌕</Text>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="搜索设置"
              placeholderTextColor={palette.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="搜索设置"
            />
            {query.length > 0 ? (
              <Pressable accessibilityRole="button" onPress={() => setQuery('')} hitSlop={8}>
                <Text style={styles.searchClear}>×</Text>
              </Pressable>
            ) : null}
          </View>

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          {groups.map((group) => (
            <SettingsGroup key={group.key} title={group.title} rows={group.rows} />
          ))}
          {groups.length === 0 ? <Text style={styles.hint}>没找到匹配的设置项。</Text> : null}

          {Boolean(state.error) ? (
            <Pressable onPress={() => store.clearError()}>
              <Text style={styles.error}>{state.error}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </SmoothKeyboardAvoid>
    </View>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg, paddingTop: topInset },
    bodyWrap: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    title: { flex: 1, color: c.text, fontSize: 17, fontWeight: '700' },
    scroll: { padding: space.lg, gap: 12, paddingBottom: space.xxl },
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
    searchClear: { color: c.textFaint, fontSize: 16, paddingHorizontal: 2 },
    notice: { color: c.textDim, fontSize: 12, lineHeight: 17, paddingHorizontal: space.xs },
    hint: { color: c.textDim, fontSize: 12, lineHeight: 17 },
    error: { color: c.danger, fontSize: 12, paddingHorizontal: space.xs },
  });
