import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { radius, semantic, space, typography } from './theme';

export type AttachmentKind = 'image' | 'file';
export type AttachmentEngine = 'light' | 'full';

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

const KIND_GLYPH: Record<AttachmentKind, string> = { image: '🖼', file: '📄' };
const ENGINE_LABEL: Record<AttachmentEngine, string> = { light: '轻', full: '完整' };

/**
 * 附件 chip 条：横向滚动，图片/文件一个样式；
 * engine 标记走轻/完整两套引擎时再接，1.3 之前只做展示。
 */
export function AttachmentChips({
  items,
  onRemove,
  onPress,
}: AttachmentChipsProps): React.ReactElement | null {
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
            <Text style={styles.glyph}>{KIND_GLYPH[item.kind]}</Text>
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
                <Text style={styles.removeGlyph}>×</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, paddingVertical: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: semantic.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: semantic.border,
    borderRadius: radius.pill,
    paddingLeft: 10,
    paddingRight: 6,
    maxWidth: 240,
  },
  main: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  glyph: { fontSize: 13 },
  name: { ...typography.caption, color: semantic.textPrimary, flexShrink: 1 },
  engine: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: semantic.cardStrong,
  },
  engineLight: { backgroundColor: semantic.accentSoft },
  engineText: { ...typography.micro, color: semantic.textSecondary },
  engineTextLight: { color: semantic.accent },
  remove: { paddingHorizontal: 4, paddingVertical: 2 },
  removeGlyph: { fontSize: 15, color: semantic.textTertiary },
  pressed: { opacity: 0.7 },
});
