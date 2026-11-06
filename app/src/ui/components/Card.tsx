import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space, useThemedStyles, type Theme } from '../theme';

export interface CardProps {
  children: React.ReactNode;
  /** 关掉内边距，用于铺满整卡的列表/图片 */
  padded?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** 玻璃卡片：圆角 + hairline 描边，层次靠叠加而不是阴影 */
export function Card({
  children,
  padded = true,
  onPress,
  accessibilityLabel,
  style,
}: CardProps): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  const body = <View style={[styles.card, padded && styles.padded, style]}>{children}</View>;
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.glass,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    padded: { padding: space.md },
    pressed: { opacity: 0.9 },
  });
