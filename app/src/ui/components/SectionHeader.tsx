import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { space, typography, useThemedStyles, type Theme } from '../theme';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** 分组标题：左标题/副标题，右可选操作（数量、筛选、更多） */
export function SectionHeader({
  title,
  subtitle,
  right,
  style,
}: SectionHeaderProps): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.row, style]}>
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: space.sm,
    },
    texts: { flex: 1, gap: 1 },
    title: { ...typography.subheading, color: c.text },
    subtitle: { ...typography.caption, color: c.textDim },
    right: { marginLeft: space.sm },
  });
