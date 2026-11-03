import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { semantic, space, typography } from '../theme';

export interface EmptyStateProps {
  glyph?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** 空状态：一个符号 + 一句人话 + 可选操作，别只甩「暂无数据」 */
export function EmptyState({
  glyph,
  title,
  description,
  action,
  style,
}: EmptyStateProps): React.ReactElement {
  return (
    <View style={[styles.root, style]}>
      {glyph ? <Text style={styles.glyph}>{glyph}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
    gap: space.xs,
  },
  glyph: { fontSize: 28, color: semantic.textTertiary, marginBottom: space.xs },
  title: { ...typography.heading, color: semantic.textPrimary, textAlign: 'center' },
  description: {
    ...typography.bodySmall,
    color: semantic.textSecondary,
    textAlign: 'center',
    maxWidth: 300,
  },
  action: { marginTop: space.md },
});
