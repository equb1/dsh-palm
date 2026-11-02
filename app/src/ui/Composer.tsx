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
  showPresets = true,
  canStop = true,
  canSteer = true,
  attachments = [],
  onAttach,
  onRemoveAttachment,
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
  /** 宿主不支持会话内换预设时，聊天页把这一排收起来 */
  showPresets?: boolean;
  /** 宿主能力：能不能停、能不能插话 */
  canStop?: boolean;
  canSteer?: boolean;
  attachments?: Array<{ receiptId: string; name: string }>;
  onAttach?: () => void;
  onRemoveAttachment?: (receiptId: string) => void;
}): React.ReactElement {
  const hasText = draft.trim().length > 0;
  const showStop = running && !hasText && canStop;
  const canSend = hasText && (!running || canSteer);
  const [contentHeight, setContentHeight] = React.useState(26);

  // 当内容被清空（发送后），高度自动重置为单行初始高度
  React.useEffect(() => {
    if (!draft) {
      setContentHeight(26);
    }
  }, [draft]);

  const clampedHeight = Math.max(26, Math.min(120, contentHeight));

  return (
    <View style={styles.wrap}>
      <View style={styles.box}>
        {attachments.length > 0 ? (
          <View style={styles.attachRow}>
            {attachments.map((a) => (
              <Pressable
                key={a.receiptId}
                accessibilityRole="button"
                accessibilityLabel={'移除附件 ' + a.name}
                onPress={() => onRemoveAttachment?.(a.receiptId)}
                style={styles.attachChip}
              >
                <Text style={styles.attachChipText} numberOfLines={1}>
                  {a.name}
                </Text>
                <Text style={styles.attachChipClose}>×</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.inputRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="添加附件"
            onPress={onAttach}
            style={({ pressed }) => [styles.attachBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.attachGlyph}>＋</Text>
          </Pressable>
          <TextInput
            style={[styles.input, { height: clampedHeight }]}
            value={draft}
            onChangeText={onChangeDraft}
            placeholder={placeholder}
            placeholderTextColor={colors.textFaint}
            multiline
            textAlignVertical="center"
            scrollEnabled={contentHeight >= 120}
            onContentSizeChange={(e) => {
              const h = e.nativeEvent.contentSize.height;
              if (h > 0) setContentHeight(h);
            }}
            accessibilityLabel="输入框"
          />
          <Pressable
            onPress={showStop ? onStop : onSend}
            disabled={!showStop && !canSend}
            accessibilityRole="button"
            accessibilityLabel={showStop ? '停止' : '发送'}
            style={({ pressed }) => [
              styles.sendBtn,
              showStop && { backgroundColor: colors.glassStrong },
              { opacity: showStop || canSend ? (pressed ? 0.75 : 1) : 0.3 },
            ]}
          >
            <Text style={[styles.sendGlyph, showStop && { color: colors.text }]}>{showStop ? '■' : '↑'}</Text>
          </Pressable>
        </View>

        {showPresets ? (
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
        ) : null}
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
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 10, paddingTop: 8 },
  attachChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 200,
    backgroundColor: colors.glassStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  attachChipText: { color: colors.textDim, fontSize: 12 },
  attachChipClose: { color: colors.textFaint, fontSize: 13 },
  attachBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  attachGlyph: { color: colors.textDim, fontSize: 16, fontWeight: '600' },  sendGlyph: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
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
