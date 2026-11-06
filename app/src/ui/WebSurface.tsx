/**
 * 实验室：把官方 dsh web 前端塞进 WebView。
 *
 * 这是插件兼容 L0 的验证：官方前端 + 全部 64 个 web 插件原样渲染。
 * M2.1 起地址和 token 由完整引擎的 `web.session` 下发（只在本机 loopback）；
 * WebView 里点会话会回到 RN 对应会话，App 退到后台时停止 WebView 内的轮询。
 */
import React from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import {
  buildWebBridgeControlScript,
  buildWebSessionBootstrap,
  describeWebViewError,
  initialWebSurfaceLifecycle,
  parseWebSessionNavigation,
  parseWebViewBridgeMessage,
  reduceWebSurfaceLifecycle,
  type WebFrontendTarget,
} from '../lib/webFrontend';
import { font, radius, space, topInset, useTheme, useThemedStyles, type Theme } from './theme';

export interface WebSurfaceProps {
  target: WebFrontendTarget;
  onClose: () => void;
  /** token 过期 / 引擎重启后重新向引擎要地址；不接就只提示回实验室重开 */
  onReload?: () => Promise<WebFrontendTarget | null>;
  /** 把 WebView 里的会话带回 RN；返回 false 时停留在 WebView 并显示错误 */
  onOpenSession?: (
    sessionId: string,
    engine: 'full' | 'light',
  ) => Promise<{ ok: boolean; error?: string }>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function WebSurface({
  target,
  onClose,
  onReload,
  onOpenSession,
}: WebSurfaceProps): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const webRef = React.useRef<React.ElementRef<typeof WebView>>(null);
  const openingSession = React.useRef(false);
  const [liveTarget, setLiveTarget] = React.useState(target);
  const [reloadCount, setReloadCount] = React.useState(0);
  const [reloading, setReloading] = React.useState(false);
  const [lifecycle, dispatch] = React.useReducer(
    reduceWebSurfaceLifecycle,
    undefined,
    initialWebSurfaceLifecycle,
  );

  React.useEffect(() => {
    setLiveTarget(target);
  }, [target.url, target.sessionId, target.note]);

  React.useEffect(() => {
    dispatch({ type: 'open' });
  }, [liveTarget.url, liveTarget.sessionId]);

  // 页面隐藏（切后台）就停掉 WebView 内的会话轮询；回到前台再恢复
  React.useEffect(() => {
    const applyVisibility = (next: AppStateStatus): void => {
      const visible = next === 'active';
      dispatch({ type: visible ? 'show' : 'hide' });
      webRef.current?.injectJavaScript(buildWebBridgeControlScript(visible ? 'start' : 'stop'));
    };
    const sub = AppState.addEventListener('change', applyVisibility);
    return () => sub.remove();
  }, []);

  React.useEffect(() => {
    webRef.current?.injectJavaScript(
      buildWebBridgeControlScript(lifecycle.visible ? 'start' : 'stop'),
    );
  }, [lifecycle.visible, liveTarget.url, liveTarget.sessionId]);

  // 卸载时主动停掉观察器并停止加载；WebView 本体随组件销毁
  React.useEffect(
    () => () => {
      webRef.current?.injectJavaScript(buildWebBridgeControlScript('stop'));
      webRef.current?.stopLoading();
    },
    [],
  );

  const bridgeReady = React.useMemo(
    () => buildWebSessionBootstrap(liveTarget.sessionId),
    [liveTarget.sessionId],
  );

  const openSession = React.useCallback(
    (sessionId: string, engine: 'full' | 'light'): void => {
      if (!onOpenSession) {
        dispatch({
          type: 'failed',
          error: '这个 WebView 入口还没接上会话跳转（unsupported）；回 RN 后请从会话列表打开。',
        });
        return;
      }
      // 点击注入和 onShouldStartLoadWithRequest 可能同时到；只处理一次
      if (openingSession.current) return;
      openingSession.current = true;
      dispatch({ type: 'loaded' });
      void onOpenSession(sessionId, engine)
        .then((result) => {
          if (!result.ok) {
            openingSession.current = false;
            dispatch({ type: 'failed', error: result.error ?? '没能切回 RN 会话' });
          }
        })
        .catch((error: unknown) => {
          openingSession.current = false;
          dispatch({ type: 'failed', error: `切回 RN 会话失败：${errorText(error)}` });
        });
    },
    [onOpenSession],
  );

  const handleMessage = React.useCallback(
    (event: WebViewMessageEvent): void => {
      const message = parseWebViewBridgeMessage(event.nativeEvent.data);
      if (!message) return;
      if (message.type === 'web-session') {
        if (message.sessionId === liveTarget.sessionId) return;
        openSession(message.sessionId, 'full');
        return;
      }
      if (message.type === 'web-deeplink') {
        const link = parseWebSessionNavigation(message.url);
        if (!link) {
          dispatch({
            type: 'failed',
            error: '这个深链暂不支持（只认 dshpalm://session 和显式 sessionId 的本机链接）。',
          });
          return;
        }
        openSession(link.sessionId, link.engine);
      }
    },
    [liveTarget.sessionId, openSession],
  );

  const retry = React.useCallback((): void => {
    dispatch({ type: 'retry' });
    if (!onReload) {
      setReloadCount((count) => count + 1);
      return;
    }
    setReloading(true);
    void onReload()
      .then((next) => {
        if (!next) {
          dispatch({ type: 'failed', error: '没拿到新的地址：回实验室重新打开。' });
          return;
        }
        setLiveTarget(next);
        setReloadCount((count) => count + 1);
      })
      .catch((error: unknown) => {
        dispatch({ type: 'failed', error: `重新获取地址失败：${errorText(error)}` });
      })
      .finally(() => setReloading(false));
  }, [onReload]);

  const loading = lifecycle.status === 'loading';

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={styles.close}>‹ 关闭</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {liveTarget.origin}
        </Text>
        {loading ? <ActivityIndicator size="small" color={palette.blue} /> : null}
      </View>

      {liveTarget.note ? <Text style={styles.note}>{liveTarget.note}</Text> : null}

      {lifecycle.error ? (
        <View style={styles.errorRow}>
          <Text style={styles.error}>{lifecycle.error}</Text>
          <Pressable accessibilityRole="button" onPress={retry} disabled={reloading} hitSlop={8}>
            <Text style={styles.retry}>{reloading ? '获取中…' : '重新获取地址'}</Text>
          </Pressable>
        </View>
      ) : null}

      <WebView
        key={`${liveTarget.url}::${liveTarget.sessionId ?? ''}::${lifecycle.generation}::${reloadCount}`}
        ref={webRef}
        source={{ uri: liveTarget.url }}
        style={styles.web}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        mixedContentMode="always"
        cacheEnabled={false}
        injectedJavaScriptBeforeContentLoaded={bridgeReady}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        onLoadEnd={() => dispatch({ type: 'loaded' })}
        onError={(event) => {
          dispatch({
            type: 'failed',
            error: describeWebViewError({ description: event.nativeEvent.description }),
          });
        }}
        onHttpError={(event) => {
          dispatch({
            type: 'failed',
            error: describeWebViewError({
              description: event.nativeEvent.description,
              statusCode: event.nativeEvent.statusCode,
            }),
          });
        }}
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={(request) => {
          const link = parseWebSessionNavigation(request.url);
          if (link) {
            openSession(link.sessionId, link.engine);
            return false;
          }
          if (request.url.toLowerCase().startsWith('dshpalm://')) {
            dispatch({
              type: 'failed',
              error: '这个 dshpalm 深链暂不支持；只认 dshpalm://session?sessionId=…',
            });
            return false;
          }
          return true;
        }}
      />
    </View>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg, paddingTop: topInset },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    close: { color: c.blue, fontSize: 15 },
    title: { flex: 1, color: c.textDim, fontSize: 12, fontFamily: font.mono },
    note: { color: c.textDim, fontSize: 12, lineHeight: 17, paddingHorizontal: space.lg, paddingBottom: 4 },
    errorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingHorizontal: space.lg,
      paddingVertical: 6,
    },
    error: { flex: 1, color: c.danger, fontSize: 12, lineHeight: 17 },
    retry: { color: c.blue, fontSize: 12, fontWeight: '600' },
    web: { flex: 1, backgroundColor: c.bg, borderRadius: radius.md },
  });
