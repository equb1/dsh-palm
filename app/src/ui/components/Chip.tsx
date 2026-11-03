import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, semantic, typography } from '../theme';

export interface ChipProps {
  label: string;
  color?: string;
  bg?: string;
  /** 选中态：默认改成蓝色语义色 */
  active?: boolean;
  size?: 'sm' | 'md';
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** 胶囊标签：状态、筛选、元信息；可点时才包 Pressable */
export function Chip({
  label,
  color,
  bg,
  active = false,
  size = 'sm',
  onPress,
  style,
}: ChipProps): React.ReactElement {
  const fg = color ?? (active ? semantic.accent : semantic.textSecondary);
  const background = bg ?? (active ? semantic.accentSoft : semantic.card);
  const body = (
    <View style={[styles.chip, size === 'md' && styles.chipMd, { backgroundColor: background }, style]}>
      <Text style={[styles.text, size === 'md' && styles.textMd, { color: fg }]}>{label}</Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  chipMd: { paddingHorizontal: 12, paddingVertical: 5 },
  text: { fontSize: typography.meta.fontSize, fontWeight: '600', letterSpacing: 0.2 },
  textMd: { fontSize: typography.caption.fontSize },
  pressed: { opacity: 0.75 },
});
