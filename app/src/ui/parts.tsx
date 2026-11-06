import React from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { font, radius, space, useTheme, useThemedStyles, type Theme } from './theme';

export { Card, Chip, IconButton } from './components';

/* ------------------------------------------------------------------ *
 * 胶囊：标题条、状态、模型选择
 * ------------------------------------------------------------------ */

export function Pill({
  children,
  onPress,
  style,
  tone = 'glass',
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  tone?: 'glass' | 'plain';
}): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  const body = (
    <View style={[styles.pill, tone === 'glass' && styles.pillGlass, style]}>{children}</View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [pressed && { opacity: 0.75 }]}
    >
      {body}
    </Pressable>
  );
}

export function Dot({ color, size = 6 }: { color: string; size?: number }): React.ReactElement {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/* ------------------------------------------------------------------ *
 * 按钮
 * ------------------------------------------------------------------ */

export function Btn({
  label,
  onPress,
  kind = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
}): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const bg =
    kind === 'primary' ? palette.blue : kind === 'danger' ? palette.dangerSoft : 'transparent';
  const fg =
    kind === 'primary' ? palette.onAccent : kind === 'danger' ? palette.danger : palette.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        kind === 'ghost' && {
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.borderStrong,
        },
        style,
      ]}
    >
      <Text style={[styles.btnLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Mono({ children, style }: { children: React.ReactNode; style?: TextStyle }): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  return <Text style={[styles.mono, style]}>{children}</Text>;
}

/* ------------------------------------------------------------------ */

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.pill,
    },
    pillGlass: { backgroundColor: c.glassStrong },
    btn: {
      height: 40,
      paddingHorizontal: space.lg,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnLabel: { fontSize: 14, lineHeight: 22, fontWeight: '500' },
    mono: { fontFamily: font.mono, fontSize: 11, lineHeight: 16, color: c.textDim },
  });
