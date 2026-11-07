import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { AttachmentEngine, AttachmentKind } from '../lib/attachments/types';
import type { PermissionOption, Preset } from '../protocol';
import { AttachmentChips } from './AttachmentChips';
import { PickerSheet, BrandIcon, type BrandIconName } from './components';
import { radius, space, useTheme, useThemedStyles, type Theme } from './theme';

export interface ComposerAttachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  engine?: AttachmentEngine;
  /** 只保存路径、不解析内容（PDF/旧 Office/音视频/未知格式） */
  saveOnly?: boolean;
  hint?: string;
  status?: 'ready' | 'reading';
}

const KIND_ICON: Record<AttachmentKind, BrandIconName> = {
  image: 'image',
  document: 'fileText',
  file: 'folder',
  video: 'video',
  audio: 'audio',
};

const ATTACH_TYPES: Array<{ kind: AttachmentKind; label: string }> = [
  { kind: 'image', label: '图片' },
  { kind: 'document', label: '文档' },
  { kind: 'file', label: '文件' },
  { kind: 'video', label: '视频' },
  { kind: 'audio', label: '音频' },
];

const PERMISSION_META: Record<string, { label: string; icon: BrandIconName; desc: string }> = {
  'read-only': { label: '仅可查看', icon: 'eye', desc: '只能看，不能改' },
  'workspace-write': { label: '工作区内修改', icon: 'pen', desc: '只改当前工作区' },
  'danger-full-access': { label: '完全权限', icon: 'alert', desc: '任意读写，不再弹审批' },
  auto: { label: '自动', icon: 'refresh', desc: '由宿主决定' },
  custom: { label: '自定义', icon: 'sliders', desc: '自定义策略' },
};

function permissionMeta(option?: PermissionOption): { label: string; icon: BrandIconName; desc: string } {
  if (!option) return { label: '权限', icon: 'eye', desc: '' };
  return PERMISSION_META[option.value] ?? { label: option.name, icon: 'eye', desc: '' };
}

function presetIcon(presetId?: string): BrandIconName {
  if (!presetId) return 'sparkles';
  if (presetId === 'reader') return 'eye';
  if (presetId === 'light') return 'sparkles';
  if (presetId === 'standard') return 'layers';
  if (presetId === 'minimal') return 'zap';
  if (presetId === 'ptc') return 'cpu';
  if (presetId === 'cordis') return 'puzzle';
  return 'sparkles';
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
  attaching = false,
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
  /** 原生收件进行中（大文件复制时禁用发送） */
  attaching?: boolean;
  onAttach?: () => void;
  onPickAttachment?: (kind: AttachmentKind) => void;
  onRemoveAttachment?: (id: string) => void;
}): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const hasText = draft.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  const reading = attaching || attachments.some((a) => a.status === 'reading');
  const showStop = running && !hasText && !hasAttachments && canStop;
  const canSend = (hasText || hasAttachments) && !reading && (!running || canSteer);
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

  // chip 下面那行：只保存/不解析、超大文件、读取中，各说一句
  const hints = React.useMemo(() => {
    const out: string[] = [];
    for (const item of attachments) {
      if (item.hint && !out.includes(item.hint)) out.push(item.hint);
    }
    if (reading) out.push('正在读取附件…');
    return out;
  }, [attachments, reading]);

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
      {attachments.length > 0 || hints.length > 0 ? (
        <View style={styles.tray}>
          {attachments.length > 0 ? (
            <AttachmentChips
              items={attachments.map((a) => ({
                id: a.id,
                name: a.name,
                kind: a.kind,
                ...(a.engine ? { engine: a.engine } : {}),
              }))}
              {...(onRemoveAttachment ? { onRemove: onRemoveAttachment } : {})}
            />
          ) : null}
          {hints.length > 0 ? (
            <Text style={styles.attachHint} numberOfLines={3}>
              {hints.join('；')}
            </Text>
          ) : null}
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
                <BrandIcon name={KIND_ICON[item.kind]} size={16} color={palette.blue} />
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
              <BrandIcon
                name={permissionMeta(activePermissionOption).icon}
                size={13}
                color={palette.textDim}
              />
              <Text style={styles.barPillText}>{permissionMeta(activePermissionOption).label}</Text>
              <BrandIcon name="chevronDown" size={11} color={palette.textFaint} />
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
              <BrandIcon name={presetIcon(activePreset?.id)} size={13} color={palette.textDim} />
              <Text style={styles.barPillText} numberOfLines={1}>
                {activePreset?.name ?? '标准'}
              </Text>
              {presetsInteractive ? (
                <BrandIcon name="chevronDown" size={11} color={palette.textFaint} />
              ) : null}
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
          <BrandIcon
            name={plusOpen ? 'close' : 'plus'}
            size={18}
            color={palette.textDim}
            strokeWidth={2}
          />
        </Pressable>

        <TextInput
          style={[styles.input, { height: clampedHeight }]}
          value={draft}
          onChangeText={onChangeDraft}
          placeholder={placeholder}
          placeholderTextColor={palette.textFaint}
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
            showStop && { backgroundColor: palette.glassStrong },
            { opacity: showStop || canSend ? (pressed ? 0.75 : 1) : 0.3 },
          ]}
        >
          <BrandIcon
            name={showStop ? 'square' : 'arrowUp'}
            size={16}
            color={showStop ? palette.text : palette.bg}
            strokeWidth={2.4}
          />
        </Pressable>
      </View>

      <PickerSheet
        visible={presetMenuOpen}
        title="选择锦囊"
        options={presets.map((p) => ({
          id: p.id,
          label: p.name,
          glyph: p.glyph,
          icon: presetIcon(p.id),
        }))}
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
          icon: permissionMeta(p).icon,
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

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
  wrap: {
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: 6,
  },
  tray: { gap: 4 },
  attachHint: { color: c.textDim, fontSize: 11.5, lineHeight: 16, paddingHorizontal: 4 },
  plusPanel: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    backgroundColor: c.bg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderStrong,
    shadowColor: c.shadow,
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
    backgroundColor: c.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusIconText: { color: c.blue, fontSize: 13, fontWeight: '700' },
  plusLabel: { color: c.text, fontSize: 12 },
  bar: { flexDirection: 'row', gap: 6, paddingRight: space.sm },
  barPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 30,
    maxWidth: 160,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: c.glassStrong,
  },
  barPillGlyph: { color: c.textDim, fontSize: 11, fontWeight: '600' },
  barPillText: { color: c.text, fontSize: 12, flexShrink: 1 },
  barChevron: { color: c.textFaint, fontSize: 9 },
  box: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    backgroundColor: c.glass,
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: c.borderStrong,
    padding: 8,
    shadowColor: c.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  key: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBarH: {
    position: 'absolute',
    width: 15,
    height: 1.8,
    borderRadius: 1,
    backgroundColor: c.textDim,
  },
  plusBarV: {
    position: 'absolute',
    width: 1.8,
    height: 15,
    borderRadius: 1,
    backgroundColor: c.textDim,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingTop: 9,
    paddingBottom: 9,
    paddingHorizontal: 2,
    color: c.text,
    fontSize: 15,
    lineHeight: 23,
    includeFontPadding: false,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendGlyph: {
    color: c.bg,
    fontSize: 16,
    fontWeight: '700',
    includeFontPadding: false,
  },
  riskBackdrop: {
    flex: 1,
    backgroundColor: c.backdrop,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  riskCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: c.bg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderStrong,
    padding: 20,
    gap: 12,
  },
  riskTitle: { color: c.text, fontSize: 16, lineHeight: 24, fontWeight: '600' },
  riskText: { color: c.textDim, fontSize: 13, lineHeight: 20 },
  riskActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  riskCancel: { paddingHorizontal: 12, paddingVertical: 10 },
  riskCancelText: { color: c.textDim, fontSize: 13 },
  riskConfirm: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: c.dangerSoft,
  },
  riskConfirmText: { color: c.danger, fontSize: 13, fontWeight: '600' },
});
