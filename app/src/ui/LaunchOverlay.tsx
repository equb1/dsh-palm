import React from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AppState } from '../state/store';
import { setHostSafeModeNext } from '../lib/host';
import { store } from './useStore';
import { colors, font, radius, space, topInset } from './theme';

interface Props {
  state: AppState;
}

/**
 * 开屏启动层（对齐 dsh-Go 的 LaunchLayer）：
 * - 盖在主界面之上，底下的 HomeScreen 同步挂载并预热本地缓存；
 * - 冷启动本机引擎时，展示品牌徽标呼吸动效、实时阶段说明与平滑进度条；
 * - 一旦 WebSocket 连上（state.conn === 'connected'），自动平滑淡出进入主页；
 * - 若上一次的引擎进程仍在后台存活被认领（0 秒复用），会在 ~150ms 内直接淡出；
 * - 用户也可随时点击底部「先看历史对话」跳过等待。
 */
export function LaunchOverlay({ state }: Props): React.ReactElement | null {
  const [dismissed, setDismissed] = React.useState(false);
  const [elapsedSec, setElapsedSec] = React.useState(0);
  const [smoothPct, setSmoothPct] = React.useState(12);
  const fadeAnim = React.useRef(new Animated.Value(1)).current;
  const pulseAnim = React.useRef(new Animated.Value(0)).current;
  const startTsRef = React.useRef(Date.now());
  const fadingOutRef = React.useRef(false);

  const host = state.host;
  const isConnected = state.conn === 'connected';
  const isFailed = host?.engine === 'failed' || host?.bridge === 'failed';
  const isUnpacking = Boolean(host?.phase && host.phase.includes('解压'));

  // 徽标呼吸动效
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  // 计时器与平滑虚拟进度（避免引擎加载的 8 秒内进度条卡在 96% 不动）
  React.useEffect(() => {
    if (dismissed) return;
    const timer = setInterval(() => {
      const elapsed = (Date.now() - startTsRef.current) / 1000;
      setElapsedSec(Math.floor(elapsed));

      if (isConnected) {
        setSmoothPct(100);
        return;
      }
      if (isUnpacking && typeof host?.progress === 'number' && host.progress >= 0) {
        setSmoothPct(Math.max(5, Math.min(95, host.progress)));
        return;
      }
      if (host?.bridge === 'ready') {
        setSmoothPct(96);
        return;
      }
      if (host?.engine === 'ready') {
        setSmoothPct(92);
        return;
      }
      // 引擎冷启动阶段：按指数趋近曲线从 15% 平滑推进到 88%
      const curve = 15 + Math.round(73 * (1 - Math.exp(-elapsed / 4.5)));
      setSmoothPct((prev) => Math.max(prev, Math.min(88, curve)));
    }, 200);
    return () => clearInterval(timer);
  }, [dismissed, isConnected, isUnpacking, host?.progress, host?.engine, host?.bridge]);

  const dismissWithFade = React.useCallback((fast = false) => {
    if (fadingOutRef.current) return;
    fadingOutRef.current = true;
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: fast ? 180 : 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setDismissed(true);
    });
  }, [fadeAnim]);

  // 一旦引擎+桥连接就绪，立刻设置为 100% 并平滑淡出进入主页
  React.useEffect(() => {
    if (isConnected && !dismissed) {
      setSmoothPct(100);
      const elapsed = Date.now() - startTsRef.current;
      // 如果是热复用（< 600ms 就连上了），快速淡出；如果是冷启动，留 120ms 让用户看清 100% 就绪状态
      const delay = elapsed < 600 ? 0 : 120;
      const t = setTimeout(() => dismissWithFade(elapsed < 600), delay);
      return () => clearTimeout(t);
    }
  }, [isConnected, dismissed, dismissWithFade]);

  if (dismissed) return null;

  // 状态主文案与副文案
  let stageTitle = '正在唤醒本机引擎…';
  let stageSub = '正在拉起沙箱环境与 DeepSeek Harness 服务';
  if (isConnected) {
    stageTitle = '引擎已就绪';
    stageSub = '正在进入工作台…';
  } else if (isFailed) {
    stageTitle = '本机引擎启动遇到问题';
    stageSub = host?.error || '请尝试重新启动或使用安全模式';
  } else if (isUnpacking) {
    const pct = typeof host?.progress === 'number' && host.progress >= 0 ? `${host.progress}%` : '';
    stageTitle = `${host?.phase || '正在解压运行环境'} ${pct}`.trim();
    stageSub = '首次启动需要解压内置 Linux 与 Node 运行时，后续启动无需重复解压';
  } else if (host?.bridge === 'ready') {
    stageTitle = '正在同步会话…';
    stageSub = '桥接服务已就绪，正在建立本机安全连接';
  } else if (host?.engine === 'ready') {
    stageTitle = '正在启动本机桥接…';
    stageSub = '引擎核心已就绪，正在绑定本地通信端口';
  } else if (host?.phase && host.phase.length > 0 && host.phase !== '准备运行时') {
    stageTitle = `${host.phase}…`;
  }

  const badgeScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.05],
  });
  const haloOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0.42],
  });

  return (
    <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
      <View style={styles.topSpacer} />

      {/* 居中品牌标识 */}
      <View style={styles.centerBox}>
        <View style={styles.emblemWrap}>
          <Animated.View
            style={[
              styles.emblemHalo,
              { opacity: haloOpacity, transform: [{ scale: badgeScale }] },
            ]}
          />
          <Animated.View style={[styles.emblem, { transform: [{ scale: badgeScale }] }]}>
            <Text style={styles.emblemGlyph}>锦</Text>
          </Animated.View>
        </View>
        <Text style={styles.title}>锦囊</Text>
        <Text style={styles.subtitle}>DeepSeek Harness · 掌上智能体工作台</Text>
      </View>

      {/* 底部加载进度与操作区 */}
      <View style={styles.bottomCard}>
        <View style={styles.statusHeader}>
          <View style={styles.statusTitleRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: isFailed
                    ? colors.danger
                    : isConnected
                      ? colors.ok
                      : colors.gold,
                },
              ]}
            />
            <Text style={styles.stageTitle} numberOfLines={1}>
              {stageTitle}
            </Text>
          </View>
          {!isFailed ? (
            <Text style={styles.pctText}>
              {smoothPct}%{elapsedSec >= 1 ? ` · ${elapsedSec}s` : ''}
            </Text>
          ) : null}
        </View>

        {!isFailed ? (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.max(4, Math.min(100, smoothPct))}%`,
                  backgroundColor: isConnected ? colors.ok : colors.gold,
                },
              ]}
            />
          </View>
        ) : null}

        <Text style={[styles.stageSub, isFailed && { color: colors.danger }]} numberOfLines={2}>
          {stageSub}
        </Text>

        {isFailed ? (
          <View style={styles.errorActions}>
            <Pressable
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={() => {
                startTsRef.current = Date.now();
                setSmoothPct(15);
                void store.stopLocalHost().then(() => store.startLocalHost());
              }}
            >
              <Text style={styles.actionBtnPrimaryText}>重新启动</Text>
            </Pressable>
            <Pressable
              style={styles.actionBtn}
              onPress={() => {
                startTsRef.current = Date.now();
                setSmoothPct(15);
                void setHostSafeModeNext(true)
                  .then(() => store.stopLocalHost())
                  .then(() => store.startLocalHost());
              }}
            >
              <Text style={styles.actionBtnText}>安全模式重启</Text>
            </Pressable>
            <Pressable
              style={styles.actionBtn}
              onPress={() => {
                store.openConnectModal();
                dismissWithFade(true);
              }}
            >
              <Text style={styles.actionBtnText}>诊断与日志</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.footerLinks}>
            <Pressable
              style={styles.skipBtn}
              onPress={() => dismissWithFade(true)}
              accessibilityRole="button"
              accessibilityLabel="先看历史对话"
            >
              <Text style={styles.skipBtnText}>先看历史对话 ›</Text>
            </Pressable>
            <View style={styles.footerDivider} />
            <Pressable
              style={styles.skipBtn}
              onPress={() => {
                store.openConnectModal();
                dismissWithFade(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="连接远程或查看日志"
            >
              <Text style={styles.skipBtnText}>连接状态 / 远程宿主 ›</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.bg,
    justifyContent: 'space-between',
    paddingTop: topInset + space.xl,
    paddingBottom: space.xxl,
    paddingHorizontal: space.xl,
    zIndex: 999,
  },
  topSpacer: {
    height: 32,
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemWrap: {
    width: 108,
    height: 108,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  emblemHalo: {
    position: 'absolute',
    width: 104,
    height: 104,
    borderRadius: 32,
    backgroundColor: colors.goldSoft,
  },
  emblem: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: colors.bgElevated,
    borderWidth: 1.5,
    borderColor: 'rgba(216,169,75,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemGlyph: {
    color: colors.gold,
    fontSize: 34,
    fontWeight: '700',
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 1,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 13,
    marginTop: 6,
  },
  bottomCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: 10,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  statusTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stageTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  pctText: {
    color: colors.textDim,
    fontSize: 12,
    fontFamily: font.mono,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.glassStrong,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  stageSub: {
    color: colors.textFaint,
    fontSize: 12,
    lineHeight: 17,
  },
  errorActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  actionBtnPrimary: {
    backgroundColor: colors.goldSoft,
    borderColor: colors.gold,
  },
  actionBtnPrimaryText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '600',
  },
  actionBtnText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '500',
  },
  footerLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    gap: 12,
  },
  skipBtn: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  skipBtnText: {
    color: colors.textDim,
    fontSize: 12,
  },
  footerDivider: {
    width: 1,
    height: 10,
    backgroundColor: colors.borderStrong,
  },
});
