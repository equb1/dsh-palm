import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { AttachmentEngine, AttachmentKind } from '../lib/attachments/types';
import { BrandIcon, type BrandIconName } from './components/BrandIcon';
import { radius, space, typography, useTheme, useThemedStyles, type Theme } from './theme';

export type { AttachmentEngine, AttachmentKind };

export interface AttachmentChip {
  id: string;
  name: string;
  kind: AttachmentKind;
  engine?: AttachmentEngine;
}

export interface AttachmentChipsProps {
  items: AttachmentChip[];
  onRemove?: (id: string) => void;
  onPress?: (id: string) => void;
}

const KIND_ICON: Record<AttachmentKind, BrandIconName> = {
  image: 'image',
  document: 'fileText',
  file: 'folder',
  video: 'video',
  audio: 'audio',
};
const ENGINE_LABEL: Record<AttachmentEngine, string> = { light: '轻', full: '完整' };

/**
 * 附件 chip 条：横向滚动，图片/文档一个样式；
 * engine 是收件分类算出来的「轻 / 完整」，1.3 起由 Composer 接 pendingAttachments。
 */
export function AttachmentChips({
  items,
  onRemove,
  onPress,
}: AttachmentChipsProps): React.ReactElement | null {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  if (items.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel="附件列表"
    >
      {items.map((item) => {
        const main = (
          <View style={styles.main}>
            <BrandIcon name={KIND_ICON[item.kind] ?? 'file'} size={14} color={palette.textDim} />
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            {item.engine ? (
              <View style={[styles.engine, item.engine === 'light' && styles.engineLight]}>
                <Text style={[styles.engineText, item.engine === 'light' && styles.engineTextLight]}>
                  {ENGINE_LABEL[item.engine]}
                </Text>
              </View>
            ) : null}
          </View>
        );

        return (
          <View key={item.id} style={styles.chip}>
            {onPress ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`附件 ${item.name}`}
                onPress={() => onPress(item.id)}
                style={({ pressed }) => [pressed && styles.pressed]}
              >
                {main}
              </Pressable>
            ) : (
              main
            )}
            {onRemove ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`移除 ${item.name}`}
                hitSlop={6}
                onPress={() => onRemove(item.id)}
                style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
              >
                <BrandIcon name="close" size={13} color={palette.textDim} strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const createStyles = ({ semantic: s }: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', gap: space.sm, paddingVertical: 2 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: s.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: s.border,
      borderRadius: radius.pill,
      paddingLeft: 10,
      paddingRight: 6,
      maxWidth: 240,
    },
    main: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
    glyph: { fontSize: 13 },
    name: { ...typography.caption, color: s.textPrimary, flexShrink: 1 },
    engine: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.pill,
      backgroundColor: s.cardStrong,
    },
    engineLight: { backgroundColor: s.accentSoft },
    engineText: { ...typography.micro, color: s.textSecondary },
    engineTextLight: { color: s.accent },
    remove: { paddingHorizontal: 4, paddingVertical: 2 },
    removeGlyph: { fontSize: 15, color: s.textTertiary },
    pressed: { opacity: 0.7 },
  });
