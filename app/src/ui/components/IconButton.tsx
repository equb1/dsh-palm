import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useThemedStyles, type Theme } from '../theme';

export interface IconButtonProps {
  glyph: string;
  onPress: () => void;
  label: string;
  size?: number;
  tone?: 'default' | 'accent';
  disabled?: boolean;
}

/** 圆形图标按钮：头部返回/菜单/新建都用它；glyph 是文字符号，不引图标库 */
export function IconButton({
  glyph,
  onPress,
  label,
  size = 36,
  tone = 'default',
  disabled = false,
}: IconButtonProps): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size, borderRadius: size / 2 },
        tone === 'accent' && styles.accent,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.glyph, tone === 'accent' && styles.glyphAccent]}>{glyph}</Text>
    </Pressable>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    button: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    accent: { backgroundColor: c.blueSoft },
    pressed: { backgroundColor: c.pressedOverlay },
    disabled: { opacity: 0.4 },
    glyph: { color: c.textDim, fontSize: 16 },
    glyphAccent: { color: c.blue },
  });
