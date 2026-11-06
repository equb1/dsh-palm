/**
 * 生成文件面板（P0 1.5）。
 *
 * 列出本会话工具生成的文件，可“打开”（系统查看器）或“分享”（原生 ACTION_SEND）。
 * 视觉沿用 `ModelSheet` 的底部弹层。
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { openWorkspaceFile, shareWorkspaceFile } from '../lib/fileActions';
import {
  generatedFileLabel,
  type GeneratedFile,
} from '../lib/generatedFiles';
import { Btn } from './parts';
import { radius, space, typography, useThemedStyles, type Theme } from './theme';

export interface GeneratedFilesSheetProps {
  visible: boolean;
  files: GeneratedFile[];
  onClose: () => void;
}

export function GeneratedFilesSheet({
  visible,
  files,
  onClose,
}: GeneratedFilesSheetProps): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  const [opening, setOpening] = React.useState<string | null>(null);
  const [sharing, setSharing] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (visible) return;
    setOpening(null);
    setSharing(null);
    setNotice(null);
  }, [visible]);

  const busy = opening !== null || sharing !== null;

  const open = async (file: GeneratedFile): Promise<void> => {
    if (busy) return;
    setOpening(file.relPath);
    setNotice(null);
    const result = await openWorkspaceFile(file.relPath, file.mime);
    setOpening(null);
    if (!result.ok) {
      setNotice(result.message ?? '打不开这个文件，稍后再试。');
      return;
    }
    setNotice(`已交给系统打开：${file.name}`);
  };

  const share = async (file: GeneratedFile): Promise<void> => {
    if (busy) return;
    setSharing(file.relPath);
    setNotice(null);
    const result = await shareWorkspaceFile(file.relPath, file.mime);
    setSharing(null);
    if (!result.ok) {
      setNotice(result.message ?? '分享失败，稍后再试。');
      return;
    }
    setNotice(`已打开系统分享面板：${file.name}`);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.head}>
            <Text style={styles.title}>生成文件</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭生成文件面板" onPress={onClose} style={styles.close}>
              <Text style={styles.closeText}>完成</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {files.length === 0 ? (
              <Text style={styles.empty}>
                这个会话还没有生成文件。让模型用 create_docx / create_xlsx / generate_image 生成一个试试。
              </Text>
            ) : (
              <>
                <Text style={styles.count}>共 {files.length} 个文件 · 可打开或分享</Text>
                {files.map((file) => {
                  const openingThis = opening === file.relPath;
                  const sharingThis = sharing === file.relPath;
                  return (
                    <View key={file.relPath} style={styles.row}>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{generatedFileLabel(file.kind)}</Text>
                      </View>
                      <View style={styles.meta}>
                        <Text style={styles.name} numberOfLines={1}>
                          {file.name}
                        </Text>
                        <Text style={styles.path} numberOfLines={1}>
                          /workspace/{file.relPath}
                        </Text>
                      </View>
                      <View style={styles.actions}>
                        <Btn
                          label={openingThis ? '打开中…' : '打开'}
                          kind="ghost"
                          disabled={busy}
                          onPress={() => void open(file)}
                          style={styles.openBtn}
                        />
                        <Btn
                          label={sharingThis ? '分享中…' : '分享'}
                          kind="ghost"
                          disabled={busy}
                          onPress={() => void share(file)}
                          style={styles.openBtn}
                        />
                      </View>
                    </View>
                  );
                })}
              </>
            )}
          </ScrollView>

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <Text style={styles.footer}>
            “打开”交给系统查看器；“分享”走系统分享面板（带临时读权限）。文件仍保存在工作区 /workspace 下。
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = ({ palette: c, semantic: s }: Theme) =>
  StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: c.backdrop, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    maxHeight: '76%',
    paddingBottom: 14,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { ...typography.heading, color: c.text },
  close: { paddingHorizontal: 8, paddingVertical: 4 },
  closeText: { color: c.blue, fontSize: 14 },
  list: { maxHeight: 520 },
  listContent: { paddingHorizontal: 12, paddingBottom: 8, gap: 4 },
  empty: { color: c.textFaint, fontSize: 13, lineHeight: 20, padding: 12 },
  count: { ...typography.meta, color: c.textFaint, paddingHorizontal: 8, paddingBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  badge: {
    minWidth: 46,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
    backgroundColor: s.accentSoft,
    alignItems: 'center',
  },
  badgeText: { color: c.blue, fontSize: 11, fontWeight: '600' },
  meta: { flex: 1, gap: 2 },
  name: { color: c.text, fontSize: 14, fontWeight: '500' },
  path: { color: c.textFaint, fontSize: 11 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  openBtn: { height: 34, paddingHorizontal: 8 },
  notice: { color: c.textDim, fontSize: 12, lineHeight: 18, paddingHorizontal: 18, paddingTop: 6 },
  footer: { color: c.textFaint, fontSize: 11, lineHeight: 16, paddingHorizontal: 18, paddingTop: 8 },
});
