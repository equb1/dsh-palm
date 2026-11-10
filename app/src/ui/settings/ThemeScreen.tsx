import React from 'react';
import {
  Clipboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { store, useStore } from '../useStore';
import { IconButton } from '../parts';
import { SmoothKeyboardAvoid } from '../SmoothKeyboardAvoid';
import { radius, space, topInset, useTheme, useThemedStyles, type Theme } from '../theme';
import { SettingsGroup, type SettingsRow } from './SettingsTile';
import type { ThemeMode } from '../theme/palette';

const OPTIONS: Array<{ id: ThemeMode; title: string; hint: string; icon: string; tone: SettingsRow['tone'] }> = [
  { id: 'system', title: '跟随系统', hint: '随手机深浅色设置自动无感切换', icon: '◐', tone: 'slate' },
  { id: 'light', title: '浅色 (极简白)', hint: '干净素雅的经典浅色界面', icon: '☀', tone: 'slate' },
  { id: 'dark', title: '深色 (极夜黑)', hint: 'OLED 纯黑沉浸感，低光环境护眼', icon: '☾', tone: 'slate' },
  { id: 'deepy', title: '深海蓝 (Deepy 专属)', hint: '湛蓝深海搭配天蓝伴侣荧光强调色', icon: '🐋', tone: 'blue' },
  { id: 'violet', title: '极光紫 (赛博梦境)', hint: '深邃暗夜与优雅柔和紫色', icon: '✦', tone: 'violet' },
  { id: 'emerald', title: '森系绿 (薄荷清爽)', hint: '自然墨绿与清新薄荷绿', icon: '☘', tone: 'green' },
];

export function ThemeScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const state = useStore();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [copied, setCopied] = React.useState(false);

  const rows: SettingsRow[] = OPTIONS.map((option) => ({
    id: option.id,
    title: option.title,
    hint: option.hint,
    icon: option.icon,
    tone: option.tone,
    selected: state.themeMode === option.id,
    onPress: () => store.setThemeMode(option.id),
  }));

  const themeJson = JSON.stringify(
    {
      theme: state.themeMode,
      bg: theme.palette.bg,
      bubble: theme.palette.bubble,
      blue: theme.palette.blue,
      text: theme.palette.text,
    },
    null,
    2,
  );

  const handleCopyJson = () => {
    Clipboard.setString(themeJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回设置" onPress={onClose} />
        <Text style={styles.title}>主题与外观</Text>
        <View style={{ width: 36 }} />
      </View>

      <SmoothKeyboardAvoid style={styles.body}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <SettingsGroup title="精选预设色盘" rows={rows} />

          {/* DSH 官方主题配置协议 */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>DSH 官方主题协议 (ui-theme)</Text>
              <Pressable onPress={handleCopyJson} style={styles.copyBtn}>
                <Text style={styles.copyBtnText}>
                  {copied ? '✓ 已复制 JSON' : '❐ 复制配色'}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.cardHint}>
              当前主题完全基于官方 DSH Design Tokens 映射。切换即时生效，无需重启 App，支持代码块语法高亮与组件联动。
            </Text>
            <View style={styles.jsonBox}>
              <Text style={styles.jsonText}>{themeJson}</Text>
            </View>
          </View>
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
    scroll: { padding: space.lg, gap: 14, paddingBottom: space.xxl },
    card: {
      backgroundColor: c.glass,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: space.md,
      gap: 8,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    cardTitle: {
      color: c.text,
      fontSize: 13.5,
      fontWeight: '600',
    },
    copyBtn: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: c.blueSoft,
    },
    copyBtnText: {
      color: c.blue,
      fontSize: 11,
      fontWeight: '600',
    },
    cardHint: {
      color: c.textDim,
      fontSize: 12,
      lineHeight: 18,
    },
    jsonBox: {
      backgroundColor: c.bgElevated,
      borderRadius: radius.sm,
      padding: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    jsonText: {
      fontFamily: 'monospace',
      fontSize: 11,
      color: c.textFaint,
      lineHeight: 16,
    },
  });
