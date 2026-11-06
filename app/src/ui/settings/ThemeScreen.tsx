import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { store, useStore } from '../useStore';
import { IconButton } from '../parts';
import { SmoothKeyboardAvoid } from '../SmoothKeyboardAvoid';
import { radius, space, topInset, useThemedStyles, type Theme } from '../theme';
import { SettingsGroup, type SettingsRow } from './SettingsTile';
import type { ThemeMode } from '../theme/palette';

const OPTIONS: Array<{ id: ThemeMode; title: string; hint: string; icon: string }> = [
  { id: 'system', title: '跟随系统', hint: '手机切深色时自动跟随', icon: '◐' },
  { id: 'light', title: '浅色', hint: '始终使用浅色界面', icon: '☀' },
  { id: 'dark', title: '深色', hint: '始终使用深色界面', icon: '☾' },
];

export function ThemeScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const state = useStore();
  const styles = useThemedStyles(createStyles);
  const rows: SettingsRow[] = OPTIONS.map((option) => ({
    id: option.id,
    title: option.title,
    hint: option.hint,
    icon: option.icon,
    tone: 'violet',
    selected: state.themeMode === option.id,
    onPress: () => store.setThemeMode(option.id),
  }));

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回设置" onPress={onClose} />
        <Text style={styles.title}>主题</Text>
        <View style={{ width: 36 }} />
      </View>

      <SmoothKeyboardAvoid style={styles.body}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <SettingsGroup title="外观" rows={rows} />
          <View style={styles.note}>
            <Text style={styles.noteText}>
              跟随系统会随手机的深色模式自动切换；手动选择浅色或深色会覆盖系统设置。
            </Text>
            <Text style={styles.noteText}>
              切换即时生效，不需要重启 App；代码块、审批卡和错误横幅也会一起变色。
            </Text>
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
    scroll: { padding: space.lg, gap: 12, paddingBottom: space.xxl },
    note: {
      backgroundColor: c.glass,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: space.md,
      gap: space.sm,
    },
    noteText: { color: c.textDim, fontSize: 12, lineHeight: 18 },
  });
