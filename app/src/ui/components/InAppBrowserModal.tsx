import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Clipboard,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import { BrandIcon } from './BrandIcon';
import { radius, space, topInset, useTheme, useThemedStyles, type Theme } from '../theme';
import { store, useStore } from '../useStore';

export function InAppBrowserModal(): React.ReactElement | null {
  const storeState = useStore();
  const url = storeState.inAppBrowserUrl;
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [canGoBack, setCanGoBack] = React.useState(false);
  const [canGoForward, setCanGoForward] = React.useState(false);
  const [pageTitle, setPageTitle] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);

  const webViewRef = React.useRef<React.ComponentRef<typeof WebView>>(null);

  if (!url || !/^https?:\/\//i.test(url)) return null;

  // 提取域名用于安全显示
  let domain = '';
  try {
    const match = url.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
    domain = match?.[1] ?? url;
  } catch {
    domain = url;
  }

  const handleClose = () => {
    store.closeInAppBrowser();
  };

  const handleCopy = () => {
    if (url) {
      Clipboard.setString(url);
      ToastAndroid.show('已复制网址到剪贴板', ToastAndroid.SHORT);
    }
  };

  const handleShare = async () => {
    if (!url) return;
    try {
      await Share.share({
        message: url,
        title: pageTitle || '分享链接',
      });
    } catch {}
  };

  return (
    <Modal
      visible={Boolean(url)}
      animationType="slide"
      onRequestClose={handleClose}
      hardwareAccelerated
    >
      <View style={styles.container}>
        {/* 顶部操作与地址栏 */}
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭网页"
            onPress={handleClose}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.btnPressed]}
          >
            <BrandIcon name="close" size={18} color={palette.text} />
          </Pressable>

          <View style={styles.addressBar}>
            <BrandIcon name="shield" size={12} color="#10B981" />
            <View style={styles.titleWrap}>
              <Text style={styles.domainText} numberOfLines={1}>
                {domain}
              </Text>
              {pageTitle ? (
                <Text style={styles.titleText} numberOfLines={1}>
                  {pageTitle}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.navActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="后退"
              disabled={!canGoBack}
              onPress={() => webViewRef.current?.goBack()}
              style={({ pressed }) => [
                styles.iconBtn,
                !canGoBack && styles.btnDisabled,
                pressed && styles.btnPressed,
              ]}
            >
              <BrandIcon
                name="back"
                size={16}
                color={canGoBack ? palette.text : palette.textFaint}
              />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="前进"
              disabled={!canGoForward}
              onPress={() => webViewRef.current?.goForward()}
              style={({ pressed }) => [
                styles.iconBtn,
                !canGoForward && styles.btnDisabled,
                pressed && styles.btnPressed,
              ]}
            >
              <View style={{ transform: [{ rotate: '180deg' }] }}>
                <BrandIcon
                  name="back"
                  size={16}
                  color={canGoForward ? palette.text : palette.textFaint}
                />
              </View>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="刷新"
              onPress={() => webViewRef.current?.reload()}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.btnPressed]}
            >
              <BrandIcon name="loader" size={16} color={palette.textDim} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="复制链接"
              onPress={handleCopy}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.btnPressed]}
            >
              <BrandIcon name="copy" size={15} color={palette.textDim} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="分享链接"
              onPress={handleShare}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.btnPressed]}
            >
              <BrandIcon name="share" size={15} color={palette.textDim} />
            </Pressable>
          </View>
        </View>

        {/* 顶部加载进度条 */}
        {loading && progress < 1 && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressBar, { width: `${Math.max(5, progress * 100)}%` }]} />
          </View>
        )}

        {/* 网页核心视口 */}
        <View style={styles.webWrap}>
          <WebView
            ref={webViewRef}
            source={{ uri: url }}
            style={styles.webView}
            javaScriptEnabled
            domStorageEnabled
            allowsBackForwardNavigationGestures
            onNavigationStateChange={(nav) => {
              setCanGoBack(nav.canGoBack);
              setCanGoForward(nav.canGoForward);
              if (nav.title) setPageTitle(nav.title);
            }}
            onLoadStart={() => {
              setLoading(true);
              setProgress(0.1);
            }}
            onLoadProgress={({ nativeEvent }) => {
              setProgress(nativeEvent.progress);
            }}
            onLoadEnd={() => {
              setLoading(false);
              setProgress(1);
            }}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="large" color={palette.blue} />
                <Text style={styles.loadingText}>正在安全载入网页…</Text>
              </View>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.bg,
      paddingTop: topInset,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      backgroundColor: c.bgElevated,
      gap: 4,
    },
    addressBar: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: c.glassStrong,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      minWidth: 0,
    },
    titleWrap: {
      flex: 1,
      minWidth: 0,
    },
    domainText: {
      fontSize: 12,
      fontWeight: '600',
      color: c.text,
    },
    titleText: {
      fontSize: 10,
      color: c.textDim,
    },
    navActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    iconBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnDisabled: {
      opacity: 0.3,
    },
    btnPressed: {
      opacity: 0.6,
      backgroundColor: c.glassStrong,
    },
    progressTrack: {
      height: 2,
      width: '100%',
      backgroundColor: 'transparent',
    },
    progressBar: {
      height: 2,
      backgroundColor: c.blue,
    },
    webWrap: {
      flex: 1,
    },
    webView: {
      flex: 1,
      backgroundColor: '#FFFFFF',
    },
    loadingWrap: {
      ...StyleSheet.absoluteFill,
      backgroundColor: c.bg,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    loadingText: {
      fontSize: 12,
      color: c.textDim,
    },
  });

