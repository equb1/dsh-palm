/**
 * 生成文件面板（P0 1.5，open-only MVP）。
 *
 * 只做“看这个会话生成了什么 + 用系统查看器打开”：分享暂缓（RN Share 只支持
 * 文本/URL，分享二进制要 expo-sharing 或原生 FileProvider）。
 * 视觉沿用 `ModelSheet` 的底部弹层。
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { openWorkspaceFile } from '../lib/fileActions';
import {
  generatedFileLabel,
  type GeneratedFile,
} from '../lib/generatedFiles';
import { Btn } from './parts';
import { colors, radius, semantic, space, typography } from './theme';

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
  const [opening, setOpening] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (visible) return;
    setOpening(null);
    setNotice(null);
  }, [visible]);

  const open = async (file: GeneratedFile): Promise<void> => {
    if (opening) return;
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
                <Text style={styles.count}>共 {files.length} 个文件 · 点击“打开”交给系统查看器</Text>
                {files.map((file) => {
                  const busy = opening === file.relPath;
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
                      <Btn
                        label={busy ? '打开中…' : '打开'}
                        kind="ghost"
                        disabled={opening !== null}
                        onPress={() => void open(file)}
                        style={styles.openBtn}
                      />
                    </View>
                  );
                })}
              </>
            )}
          </ScrollView>

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <Text style={styles.footer}>
            只读打开；分享暂未接入（等原生分享能力）。文件仍保存在工作区 /workspace 下。
          </Text>
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
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
  title: { ...typography.heading, color: colors.text },
  close: { paddingHorizontal: 8, paddingVertical: 4 },
  closeText: { color: colors.blue, fontSize: 14 },
  list: { maxHeight: 520 },
  listContent: { paddingHorizontal: 12, paddingBottom: 8, gap: 4 },
  empty: { color: colors.textFaint, fontSize: 13, lineHeight: 20, padding: 12 },
  count: { ...typography.meta, color: colors.textFaint, paddingHorizontal: 8, paddingBottom: 6 },
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
    backgroundColor: semantic.accentSoft,
    alignItems: 'center',
  },
  badgeText: { color: colors.blue, fontSize: 11, fontWeight: '600' },
  meta: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: 14, fontWeight: '500' },
  path: { color: colors.textFaint, fontSize: 11 },
  openBtn: { height: 34, paddingHorizontal: space.md },
  notice: { color: colors.textDim, fontSize: 12, lineHeight: 18, paddingHorizontal: 18, paddingTop: 6 },
  footer: { color: colors.textFaint, fontSize: 11, lineHeight: 16, paddingHorizontal: 18, paddingTop: 8 },
});
