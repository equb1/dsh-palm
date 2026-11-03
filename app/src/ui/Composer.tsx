import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { AttachmentKind } from '../lib/pickImage';
import type { Preset } from '../protocol';
import { colors, radius, space } from './theme';

export interface ComposerAttachment {
  receiptId: string;
  name: string;
  kind?: AttachmentKind;
  uploading?: boolean;
}

const KIND_BADGE: Record<AttachmentKind, string> = {
  image: '图',
  video: '视',
  audio: '音',
  file: '件',
};

const ATTACH_TYPES: Array<{ kind: AttachmentKind; label: string; sub: string }> = [
  { kind: 'image', label: '图片', sub: '相册原图/截图' },
  { kind: 'file', label: '文件', sub: '文档/代码/压缩包' },
  { kind: 'video', label: '视频', sub: 'MP4/录屏短片' },
  { kind: 'audio', label: '音频', sub: '录音/MP3/语音' },
];

/**
 * 输入区：上排是附件预览/类型菜单，中排是左 `+` + 输入框 + 右发送键，下排是一排预设胶囊。
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
  onPickAttachment,
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
  attachments?: ComposerAttachment[];
  onAttach?: () => void;
  onPickAttachment?: (kind: AttachmentKind) => void;
  onRemoveAttachment?: (receiptId: string) => void;
}): React.ReactElement {
  const hasText = draft.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  const anyUploading = attachments.some((a) => a.uploading);
  const showStop = running && !hasText && !hasAttachments && canStop;
  const canSend = (hasText || hasAttachments) && !anyUploading && (!running || canSteer);
  const [contentHeight, setContentHeight] = React.useState(32);
  const [attachMenuOpen, setAttachMenuOpen] = React.useState(false);
  const [presetMenuOpen, setPresetMenuOpen] = React.useState(false);
  const activePreset = presets.find((p) => p.id === activePresetId) ?? presets[0];

  // 当内容被清空（发送后），高度自动重置为单行初始高度 32（与左右 32x32 按钮严格等高）
  React.useEffect(() => {
    if (!draft) {
      setContentHeight(32);
    }
  }, [draft]);

  const clampedHeight = Math.max(32, Math.min(120, contentHeight));
  const isSingleLine = clampedHeight <= 38;

  const handlePressPlus = () => {
    if (onPickAttachment) {
      setAttachMenuOpen((v) => !v);
    } else if (onAttach) {
      onAttach();
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.box}>
        {attachMenuOpen && onPickAttachment ? (
          <View style={styles.typeMenu}>
            {ATTACH_TYPES.map((item) => (
              <Pressable
                key={item.kind}
                accessibilityRole="button"
                accessibilityLabel={'添加' + item.label}
                onPress={() => {
                  setAttachMenuOpen(false);
                  onPickAttachment(item.kind);
                }}
                style={({ pressed }) => [styles.typeItem, pressed && { opacity: 0.7 }]}
              >
                <View style={styles.typeIconCircle}>
                  <Text style={styles.typeIconText}>{KIND_BADGE[item.kind]}</Text>
                </View>
                <View style={styles.typeTextCol}>
                  <Text style={styles.typeLabel}>{item.label}</Text>
                  <Text style={styles.typeSub} numberOfLines={1}>
                    {item.sub}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        {attachments.length > 0 ? (
          <View style={styles.attachRow}>
            {attachments.map((a) => {
              const badge = KIND_BADGE[a.kind ?? 'file'] ?? '件';
              return (
                <Pressable
                  key={a.receiptId}
                  accessibilityRole="button"
                  accessibilityLabel={'移除附件 ' + a.name}
                  onPress={() => onRemoveAttachment?.(a.receiptId)}
                  style={[styles.attachChip, a.uploading && { opacity: 0.65 }]}
                >
                  <View style={styles.attachBadge}>
                    <Text style={styles.attachBadgeText}>{badge}</Text>
                  </View>
                  <Text style={styles.attachChipText} numberOfLines={1}>
                    {a.name}
                    {a.uploading ? ' · 上传中…' : ''}
                  </Text>
                  <Text style={styles.attachChipClose}>×</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={[styles.inputRow, isSingleLine ? styles.inputRowCenter : styles.inputRowBottom]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="添加附件"
            onPress={handlePressPlus}
            style={({ pressed }) => [
              styles.attachBtn,
              attachMenuOpen && styles.attachBtnActive,
              pressed && { opacity: 0.65 },
            ]}
          >
            <View style={[styles.plusBarH, attachMenuOpen && styles.plusBarActive]} />
            <View style={[styles.plusBarV, attachMenuOpen && styles.plusBarActive]} />
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

        {showPresets && presets.length > 0 ? (
          <>
            <View style={styles.toolbar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`当前锦囊：${activePreset?.name ?? '标准'}`}
                onPress={() => setPresetMenuOpen(true)}
                style={({ pressed }) => [styles.presetBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.presetGlyph}>{activePreset?.glyph ?? '·'}</Text>
                <Text style={styles.presetName}>{activePreset?.name ?? '标准'}</Text>
                <Text style={styles.presetChevron}>▾</Text>
              </Pressable>
            </View>

            <Modal
              visible={presetMenuOpen}
              transparent
              animationType="fade"
              onRequestClose={() => setPresetMenuOpen(false)}
            >
              <Pressable style={styles.sheetBackdrop} onPress={() => setPresetMenuOpen(false)}>
                <Pressable style={styles.sheet} onPress={() => undefined}>
                  <Text style={styles.sheetTitle}>选择锦囊</Text>
                  {presets.map((p) => {
                    const active = p.id === activePresetId;
                    return (
                      <Pressable
                        key={p.id}
                        accessibilityRole="button"
                        accessibilityLabel={p.name}
                        onPress={() => {
                          onPickPreset(p.id);
                          setPresetMenuOpen(false);
                        }}
                        style={({ pressed }) => [
                          styles.sheetItem,
                          active && styles.sheetItemActive,
                          pressed && { opacity: 0.75 },
                        ]}
                      >
                        <Text style={styles.sheetGlyph}>{p.glyph}</Text>
                        <Text style={[styles.sheetName, active && styles.sheetNameActive]}>{p.name}</Text>
                        {active ? <Text style={styles.sheetCheck}>✓</Text> : null}
                      </Pressable>
                    );
                  })}
                </Pressable>
              </Pressable>
            </Modal>
          </>
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
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 8,
  },
  typeMenu: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 2,
    paddingTop: 2,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  typeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '48%',
    backgroundColor: colors.glassStrong,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  typeIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeIconText: {
    color: colors.blue,
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  typeTextCol: { flex: 1 },
  typeLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  typeSub: { color: colors.textFaint, fontSize: 10.5 },
  inputRow: { flexDirection: 'row', gap: 8 },
  inputRowCenter: { alignItems: 'center' },
  inputRowBottom: { alignItems: 'flex-end' },
  attachBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachBtnActive: {
    backgroundColor: colors.blueSoft,
  },
  plusBarH: {
    position: 'absolute',
    width: 14,
    height: 1.8,
    borderRadius: 1,
    backgroundColor: colors.textDim,
  },
  plusBarV: {
    position: 'absolute',
    width: 1.8,
    height: 14,
    borderRadius: 1,
    backgroundColor: colors.textDim,
  },
  plusBarActive: {
    backgroundColor: colors.blue,
  },
  input: {
    flex: 1,
    minHeight: 32,
    maxHeight: 120,
    paddingVertical: 4,
    paddingHorizontal: 2,
    color: colors.text,
    fontSize: 14,
    lineHeight: 22,
    includeFontPadding: false,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendGlyph: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: '700',
    includeFontPadding: false,
  },
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 2, paddingTop: 2 },
  attachChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    backgroundColor: colors.glassStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  attachBadge: {
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: colors.blueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachBadgeText: { color: colors.blue, fontSize: 10, fontWeight: '700', includeFontPadding: false },
  attachChipText: { color: colors.textDim, fontSize: 12, flexShrink: 1 },
  attachChipClose: { color: colors.textFaint, fontSize: 14, paddingLeft: 2 },
  toolbar: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  presetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.glassStrong,
  },
  presetGlyph: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  presetName: { color: colors.text, fontSize: 12, fontWeight: '500' },
  presetChevron: { color: colors.textFaint, fontSize: 10 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,17,21,0.28)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xl,
    gap: 4,
  },
  sheetTitle: { color: colors.textFaint, fontSize: 12, lineHeight: 18, marginBottom: 4 },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
  },
  sheetItemActive: { backgroundColor: colors.blueSoft },
  sheetGlyph: { color: colors.textDim, fontSize: 13, width: 18 },
  sheetName: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 22 },
  sheetNameActive: { color: colors.blue, fontWeight: '600' },
  sheetCheck: { color: colors.blue, fontSize: 14, fontWeight: '700' },
});
