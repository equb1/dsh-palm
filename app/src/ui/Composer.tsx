import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { AttachmentKind } from '../lib/pickImage';
import type { PermissionOption, Preset } from '../protocol';
import { PickerSheet } from './components';
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

const PERMISSION_SHORT: Record<string, string> = {
  'read-only': '只读',
  'workspace-write': '可写',
  'danger-full-access': '完全',
  auto: '自动',
  custom: '自定义',
};

function permissionShort(option?: PermissionOption): string {
  if (!option) return '权限';
  return PERMISSION_SHORT[option.value] ?? option.name;
}

/**
 * 输入区对齐官方 DSH：
 * 上排是输入框；下排是 `+`、工作权限、模型、锦囊 + 发送。
 * 附件预览/类型菜单始终在输入框上方。
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
  permissions = [],
  activePermission,
  onPickPermission,
  modelLabel = '模型',
  onOpenModel,
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
  /** 宿主不支持会话内换预设时，聊天页把锦囊收起来 */
  showPresets?: boolean;
  permissions?: PermissionOption[];
  activePermission?: string | null;
  onPickPermission?: (value: string) => void;
  modelLabel?: string;
  onOpenModel?: () => void;
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
  const [permissionMenuOpen, setPermissionMenuOpen] = React.useState(false);

  const activePreset = presets.find((p) => p.id === activePresetId) ?? presets[0];
  const activePermissionOption =
    permissions.find((p) => p.value === activePermission) ?? permissions[0];

  React.useEffect(() => {
    if (!draft) setContentHeight(32);
  }, [draft]);

  const clampedHeight = Math.max(32, Math.min(120, contentHeight));

  const handlePressPlus = () => {
    if (onPickAttachment) setAttachMenuOpen((v) => !v);
    else if (onAttach) onAttach();
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

        <View style={styles.toolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="添加附件"
            onPress={handlePressPlus}
            style={({ pressed }) => [
              styles.toolBtn,
              attachMenuOpen && styles.toolBtnActive,
              pressed && { opacity: 0.65 },
            ]}
          >
            <View style={[styles.plusBarH, attachMenuOpen && styles.plusBarActive]} />
            <View style={[styles.plusBarV, attachMenuOpen && styles.plusBarActive]} />
          </Pressable>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.toolScroll}
            contentContainerStyle={styles.toolScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {permissions.length > 0 && onPickPermission ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`工作权限：${activePermissionOption?.name ?? '默认'}`}
                onPress={() => setPermissionMenuOpen(true)}
                style={({ pressed }) => [styles.pill, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.pillText}>{permissionShort(activePermissionOption)}</Text>
                <Text style={styles.chevron}>▾</Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`模型：${modelLabel}`}
              onPress={onOpenModel}
              disabled={!onOpenModel}
              style={({ pressed }) => [styles.pill, styles.modelPill, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.pillText} numberOfLines={1}>
                {modelLabel}
              </Text>
              <Text style={styles.chevron}>▾</Text>
            </Pressable>

            {showPresets && presets.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`当前锦囊：${activePreset?.name ?? '标准'}`}
                onPress={() => setPresetMenuOpen(true)}
                style={({ pressed }) => [styles.pill, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.pillGlyph}>{activePreset?.glyph ?? '·'}</Text>
                <Text style={styles.pillText} numberOfLines={1}>
                  {activePreset?.name ?? '标准'}
                </Text>
                <Text style={styles.chevron}>▾</Text>
              </Pressable>
            ) : null}
          </ScrollView>

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
      </View>

      <PickerSheet
        visible={presetMenuOpen}
        title="选择锦囊"
        options={presets.map((p) => ({ id: p.id, label: p.name, glyph: p.glyph }))}
        activeId={activePresetId}
        onSelect={onPickPreset}
        onClose={() => setPresetMenuOpen(false)}
      />
      <PickerSheet
        visible={permissionMenuOpen}
        title="工作权限"
        options={permissions.map((p) => ({ id: p.value, label: p.name }))}
        activeId={activePermission}
        onSelect={(value) => onPickPermission?.(value)}
        onClose={() => setPermissionMenuOpen(false)}
      />
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
    gap: 6,
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
  input: {
    minHeight: 32,
    maxHeight: 120,
    paddingVertical: 4,
    paddingHorizontal: 2,
    color: colors.text,
    fontSize: 14,
    lineHeight: 22,
    includeFontPadding: false,
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolScroll: { flex: 1 },
  toolScrollContent: { gap: 6, paddingRight: 4 },
  toolBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBtnActive: { backgroundColor: colors.blueSoft },
  plusBarH: {
    position: 'absolute',
    width: 13,
    height: 1.8,
    borderRadius: 1,
    backgroundColor: colors.textDim,
  },
  plusBarV: {
    position: 'absolute',
    width: 1.8,
    height: 13,
    borderRadius: 1,
    backgroundColor: colors.textDim,
  },
  plusBarActive: { backgroundColor: colors.blue },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 28,
    maxWidth: 132,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.glassStrong,
  },
  modelPill: { maxWidth: 112 },
  pillGlyph: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  pillText: { color: colors.text, fontSize: 12, flexShrink: 1 },
  chevron: { color: colors.textFaint, fontSize: 9 },
  sendBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
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
});
