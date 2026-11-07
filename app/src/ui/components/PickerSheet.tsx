import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, space, useTheme, useThemedStyles, type Theme } from '../theme';
import { BrandIcon, type BrandIconName } from './BrandIcon';

export interface PickerOption {
  id: string;
  label: string;
  glyph?: string;
  icon?: BrandIconName;
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
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
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
                {option.icon ? (
                  <BrandIcon
                    name={option.icon}
                    size={17}
                    color={active ? palette.blue : palette.textDim}
                    strokeWidth={1.8}
                  />
                ) : option.glyph ? (
                  <Text style={styles.glyph}>{option.glyph}</Text>
                ) : null}
                <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                  {option.label}
                </Text>
                {active ? <BrandIcon name="check" size={16} color={palette.blue} strokeWidth={2.2} /> : null}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: c.backdrop, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: c.bg,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: space.lg,
      paddingTop: space.md,
      paddingBottom: space.xxl,
      gap: 4,
    },
    title: { color: c.textFaint, fontSize: 12, lineHeight: 18, marginBottom: 4 },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderRadius: radius.sm,
    },
    itemActive: { backgroundColor: c.blueSoft },
    glyph: { color: c.textDim, fontSize: 13, width: 18 },
    label: { flex: 1, color: c.text, fontSize: 14, lineHeight: 22 },
    labelActive: { color: c.blue, fontWeight: '600' },
    check: { color: c.blue, fontSize: 14, fontWeight: '700' },
  });
