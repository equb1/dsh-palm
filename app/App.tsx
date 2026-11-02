import React from 'react';
import { BackHandler, Linking, Platform, StatusBar, StyleSheet, View } from 'react-native';

import { ChatScreen } from './src/ui/ChatScreen';
import { ConnectScreen } from './src/ui/ConnectScreen';
import { HomeScreen } from './src/ui/HomeScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { store, useStore } from './src/ui/useStore';
import { colors } from './src/ui/theme';
import { hostAvailable } from './src/lib/host';
import { parseDeepLink } from './src/lib/lightLink';

export default function App(): React.ReactElement {
  const state = useStore();

  // 本机宿主：App 一起来就把引擎/桥拉起来（已经跑着的话服务会忽略重复启动）
  const autoStartHost = React.useRef(false);
  React.useEffect(() => {
    if (!hostAvailable || autoStartHost.current) return;
    autoStartHost.current = true;
    void store.startLocalHost().catch(() => undefined);
  }, []);

  // 引擎/桥就绪后自动连一次（配对码从桥日志里读），连上了就不用再轮询
  React.useEffect(() => {
    if (!hostAvailable || state.caps) return;
    const tick = (): void => {
      void store
        .refreshHost()
        .then(() => store.maybeAutoConnect())
        .catch(() => undefined);
    };
    tick();
    // 首装解压/冷启动只有十几秒，这段时间拉密一点才看得到进度
    const timer = setInterval(tick, 800);
    return () => clearInterval(timer);
  }, [state.caps]);


  // dshpalm://pair?url=ws://192.168.1.7:8788/ws&code=246810 —— 扫码/外部唤起走这里
  // 冷启动读一次系统分享的内容（文字进输入框，图片先进 pending）
  React.useEffect(() => {
    void store.consumeInitialShare();
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
      // 2. 如果在会话详情页，返回会话列表（首页）
      if (state.detail) {
        store.closeSession();
        return true;
      }
      // 3. 在首页时，交由系统默认退出 App
      return false;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [state.view, state.detail]);

  // 设置页优先：没连上也要能进去（本机引擎不需要连接）
  const screen =
    state.view === 'settings' ? (
      <SettingsScreen />
    ) : !state.caps ? (
      <ConnectScreen />
    ) : state.detail ? (
      <ChatScreen session={state.detail} />
    ) : (
      <HomeScreen />
    );

  // web 上收成一列手机宽度，两边留黑，看起来才像手机
  if (Platform.OS === 'web') {
    return (
      <View style={styles.webOuter}>
        <StatusBar barStyle="light-content" />
        <View style={styles.webFrame}>{screen}</View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      {screen}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  webOuter: {
    flex: 1,
    backgroundColor: '#050608',
    alignItems: 'center',
    justifyContent: 'center',
  },
  webFrame: {
    width: 430,
    maxWidth: '100%',
    height: '100%',
    maxHeight: 932,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
});
