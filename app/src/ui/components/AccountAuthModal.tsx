import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { store, useStore } from '../useStore';
import { IconButton } from '../parts';
import { space, topInset, useTheme, useThemedStyles, type Theme } from '../theme';

/**
 * DeepSeek 账号登录（轻引擎）。
 *
 * 平台只接受 loopback 回调，但我们不需要真的起 HTTP 服务：
 * WebView 在跳转到 redirectUri 之前把它拦下来，把 code 交给 store 去换 token。
 */
export function AccountAuthModal(): React.ReactElement | null {
  const state = useStore();
  const auth = state.accountAuth;
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [loading, setLoading] = React.useState(true);

  if (!auth) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={() => void store.cancelAccountSignIn()}>
      <View style={styles.root}>
        <View style={styles.header}>
          <IconButton icon="back" label="取消登录" onPress={() => void store.cancelAccountSignIn()} />
          <Text style={styles.title}>登录 DeepSeek 账号</Text>
          <View style={{ width: 36 }} />
        </View>
        <WebView
          source={{ uri: auth.authorizeUrl }}
          style={styles.web}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onShouldStartLoadWithRequest={(req) => {
            if (req.url.startsWith(auth.redirectUri)) {
              void store.completeAccountAuth(req.url);
              return false;
            }
            return true;
          }}
        />
        {loading ? (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator size="large" color={palette.blue} />
            <Text style={styles.loadingText}>正在打开 DeepSeek 授权页…</Text>
          </View>
        ) : null}
      </View>
    </Modal>
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
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      backgroundColor: c.bgElevated,
    },
    title: { flex: 1, color: c.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
    web: { flex: 1, backgroundColor: c.bg },
    loading: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: c.bg,
    },
    loadingText: { color: c.textDim, fontSize: 12 },
  });
