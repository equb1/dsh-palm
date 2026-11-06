import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, typography, useTheme, useThemedStyles, type Theme } from './theme';
import { BrandIcon } from './components/BrandIcon';

export type EngineKind = 'light' | 'remote';

export interface EngineBadgeProps {
  kind: EngineKind | null;
  label?: string;
  onPress?: () => void;
}

const DEFAULT_LABEL: Record<EngineKind, string> = { light: '轻引擎', remote: '完整引擎' };

/**
 * 引擎角标：顶栏显示当前跑在哪套引擎上。
 * 按 A4 约定先只做组件，不接线；1.2 EngineManager 落地后再传入实际状态。
 */
export function EngineBadge({ kind, label, onPress }: EngineBadgeProps): React.ReactElement | null {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  if (!kind) return null;
  const text = label ?? DEFAULT_LABEL[kind];
  const fg = kind === 'light' ? palette.blue : palette.textDim;
  const bg = kind === 'light' ? palette.blueSoft : palette.glass;

  const body = (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <BrandIcon name={kind === 'light' ? 'zap' : 'box'} size={12} color={fg} strokeWidth={1.9} />
      <Text style={[styles.text, { color: fg }]}>{text}</Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`引擎：${text}`}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const createStyles = (_theme: Theme) =>
  StyleSheet.create({
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.pill,
      alignSelf: 'flex-start',
    },
    dot: { width: 6, height: 6, borderRadius: 3 },
    text: { ...typography.meta, fontWeight: '600' },
    pressed: { opacity: 0.75 },
  });
