import React from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { colors, font, radius, space } from './theme';

/* ------------------------------------------------------------------ *
 * 圆形图标按钮：头部的 ☰ / ✎ / ⋯ 都用它
 * ------------------------------------------------------------------ */

export function IconButton({
  glyph,
  onPress,
  label,
  size = 36,
  tone = 'default',
}: {
  glyph: string;
  onPress: () => void;
  label: string;
  size?: number;
  tone?: 'default' | 'accent';
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconBtn,
        { width: size, height: size, borderRadius: size / 2 },
        tone === 'accent' && { backgroundColor: colors.blueSoft },
        pressed && { backgroundColor: colors.glassPressed },
      ]}
    >
      <Text style={[styles.iconGlyph, tone === 'accent' && { color: colors.blue }]}>{glyph}</Text>
    </Pressable>
  );
}

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

export function Chip({
  label,
  color = colors.textDim,
  bg = colors.glass,
}: {
  label: string;
  color?: string;
  bg?: string;
}): React.ReactElement {
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
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
  const bg =
    kind === 'primary' ? colors.blue : kind === 'danger' ? colors.dangerSoft : 'rgba(255,255,255,0.04)';
  const fg = kind === 'primary' ? '#FFFFFF' : kind === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        kind === 'ghost' && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
        style,
      ]}
    >
      <Text style={[styles.btnLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}): React.ReactElement {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Mono({ children, style }: { children: React.ReactNode; style?: TextStyle }): React.ReactElement {
  return <Text style={[styles.mono, style]}>{children}</Text>;
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  iconBtn: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glass },
  iconGlyph: { color: colors.textDim, fontSize: 16 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  pillGlass: { backgroundColor: colors.glass },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  chipText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
  btn: {
    height: 42,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnLabel: { fontSize: 15, fontWeight: '600' },
  card: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
  },
  mono: { fontFamily: font.mono, fontSize: 12, color: colors.textDim },
});
