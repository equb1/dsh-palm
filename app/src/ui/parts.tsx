import React from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { colors, font, radius, space } from './theme';

/* ------------------------------------------------------------------ */

export function Btn({
  label,
  onPress,
  kind = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger' | 'gold';
  disabled?: boolean;
  style?: ViewStyle;
}): React.ReactElement {
  const bg =
    kind === 'primary' ? colors.blue : kind === 'danger' ? colors.danger : kind === 'gold' ? colors.gold : 'transparent';
  const fg = kind === 'ghost' ? colors.dim : kind === 'gold' ? '#1A1408' : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
        kind === 'ghost' && { borderWidth: 1, borderColor: colors.line },
        style,
      ]}
    >
      <Text style={[styles.btnLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({
  label,
  color = colors.dim,
  bg,
}: {
  label: string;
  color?: string;
  bg?: string;
}): React.ReactElement {
  return (
    <View style={[styles.chip, { backgroundColor: bg ?? 'rgba(255,255,255,0.06)' }]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

export function Dot({ color }: { color: string }): React.ReactElement {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
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
  btn: {
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnLabel: { fontSize: 15, fontWeight: '600' },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  chipText: { fontSize: 11, fontWeight: '600' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: space.md,
  },
  mono: { fontFamily: font.mono, fontSize: 12, color: colors.dim },
});
