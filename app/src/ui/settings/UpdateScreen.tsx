import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Btn, IconButton, Pill } from '../parts';
import { SmoothKeyboardAvoid } from '../SmoothKeyboardAvoid';
import { radius, space, topInset, useTheme, useThemedStyles, type Theme } from '../theme';
import {
  checkForUpdate,
  downloadUpdate,
  reloadWithUpdate,
  updateFailureMessage,
  updateRuntimeInfo,
} from '../../lib/updates';

/**
 * 版本与更新：显示当前版本 / OTA 状态，并提供一个「检查并更新」动作。
 *
 * release 包启动时 expo-updates 会自动检查（ON_LOAD），这里主要用于手动重试：
 *  - 确认当前跑的是内置包还是热更新；
 *  - 连不上服务器时重试；
 *  - 检查 → 下载 → 重启，一个按钮走完。
 */
export function UpdateScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [info, setInfo] = React.useState(() => updateRuntimeInfo());
  const [busy, setBusy] = React.useState<'check' | 'download' | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  /** 已经下载好、等重启生效的更新 */
  const [pending, setPending] = React.useState<{ updateId?: string; createdAt?: string } | null>(null);

  const refresh = (): void => setInfo(updateRuntimeInfo());

  const restart = async (): Promise<void> => {
    try {
      await reloadWithUpdate();
    } catch (error) {
      setNote(updateFailureMessage(error));
      setBusy(null);
    }
  };

  /** 一个按钮干完：检查 → 下载 → 提示重启；已下载则直接重启 */
  const checkAndUpdate = async (): Promise<void> => {
    if (busy) return;
    if (pending) {
      setBusy('download');
      setNote('正在重启应用…');
      await restart();
      return;
    }
    setBusy('check');
    setNote('正在检查更新…');
    try {
      const result = await checkForUpdate();
      if (!result.available) {
        setNote('已经是最新版本。');
        return;
      }
      setBusy('download');
      setNote('发现新版本，正在下载…');
      const fetched = await downloadUpdate();
      if (fetched.rolledBack) {
        setNote('服务器要求回滚到内置版本，正在重启…');
        await restart();
        return;
      }
      if (!fetched.downloaded) {
        setNote('已经是最新版本，无需下载。');
        return;
      }
      setPending({ updateId: fetched.updateId, createdAt: fetched.createdAt });
      setNote('更新已下载，重启后生效。');
      Alert.alert('更新已下载', '重启应用后生效，现在重启吗？', [
        { text: '稍后', style: 'cancel' },
        { text: '立即重启', onPress: () => void restart() },
      ]);
    } catch (error) {
      setNote(updateFailureMessage(error));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const statusText = !info.supported
    ? 'web 不支持'
    : !info.enabled
      ? '未启用（开发构建）'
      : info.isEmbeddedLaunch
        ? '内置版本'
        : '热更新版本';

  const buttonLabel = pending
    ? '重启应用更新'
    : busy === 'check'
      ? '检查中…'
      : busy === 'download'
        ? '下载中…'
        : '检查并更新';

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回设置" onPress={onClose} />
        <Text style={styles.title}>版本与更新</Text>
        <Pill>
          <Text style={[styles.status, info.enabled && { color: palette.ok }]}>{statusText}</Text>
        </Pill>
      </View>

      <SmoothKeyboardAvoid style={styles.body}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>当前运行版本</Text>
            <Row label="安装包版本" value={info.appVersion ?? '—'} />
            <Row label="runtimeVersion" value={info.runtimeVersion ?? '—'} />
            <Row label="更新 ID" value={info.updateId ?? '内置包'} mono />
            <Row
              label="更新创建时间"
              value={info.createdAt ? info.createdAt.toLocaleString() : '—'}
            />
            <Row label="检查策略" value={info.checkAutomatically ?? '—'} />
            {pending ? (
              <Row
                label="待生效更新"
                value={pending.updateId ? pending.updateId.slice(0, 8) : '已下载'}
                mono
              />
            ) : null}
            <Text style={styles.hint}>
              {info.enabled
                ? 'App 启动时会自动检查热更新；新版本在下次冷启动生效。只有 JS / 图片等资源能热更新，改原生代码必须重新打包。'
                : '当前是开发构建或 Expo Go，expo-updates 不会启用。安装 release APK 后才会检查热更新。'}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>更新</Text>
            <Text style={styles.hint}>
              点下面的按钮：先查有没有新版本，有就下载；下载完可以选择立即重启生效。
              发布端在 Expo 官方 EAS Update（expo.dev 的 @npcdyc/dsh-palm）。
            </Text>
            <View style={styles.actions}>
              <Btn
                label={buttonLabel}
                onPress={() => void checkAndUpdate()}
                disabled={busy !== null || !info.enabled}
                style={{ flex: 1 }}
              />
            </View>
            {note ? (
              <Pressable onPress={() => setNote(null)}>
                <Text style={[styles.note, info.enabled && { color: palette.text }]}>{note}</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.footnote}>
            只有 JS / 图片等资源能热更新，原生改动（Kotlin / 权限 / 原生依赖）需要重新打包 APK。
          </Text>
        </ScrollView>
      </SmoothKeyboardAvoid>
    </View>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.rowValueMono]} numberOfLines={2}>
        {value}
      </Text>
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
    status: { color: c.textFaint, fontSize: 11, fontWeight: '600' },
    scroll: { padding: space.lg, gap: 12, paddingBottom: space.xxl },
    card: {
      backgroundColor: c.glass,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: space.md,
      gap: space.sm,
    },
    cardTitle: { color: c.text, fontSize: 14, fontWeight: '600' },
    hint: { color: c.textDim, fontSize: 12, lineHeight: 17 },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    rowLabel: { color: c.textDim, fontSize: 12.5 },
    rowValue: { flex: 1, color: c.text, fontSize: 12.5, fontWeight: '500', textAlign: 'right' },
    rowValueMono: { fontSize: 11, fontFamily: 'monospace' },
    actions: { flexDirection: 'row', gap: space.sm, marginTop: 4 },
    note: { color: c.textDim, fontSize: 12, lineHeight: 17 },
    footnote: { color: c.textFaint, fontSize: 11.5, lineHeight: 17, paddingHorizontal: 2 },
  });
