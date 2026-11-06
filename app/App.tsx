import React from 'react';
import { AppState, BackHandler, Linking, Platform, StatusBar, StyleSheet, View } from 'react-native';

import { ChatScreen } from './src/ui/ChatScreen';
import { ConnectScreen } from './src/ui/ConnectScreen';
import { HomeScreen } from './src/ui/HomeScreen';
import { LaunchOverlay } from './src/ui/LaunchOverlay';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { FeaturesScreen } from './src/ui/FeaturesScreen';
import { FilesScreen } from './src/ui/FilesScreen';
import { SearchScreen } from './src/ui/SearchScreen';
import { WorkspaceScreen } from './src/ui/WorkspaceScreen';
import { TerminalScreen } from './src/ui/TerminalScreen';
import { ScreenFade } from './src/ui/components/ScreenFade';
import { store, useStore } from './src/ui/useStore';
import { ThemeProvider, useTheme, useThemedStyles, type Theme } from './src/ui/theme';
import { hostAvailable } from './src/lib/host';
import { parseDeepLink } from './src/lib/lightLink';
import type { AppState as DshAppState } from './src/state/store';

export default function App(): React.ReactElement {
  const state = useStore();
  return (
    <ThemeProvider mode={state.themeMode}>
      <AppShell state={state} />
    </ThemeProvider>
  );
}

function AppShell({ state }: { state: DshAppState }): React.ReactElement {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  // web 上把浏览器 color-scheme 和页面底色跟着主题走
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.style.colorScheme = theme.resolved;
    document.body.style.backgroundColor = theme.palette.webOuter;
  }, [theme.resolved, theme.palette.webOuter]);

  // 冷启动：恢复本地缓存 → 连轻引擎（冷启动到可输入 <1s，proot 不自动连接）
  const autoStarted = React.useRef(false);
  React.useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    void store.engineStart().catch(() => undefined);
  }, []);

  // dshpalm://pair?url=ws://192.168.1.7:8788/ws&code=246810 —— 扫码/外部唤起走这里
  // 冷启动及每次回到前台时：读系统分享内容 & 检查通知点击跳转
  React.useEffect(() => {
    void store.consumeShare();
    void store.checkNotificationNavigation();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void store.consumeShare();
        void store.checkNotificationNavigation();
        void store.onAppForeground().catch(() => undefined);
      }
    });
    return () => sub.remove();
  }, []);

  React.useEffect(() => {
    const handle = (url: string | null): void => {
      const link = parseDeepLink(url);
      if (!link) return;
      if (link.kind === 'pair') {
        // dshpalm://pair?url=ws://192.168.1.7:8788/ws&code=246810
        if (link.url) store.setUrl(link.url);
        if (link.code) store.setPairCode(link.code);
        if (link.url) void store.connect(link.url);
        return;
      }
      // dshpalm://light?base=…&model=…&key=… —— 扫码/粘贴切换本机模型渠道
      void store.connectLight(link.setup).then(() => {
        store.closeSession();
        store.closeSettings();
        store.closeLightSetup();
      });
    };
    void Linking.getInitialURL()
      .then((url) => handle(url ?? null))
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', (event) => handle(event.url));
    return () => sub.remove();
  }, []);

  React.useEffect(() => {
    const onBackPress = (): boolean => {
      // 1. 如果在设置页，返回首页
      if (state.view === 'settings') {
        store.closeSettings();
        return true;
      }
      // 1b. 全部功能页：返回首页
      if (state.view === 'features') {
        store.closeFeatures();
        return true;
      }
      // 1c. 文件页：返回首页
      if (state.view === 'files') {
        store.closeFiles();
        return true;
      }
      // 1d. 搜索页：返回首页
      if (state.view === 'search') {
        store.closeSearch();
        return true;
      }
      // 1e. 工作区页：返回首页
      if (state.view === 'workspace') {
        store.closeWorkspace();
        return true;
      }
      // 1f. 终端页：返回首页
      if (state.view === 'terminal') {
        store.closeTerminal();
        return true;
      }
      // 2. 如果打开了连接面板，关闭连接面板返回首页
      if (state.connectModalOpen) {
        store.closeConnectModal();
        return true;
      }
      // 3. 如果在会话详情页，返回会话列表（首页）
      if (state.detail) {
        store.closeSession();
        return true;
      }
      // 4. 在首页时，交由系统默认退出 App
      return false;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [state.view, state.connectModalOpen, state.detail]);

  const screen =
    state.view === 'terminal' ? (
      <TerminalScreen />
    ) : state.view === 'workspace' ? (
      <WorkspaceScreen />
    ) : state.view === 'search' ? (
      <SearchScreen />
    ) : state.view === 'files' ? (
      <FilesScreen />
    ) : state.view === 'features' ? (
      <FeaturesScreen />
    ) : state.view === 'settings' ? (
      <SettingsScreen />
    ) : state.connectModalOpen || (!hostAvailable && !state.caps) ? (
      <ConnectScreen />
    ) : state.detail ? (
      <ChatScreen session={state.detail} />
    ) : (
      <HomeScreen />
    );

  // web 上收成一列手机宽度，两边留黑，看起来才像手机
  const screenKey = `${state.view}:${state.detail?.id ?? ''}:${state.connectModalOpen ? 'connect' : ''}`;
  const shown = <ScreenFade trigger={screenKey}>{screen}</ScreenFade>;

  const statusBar = <StatusBar barStyle={theme.resolved === 'dark' ? 'light-content' : 'dark-content'} />;

  if (Platform.OS === 'web') {
    return (
      <View style={styles.webOuter}>
        {statusBar}
        <View style={styles.webFrame}>
          {shown}
          {hostAvailable && state.engine.mode === 'starting-proot' ? <LaunchOverlay state={state} /> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {statusBar}
      {shown}
      {hostAvailable && state.engine.mode === 'starting-proot' ? <LaunchOverlay state={state} /> : null}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.palette.bg },
    webOuter: {
      flex: 1,
      backgroundColor: theme.palette.webOuter,
      alignItems: 'center',
      justifyContent: 'center',
    },
    webFrame: {
      width: 430,
      maxWidth: '100%',
      height: '100%',
      maxHeight: 932,
      backgroundColor: theme.palette.bg,
      overflow: 'hidden',
    },
  });
