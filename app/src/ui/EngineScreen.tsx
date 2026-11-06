import React from 'react';
import { ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { store, useStore } from './useStore';
import { Btn, IconButton } from './parts';
import { SmoothKeyboardAvoid } from './SmoothKeyboardAvoid';
import { font, radius, space, topInset, useTheme, useThemedStyles, type Theme } from './theme';
import {
  hostAvailable,
  hostBatteryWhitelisted,
  hostLogs,
  openHostBatterySettings,
  setHostSafeModeNext,
} from '../lib/host';

/**
 * U5：独立引擎页。
 *
 * 设置页的「本机引擎」卡片搬到这里：状态环 + 启停/重启 + 失败卡（重试/安全模式/日志）
 * + 保活 + 日志 + 高级启动命令。设置页只留一行 tile，点进来做具体操作。
 */

const PREWARM_TIERS = [
  { id: 'trigger' as const, label: '触发式' },
  { id: 'smart' as const, label: '智能预热' },
  { id: 'always' as const, label: '常备' },
];

export function EngineScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const state = useStore();
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [batteryOk, setBatteryOk] = React.useState<boolean | null>(null);

  const host = state.host;
  const engine = state.engine;
  const hostReady = host?.engine === 'ready' && host?.bridge === 'ready';
  const hostStarting = host?.engine === 'starting';
  const hostFailed = host?.engine === 'failed' || host?.bridge === 'failed';
  const progress = host?.progress ?? 0;

  const engineLabel =
    engine.mode === 'starting-proot'
      ? `完整引擎启动中 ${progress > 0 ? progress + '%' : ''}`.trim()
      : engine.mode === 'full'
        ? engine.link === 'proot'
          ? '完整引擎（本机）'
          : '远程宿主'
        : '轻引擎（默认）';

  React.useEffect(() => {
    if (!hostAvailable) return;
    void hostBatteryWhitelisted().then(setBatteryOk);
    void store.refreshHost();
    void store.loadHostCommands();
    const timer = setInterval(() => void store.refreshHost(), hostStarting ? 500 : 2000);
    return () => clearInterval(timer);
  }, [hostStarting]);

  const primary = (() => {
    if (engine.mode === 'full') {
      return { label: '切回轻引擎', action: () => void store.switchEngine('light') };
    }
    if (hostReady || engine.prootWarm) {
      return { label: '切到完整引擎', action: () => void store.switchEngine('full') };
    }
    return {
      label: hostStarting ? `启动中${progress > 0 ? ` ${progress}%` : ''}…` : '预热完整引擎',
      action: () => void store.warmLocalHost(),
    };
  })();

  const safeRestart = (): void => {
    void (async () => {
      await setHostSafeModeNext(true);
      await store.reclaimProot('manual');
      await store.switchEngine('full');
    })();
  };

  const restart = (): void => {
    void (async () => {
      await store.reclaimProot('manual');
      await store.switchEngine('full');
    })();
  };

  const exportLogs = (): void => {
    void (async () => {
      const lines = await hostLogs();
      await Share.share({ message: lines.slice(-300).join('\n') || '（暂无日志）' }).catch(
        () => undefined,
      );
    })();
  };

  const ringColor = hostReady
    ? palette.ok
    : hostFailed
      ? palette.danger
      : hostStarting || engine.mode === 'starting-proot'
        ? palette.blue
        : palette.borderStrong;
  const ringTitle = hostReady
    ? '运行中'
    : hostFailed
      ? '出错'
      : hostStarting || engine.mode === 'starting-proot'
        ? '启动中'
        : '已停止';
  const ringSub = hostStarting && progress > 0 ? `${progress}%` : engine.mode === 'full' ? '完整模式' : '轻模式';

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回设置" onPress={onClose} />
        <Text style={styles.title}>本机引擎</Text>
        <View style={{ width: 36 }} />
      </View>

      <SmoothKeyboardAvoid style={styles.body}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.hero}>
            <View style={[styles.ring, { borderColor: ringColor }]}>
              <Text style={styles.ringTitle}>{ringTitle}</Text>
              <Text style={styles.ringSub}>{ringSub}</Text>
            </View>
            <View style={styles.meta}>
              <View style={styles.kv}>
                <Text style={styles.k}>引擎</Text>
                <Text style={styles.v}>{host?.engine ?? 'stopped'}</Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.k}>桥</Text>
                <Text style={styles.v}>
                  {(host?.bridge ?? 'stopped') + ' · :' + String(host?.port ?? 8788)}
                </Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.k}>当前</Text>
                <Text style={styles.v}>{engineLabel}</Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.k}>保活</Text>
                <Text style={[styles.v, batteryOk === false && { color: palette.warn }]}>
                  {batteryOk == null ? '未知' : batteryOk ? '已放行' : '受限制'}
                </Text>
              </View>
            </View>
          </View>

          {hostFailed ? (
            <View style={styles.failCard}>
              <Text style={styles.failTitle}>完整引擎没起来</Text>
              <Text style={styles.failBody}>
                {host?.error ?? host?.phase ?? '看日志确认是 rootfs、桥端口还是启动命令的问题。'}
              </Text>
              <View style={styles.actions}>
                <Btn label="重试" onPress={() => void store.warmLocalHost()} style={{ flex: 1 }} />
                <Btn label="安全模式" kind="ghost" onPress={safeRestart} style={{ flex: 1 }} />
                <Btn
                  label="看日志"
                  kind="ghost"
                  onPress={() => void store.refreshHostLogs()}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>操作</Text>
            <Text style={styles.hint}>
              默认轻引擎；完整引擎只在手动切换或预热档位允许时启动。预热只 startHost，不会连接。
            </Text>
            <Btn label={primary.label} onPress={primary.action} disabled={!hostAvailable} />
            <View style={styles.actions}>
              <Btn
                label="停止 proot"
                kind="ghost"
                onPress={() => void store.reclaimProot('manual')}
                disabled={!engine.prootWarm}
                style={{ flex: 1 }}
              />
              <Btn
                label="重新启动"
                kind="ghost"
                onPress={restart}
                disabled={!hostAvailable || engine.mode === 'starting-proot'}
                style={{ flex: 1 }}
              />
            </View>
            <Btn label="安全模式重启（重置 profiles）" kind="ghost" onPress={safeRestart} />

            <Text style={styles.label}>预热档位</Text>
            <View style={styles.actions}>
              {PREWARM_TIERS.map((tier) => (
                <Btn
                  key={tier.id}
                  label={tier.label}
                  kind={state.prewarmTier === tier.id ? 'primary' : 'ghost'}
                  onPress={() => store.setPrewarmTier(tier.id)}
                  style={{ flex: 1 }}
                />
              ))}
            </View>
            <Text style={styles.hint}>
              触发式（默认）= 只在点顶栏「完整」时启动；智能 = 充电且 WiFi 时后台预热；
              常备 = 开机就预热（更耗电）。
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.rowTop}>
              <Text style={styles.cardTitle}>后台保活</Text>
              <Text style={[styles.status, batteryOk === false && { color: palette.warn }]}>
                {batteryOk == null ? '未知' : batteryOk ? '已放行' : '受限制'}
              </Text>
            </View>
            <Text style={styles.hint}>
              受限制时系统可能在息屏后杀掉宿主；把锦囊加入「电池优化白名单」可减少断连。
            </Text>
            <Btn label="打开保活设置" kind="ghost" onPress={() => void openHostBatterySettings()} />
          </View>

          <View style={styles.card}>
            <View style={styles.rowTop}>
              <Text style={styles.cardTitle}>日志</Text>
              <Text style={styles.status}>{state.hostLogs.length} 行</Text>
            </View>
            <View style={styles.actions}>
              <Btn
                label="刷新状态"
                kind="ghost"
                onPress={() => void store.refreshHost()}
                style={{ flex: 1 }}
              />
              <Btn
                label="看日志"
                kind="ghost"
                onPress={() => void store.refreshHostLogs()}
                style={{ flex: 1 }}
              />
            </View>
            <Btn label="导出日志（最近 300 行）" kind="ghost" onPress={exportLogs} />

            {state.hostLogs.length > 0 ? (
              <View style={styles.logBox}>
                {state.hostLogs.slice(-16).map((line, i) => (
                  <Text key={i} style={styles.logLine} numberOfLines={2}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : (
              <Text style={styles.hint}>还没有日志；启动后点「看日志」。</Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>高级</Text>
            <Text style={styles.hint}>启动命令（留空用默认：proot 里的 dsh + node 桥）</Text>
            <TextInput
              style={styles.input}
              value={state.hostEngineCmd}
              onChangeText={(t) => store.setHostCommands(t, state.hostBridgeCmd)}
              placeholder="引擎命令，例如 sh /data/local/tmp/engine.sh"
              placeholderTextColor={palette.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="引擎启动命令"
            />
            <TextInput
              style={styles.input}
              value={state.hostBridgeCmd}
              onChangeText={(t) => store.setHostCommands(state.hostEngineCmd, t)}
              placeholder="桥命令，可用 {token} 和 {port} 占位符"
              placeholderTextColor={palette.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="桥启动命令"
            />
            {!hostAvailable ? (
              <Text style={styles.hint}>当前是 Expo Go / web，起不了本机引擎；需要原生构建的 APK。</Text>
            ) : null}
            {host?.phase ? (
              <Text style={styles.hint}>
                {host.phase}
                {progress > 0 && progress < 100 ? ` · ${progress}%` : ''}
              </Text>
            ) : null}
          </View>

          {Boolean(state.error) ? (
            <Text style={styles.error} onPress={() => store.clearError()}>
              {state.error}
            </Text>
          ) : null}
        </ScrollView>
      </SmoothKeyboardAvoid>
    </View>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg, paddingTop: topInset },
  body: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  title: { flex: 1, color: c.text, fontSize: 17, fontWeight: '700' },
  scroll: { padding: space.lg, gap: 12, paddingBottom: space.xxl },

  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  ring: {
    width: 132,
    height: 132,
    borderRadius: 66,
    borderWidth: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: c.glass,
  },
  ringTitle: { color: c.text, fontSize: 18, fontWeight: '700' },
  ringSub: { color: c.textFaint, fontSize: 11.5 },
  meta: { flex: 1, gap: 2 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 3 },
  k: { color: c.textDim, fontSize: 12.5 },
  v: { color: c.text, fontSize: 12.5, fontWeight: '500', flexShrink: 1, textAlign: 'right' },

  card: {
    backgroundColor: c.glass,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    padding: space.md,
    gap: space.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: c.text, fontSize: 14, fontWeight: '600' },
  status: { color: c.textFaint, fontSize: 11 },
  hint: { color: c.textDim, fontSize: 12, lineHeight: 17 },
  label: { color: c.text, fontSize: 12, fontWeight: '500', marginTop: 2 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: 2 },
  input: {
    backgroundColor: c.glassStrong,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: c.text,
    fontSize: 13,
  },

  failCard: {
    backgroundColor: c.dangerSoft,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.dangerBorderMedium,
    padding: space.md,
    gap: space.sm,
  },
  failTitle: { color: c.danger, fontSize: 14, fontWeight: '700' },
  failBody: { color: c.textDim, fontSize: 12, lineHeight: 17 },

  logBox: {
    backgroundColor: c.bgElevated,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  logLine: { color: c.textDim, fontSize: 10.5, fontFamily: font.mono },
  error: { color: c.danger, fontSize: 12, paddingHorizontal: space.xs },
});
