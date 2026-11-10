import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
 * 软件更新：显示当前 OTA 状态，并提供手动检查 / 下载 / 重启。
 *
 * release 包启动时 expo-updates 会自动检查（ON_LOAD），这里主要用于：
 *  - 确认当前跑的是内置包还是热更新；
 *  - 连不上服务器时手动重试；
 *  - 开发/调试时验证更新服务器。
 */
export function UpdateScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [info, setInfo] = React.useState(() => updateRuntimeInfo());
  const [busy, setBusy] = React.useState<'check' | 'download' | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const refresh = (): void => setInfo(updateRuntimeInfo());

  const check = async (): Promise<void> => {
    if (busy) return;
    setBusy('check');
    setNote('正在检查更新…');
    try {
      const result = await checkForUpdate();
      setNote(
        result.available
          ? `发现新版本${result.createdAt ? `（${new Date(result.createdAt).toLocaleString()}）` : ''}，可以下载。`
          : '已经是最新版本。',
      );
    } catch (error) {
      setNote(updateFailureMessage(error));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const updateNow = async (): Promise<void> => {
    if (busy) return;
    setBusy('download');
    setNote('正在检查并下载更新…');
    try {
      const result = await downloadUpdate();
      if (result.rolledBack) {
        setNote('服务器要求回滚到内置版本，正在重启…');
      } else if (!result.downloaded) {
        setNote('已经是最新版本，无需下载。');
        setBusy(null);
        refresh();
        return;
      } else {
        setNote('更新已下载，正在重启应用…');
      }
      await reloadWithUpdate();
    } catch (error) {
      setNote(updateFailureMessage(error));
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

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回设置" onPress={onClose} />
        <Text style={styles.title}>软件更新</Text>
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
            <Text style={styles.hint}>
              {info.enabled
                ? 'App 启动时会自动检查热更新；新版本在下次冷启动生效。只有 JS / 图片等资源能热更新，改原生代码必须重新打包。'
                : '当前是开发构建或 Expo Go，expo-updates 不会启用。安装 release APK 后才会检查热更新。'}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>更新操作</Text>
            <Text style={styles.hint}>
              手机有网即可检查更新；电脑上发布新版本用
              「npx eas-cli update --branch production --platform android --environment production」。
              更新地址已写入安装包。
            </Text>
            <View style={styles.actions}>
              <Btn
                label={busy === 'check' ? '检查中…' : '检查更新'}
                kind="ghost"
                onPress={() => void check()}
                disabled={busy !== null || !info.enabled}
                style={{ flex: 1 }}
              />
              <Btn
                label={busy === 'download' ? '下载中…' : '下载并重启'}
                onPress={() => void updateNow()}
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
            使用 Expo 官方 EAS Update；发布记录在 expo.dev 的 @npcdyc/dsh-palm 项目里。
            只有 JS / 图片等资源能热更新，原生改动需要重新打包。
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
