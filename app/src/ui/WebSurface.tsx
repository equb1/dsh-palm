/**
 * 实验室：把官方 dsh web 前端塞进 WebView。
 *
 * 这是插件兼容 L0 的验证：官方前端 + 全部 64 个 web 插件原样渲染，
 * 地址是本机引擎（127.0.0.1:8787）带 token 的入口。
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { font, radius, space, topInset, useTheme, useThemedStyles, type Theme } from './theme';

export function WebSurface({ url, onClose }: { url: string; onClose: () => void }): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={styles.close}>‹ 关闭</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {url.replace(/\?.*$/, '')}
        </Text>
        {loading ? <ActivityIndicator size="small" color={palette.blue} /> : null}
      </View>

      {error ? <Text style={styles.error}>加载失败：{error}</Text> : null}

      <WebView
        source={{ uri: url }}
        style={styles.web}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        mixedContentMode="always"
        cacheEnabled={false}
        onLoadEnd={() => setLoading(false)}
        onError={(event) => {
          setLoading(false);
          setError(event.nativeEvent.description);
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
  error: { color: c.danger, fontSize: 12, paddingHorizontal: space.lg, paddingVertical: 6 },
  web: { flex: 1, backgroundColor: c.bg, borderRadius: radius.md },
});
