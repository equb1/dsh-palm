import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, space } from '../theme';

export interface PickerOption {
  id: string;
  label: string;
  glyph?: string;
}

export interface PickerSheetProps {
  visible: boolean;
  title: string;
  options: PickerOption[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** 底部选择器：Composer 的锦囊/权限共用，保持和 ModelSheet 一致的浅色弹层 */
export function PickerSheet({
  visible,
  title,
  options,
  activeId,
  onSelect,
  onClose,
}: PickerSheetProps): React.ReactElement {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.title}>{title}</Text>
          {options.map((option) => {
            const active = option.id === activeId;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                onPress={() => {
                  onSelect(option.id);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.item,
                  active && styles.itemActive,
                  pressed && { opacity: 0.75 },
                ]}
              >
                {option.glyph ? <Text style={styles.glyph}>{option.glyph}</Text> : null}
                <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                  {option.label}
                </Text>
                {active ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,17,21,0.28)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    gap: 4,
  },
  title: { color: colors.textFaint, fontSize: 12, lineHeight: 18, marginBottom: 4 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
  },
  itemActive: { backgroundColor: colors.blueSoft },
  glyph: { color: colors.textDim, fontSize: 13, width: 18 },
  label: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 22 },
  labelActive: { color: colors.blue, fontWeight: '600' },
  check: { color: colors.blue, fontSize: 14, fontWeight: '700' },
});
