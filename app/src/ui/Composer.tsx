import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Preset } from '../protocol';
import { colors, radius, space } from './theme';

/**
 * 输入区：上排是输入框和发送键，下排是一排预设胶囊。
 * 预设不做成弹层——豆包和 Gemini 都是「一排小胶囊」，扫一眼就能换。
 */
export function Composer({
  draft,
  onChangeDraft,
  onSend,
  onStop,
  running = false,
  placeholder,
  presets,
  activePresetId,
  onPickPreset,
}: {
  draft: string;
  onChangeDraft: (t: string) => void;
  onSend: () => void;
  onStop?: () => void;
  running?: boolean;
  placeholder: string;
  presets: Preset[];
  activePresetId: string | null;
  onPickPreset: (id: string) => void;
}): React.ReactElement {
  const hasText = draft.trim().length > 0;
  const showStop = running && !hasText;

  return (
    <View style={styles.wrap}>
      <View style={styles.box}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={onChangeDraft}
            placeholder={placeholder}
            placeholderTextColor={colors.textFaint}
            multiline
            numberOfLines={1}
            accessibilityLabel="输入框"
          />
          <Pressable
            onPress={showStop ? onStop : onSend}
            disabled={!showStop && !hasText}
            accessibilityRole="button"
            accessibilityLabel={showStop ? '停止' : '发送'}
            style={({ pressed }) => [
              styles.sendBtn,
              showStop && { backgroundColor: colors.glassStrong },
              { opacity: showStop || hasText ? (pressed ? 0.75 : 1) : 0.3 },
            ]}
          >
            <Text style={[styles.sendGlyph, showStop && { color: colors.text }]}>{showStop ? '■' : '↑'}</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          keyboardShouldPersistTaps="handled"
        >
          {presets.map((p) => {
            const active = p.id === activePresetId;
            return (
              <Pressable
                key={p.id}
                onPress={() => onPickPreset(p.id)}
                accessibilityRole="button"
                accessibilityLabel={p.name}
                style={({ pressed }) => [
                  styles.chip,
                  active && styles.chipActive,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {p.glyph} {p.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  box: {
    backgroundColor: colors.glass,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 26,
    maxHeight: 120,
    paddingVertical: 2,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendGlyph: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  chipRow: { gap: 6, paddingRight: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  chipActive: { backgroundColor: colors.blueSoft },
  chipText: { color: colors.textDim, fontSize: 11.5 },
  chipTextActive: { color: colors.blue, fontWeight: '600' },
});
