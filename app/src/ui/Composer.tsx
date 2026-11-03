import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

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

const PERMISSION_META: Record<string, { label: string; glyph: string; desc: string }> = {
  'read-only': { label: '仅可查看', glyph: '◎', desc: '只能看，不能改' },
  'workspace-write': { label: '工作区内修改', glyph: '✎', desc: '只改当前工作区' },
  'danger-full-access': { label: '完全权限', glyph: '⚠', desc: '任意读写，不再弹审批' },
  auto: { label: '自动', glyph: '↻', desc: '由宿主决定' },
  custom: { label: '自定义', glyph: '⚙', desc: '自定义策略' },
};

function permissionMeta(option?: PermissionOption): { label: string; glyph: string; desc: string } {
  if (!option) return { label: '权限', glyph: '◎', desc: '' };
  return PERMISSION_META[option.value] ?? { label: option.name, glyph: '◎', desc: '' };
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
  presetsInteractive = true,
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
  /** 宿主不支持会话内换锦囊时，只显示当前锦囊，不给点 */
  presetsInteractive?: boolean;
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
  const [plusOpen, setPlusOpen] = React.useState(false);
  const [presetMenuOpen, setPresetMenuOpen] = React.useState(false);
  const [permissionMenuOpen, setPermissionMenuOpen] = React.useState(false);
  const [pendingPermission, setPendingPermission] = React.useState<string | null>(null);

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
    if (onPickAttachment) setPlusOpen((v) => !v);
    else if (onAttach) onAttach();
  };

  const choosePermission = (value: string): void => {
    setPermissionMenuOpen(false);
    if (value === 'danger-full-access' && activePermission !== value) {
      setPendingPermission(value);
      return;
    }
    onPickPermission?.(value);
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

      {plusOpen && onPickAttachment ? (
        <View style={styles.plusPanel}>
          {ATTACH_TYPES.map((item) => (
            <Pressable
              key={item.kind}
              accessibilityRole="button"
              accessibilityLabel={'添加' + item.label}
              onPress={() => {
                setPlusOpen(false);
                onPickAttachment(item.kind);
              }}
              style={({ pressed }) => [styles.plusItem, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.plusIcon}>
                <Text style={styles.plusIconText}>{KIND_BADGE[item.kind]}</Text>
              </View>
              <Text style={styles.plusLabel}>{item.label}</Text>
            </Pressable>
          ))}
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
              <Text style={styles.barPillText}>{permissionMeta(activePermissionOption).label}</Text>
              <Text style={styles.barChevron}>▾</Text>
            </Pressable>
          ) : null}

          {showPresets && presets.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`当前锦囊：${activePreset?.name ?? '标准'}`}
              onPress={presetsInteractive ? () => setPresetMenuOpen(true) : undefined}
              disabled={!presetsInteractive}
              style={({ pressed }) => [styles.barPill, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.barPillGlyph}>{activePreset?.glyph ?? '·'}</Text>
              <Text style={styles.barPillText} numberOfLines={1}>
                {activePreset?.name ?? '标准'}
              </Text>
              {presetsInteractive ? <Text style={styles.barChevron}>▾</Text> : null}
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
        options={permissions.map((p) => ({
          id: p.value,
          label: permissionMeta(p).label,
          glyph: permissionMeta(p).glyph,
        }))}
        activeId={activePermission}
        onSelect={choosePermission}
        onClose={() => setPermissionMenuOpen(false)}
      />

      <Modal
        visible={pendingPermission !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingPermission(null)}
      >
        <View style={styles.riskBackdrop}>
          <View style={styles.riskCard}>
            <Text style={styles.riskTitle}>完全权限</Text>
            <Text style={styles.riskText}>
              开启后 Agent 可以读写设备上的任意文件、执行命令，并且不再逐次弹审批。只在你信任当前任务时使用。
            </Text>
            <View style={styles.riskActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPendingPermission(null)}
                style={styles.riskCancel}
              >
                <Text style={styles.riskCancelText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  const value = pendingPermission;
                  setPendingPermission(null);
                  if (value) onPickPermission?.(value);
                }}
                style={styles.riskConfirm}
              >
                <Text style={styles.riskConfirmText}>我了解风险，继续</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  plusPanel: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    shadowColor: '#0F1115',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  plusItem: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 6, borderRadius: radius.sm },
  plusIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusIconText: { color: colors.blue, fontSize: 13, fontWeight: '700' },
  plusLabel: { color: colors.text, fontSize: 12 },
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
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    padding: 8,
    shadowColor: '#0F1115',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
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
  riskBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,17,21,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  riskCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    padding: 20,
    gap: 12,
  },
  riskTitle: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600' },
  riskText: { color: colors.textDim, fontSize: 13, lineHeight: 20 },
  riskActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  riskCancel: { paddingHorizontal: 12, paddingVertical: 10 },
  riskCancelText: { color: colors.textDim, fontSize: 13 },
  riskConfirm: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  riskConfirmText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
});
