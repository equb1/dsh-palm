import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { BrandIcon, type BrandIconName } from './BrandIcon';
import { useTheme, useThemedStyles, type Theme } from '../theme';

export interface IconButtonProps {
  /** 兼容旧调用；新调用优先传 icon */
  glyph?: string;
  icon?: BrandIconName;
  onPress: () => void;
  label: string;
  size?: number;
  tone?: 'default' | 'accent';
  disabled?: boolean;
}

/** 圆形图标按钮：统一走 BrandIcon，不再用系统符号字体 */
export function IconButton({
  glyph,
  icon,
  onPress,
  label,
  size = 36,
  tone = 'default',
  disabled = false,
}: IconButtonProps): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const color = tone === 'accent' ? palette.blue : palette.textDim;
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
      {icon ? (
        <BrandIcon name={icon} size={Math.round(size * 0.5)} color={color} />
      ) : (
        <Text style={[styles.glyph, tone === 'accent' && styles.glyphAccent]}>{glyph}</Text>
      )}
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
