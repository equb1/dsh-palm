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

const ATTACH_TYPES: Array<{ kind: AttachmentKind; label: string }> = [
  { kind: 'image', label: '图片' },
  { kind: 'file', label: '文件' },
  { kind: 'video', label: '视频' },
  { kind: 'audio', label: '音频' },
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
 * 输入区按 dsh-go 的几何：单行 56 高、28 圆角，左右各一颗 40 圆键（+ / 发送），
 * 1–6 行自增高。权限和锦囊在 Composer 上方一条，模型在顶栏，不再塞进输入框。
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
  showPresets?: boolean;
  permissions?: PermissionOption[];
  activePermission?: string | null;
  onPickPermission?: (value: string) => void;
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
  const [contentHeight, setContentHeight] = React.useState(40);
  const [attachSheetOpen, setAttachSheetOpen] = React.useState(false);
  const [presetMenuOpen, setPresetMenuOpen] = React.useState(false);
  const [permissionMenuOpen, setPermissionMenuOpen] = React.useState(false);

  const activePreset = presets.find((p) => p.id === activePresetId) ?? presets[0];
  const activePermissionOption =
    permissions.find((p) => p.value === activePermission) ?? permissions[0];

  React.useEffect(() => {
    if (!draft) setContentHeight(40);
  }, [draft]);

  const clampedHeight = Math.max(40, Math.min(120, contentHeight));
  const showBar =
    (permissions.length > 0 && Boolean(onPickPermission)) || (showPresets && presets.length > 0);

  const handlePlus = () => {
    if (onPickAttachment) setAttachSheetOpen(true);
    else if (onAttach) onAttach();
  };

  return (
    <View style={styles.wrap}>
      {attachments.length > 0 ? (
        <View style={styles.tray}>
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

      {showBar ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.bar}
          keyboardShouldPersistTaps="handled"
        >
          {permissions.length > 0 && onPickPermission ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`工作权限：${activePermissionOption?.name ?? '默认'}`}
              onPress={() => setPermissionMenuOpen(true)}
              style={({ pressed }) => [styles.barPill, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.barPillText}>{permissionShort(activePermissionOption)}</Text>
              <Text style={styles.barChevron}>▾</Text>
            </Pressable>
          ) : null}

          {showPresets && presets.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`当前锦囊：${activePreset?.name ?? '标准'}`}
              onPress={() => setPresetMenuOpen(true)}
              style={({ pressed }) => [styles.barPill, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.barPillGlyph}>{activePreset?.glyph ?? '·'}</Text>
              <Text style={styles.barPillText} numberOfLines={1}>
                {activePreset?.name ?? '标准'}
              </Text>
              <Text style={styles.barChevron}>▾</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}

      <View style={styles.box}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="添加附件"
          onPress={handlePlus}
          disabled={!onPickAttachment && !onAttach}
          style={({ pressed }) => [styles.key, pressed && { opacity: 0.65 }]}
        >
          <View style={styles.plusBarH} />
          <View style={styles.plusBarV} />
        </Pressable>

        <TextInput
          style={[styles.input, { height: clampedHeight }]}
          value={draft}
          onChangeText={onChangeDraft}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          multiline
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
            styles.send,
            showStop && { backgroundColor: colors.glassStrong },
            { opacity: showStop || canSend ? (pressed ? 0.75 : 1) : 0.3 },
          ]}
        >
          <Text style={[styles.sendGlyph, showStop && { color: colors.text }]}>{showStop ? '■' : '↑'}</Text>
        </Pressable>
      </View>

      <PickerSheet
        visible={attachSheetOpen}
        title="添加附件"
        options={ATTACH_TYPES.map((t) => ({ id: t.kind, label: t.label, glyph: KIND_BADGE[t.kind] }))}
        onSelect={(id) => onPickAttachment?.(id as AttachmentKind)}
        onClose={() => setAttachSheetOpen(false)}
      />
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
    gap: 6,
  },
  tray: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
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
  bar: { flexDirection: 'row', gap: 6, paddingRight: space.sm },
  barPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 30,
    maxWidth: 160,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.glassStrong,
  },
  barPillGlyph: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  barPillText: { color: colors.text, fontSize: 12, flexShrink: 1 },
  barChevron: { color: colors.textFaint, fontSize: 9 },
  box: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    backgroundColor: colors.glass,
    borderRadius: radius.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 8,
  },
  key: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBarH: {
    position: 'absolute',
    width: 15,
    height: 1.8,
    borderRadius: 1,
    backgroundColor: colors.textDim,
  },
  plusBarV: {
    position: 'absolute',
    width: 1.8,
    height: 15,
    borderRadius: 1,
    backgroundColor: colors.textDim,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingTop: 9,
    paddingBottom: 9,
    paddingHorizontal: 2,
    color: colors.text,
    fontSize: 15,
    lineHeight: 23,
    includeFontPadding: false,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendGlyph: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '700',
    includeFontPadding: false,
  },
});
