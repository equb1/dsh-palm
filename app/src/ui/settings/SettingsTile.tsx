import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { motion, radius, space, useTheme, useThemedStyles, type Palette, type Theme } from '../theme';

/**
 * 设置首页的分组行（U4）。
 *
 * 对齐 dsh-go 的设置 IA：一组一个色相、单行 52（带副标题 64）、
 * 32 圆盘图标、右侧永远显示当前值、行间不画线（2px 缝）。
 */
export type SettingsTone = 'blue' | 'green' | 'amber' | 'violet' | 'slate' | 'danger';

function tones(c: Palette): Record<SettingsTone, { bg: string; fg: string }> {
  return {
    blue: { bg: c.blueSoft, fg: c.blue },
    green: { bg: c.okSoft, fg: c.ok },
    amber: { bg: c.warnSoft, fg: c.warn },
    violet: { bg: c.violetSoft, fg: c.violet },
    slate: { bg: c.glassStrong, fg: c.textDim },
    danger: { bg: c.dangerSoft, fg: c.danger },
  };
}

export interface SettingsRow {
  id: string;
  title: string;
  value?: string;
  hint?: string;
  icon: string;
  tone?: SettingsTone;
  warn?: boolean;
  selected?: boolean;
  onPress: () => void;
}

export function SettingsGroup({
  title,
  rows,
}: {
  title: string;
  rows: SettingsRow[];
}): React.ReactElement | null {
  const styles = useThemedStyles(createStyles);
  if (rows.length === 0) return null;
  return (
    <View style={styles.groupWrap}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.group}>
        {rows.map((row) => (
          <SettingsTile key={row.id} row={row} />
        ))}
      </View>
    </View>
  );
}

export function SettingsTile({ row }: { row: SettingsRow }): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const tone = tones(palette)[row.tone ?? 'slate'];
  const scale = React.useRef(new Animated.Value(1)).current;
  const animate = (to: number): void => {
    Animated.timing(scale, {
      toValue: to,
      duration: motion.duration.fast,
      easing: motion.easing.standard,
      useNativeDriver: true,
    }).start();
  };
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.title}${row.value ? `，${row.value}` : ''}`}
        onPress={row.onPress}
        onPressIn={() => animate(0.98)}
        onPressOut={() => animate(1)}
        style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      >
        <View style={[styles.icon, { backgroundColor: tone.bg }]}>
          <Text style={[styles.iconGlyph, { color: tone.fg }]}>{row.icon}</Text>
        </View>
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>
            {row.title}
          </Text>
          {row.hint ? (
            <Text style={styles.hint} numberOfLines={1}>
              {row.hint}
            </Text>
          ) : null}
        </View>
        {row.value ? (
          <Text style={[styles.value, row.warn && { color: palette.warn }]} numberOfLines={1}>
            {row.value}
          </Text>
        ) : null}
        {row.selected ? <Text style={styles.check}>✓</Text> : <Text style={styles.chevron}>›</Text>}
      </Pressable>
    </Animated.View>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    groupWrap: { gap: 6 },
    groupTitle: {
      color: c.textFaint,
      fontSize: 12,
      fontWeight: '600',
      paddingHorizontal: space.xs,
      letterSpacing: 0.2,
    },
    group: {
      backgroundColor: c.glass,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 4,
      gap: 2,
    },
    tile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 52,
      paddingVertical: 10,
      borderRadius: radius.md,
    },
    pressed: { backgroundColor: c.glassStrong },
    icon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconGlyph: { fontSize: 15, fontWeight: '600' },
    titles: { flex: 1, gap: 1 },
    title: { color: c.text, fontSize: 15 },
    hint: { color: c.textFaint, fontSize: 11.5 },
    value: { color: c.textFaint, fontSize: 12.5, maxWidth: '48%' },
    chevron: { color: c.textFaint, fontSize: 16 },
    check: { color: c.blue, fontSize: 16, fontWeight: '700' },
  });
