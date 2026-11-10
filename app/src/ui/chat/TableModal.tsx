import React from 'react';
import {
  Clipboard,
  findNodeHandle,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BrandIcon } from '../components';
import { captureAndShareView } from '../../lib/host';
import { radius, space, topInset, useTheme, useThemedStyles, type Theme } from '../theme';

export interface TableModalProps {
  visible: boolean;
  onClose: () => void;
  header: string[];
  align: Array<'left' | 'center' | 'right'>;
  rows: string[][];
}

export function TableModal({
  visible,
  onClose,
  header,
  align,
  rows,
}: TableModalProps): React.ReactElement | null {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [copiedType, setCopiedType] = React.useState<string | null>(null);
  const [fontSize, setFontSize] = React.useState(13);
  const tableContentRef = React.useRef<React.ComponentRef<typeof View>>(null);

  const toCSV = (): string => {
    const escape = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
    const lines = [
      header.map(escape).join(','),
      ...rows.map((row) => row.map(escape).join(',')),
    ];
    return lines.join('\n');
  };

  const toMarkdown = (): string => {
    const delim = align.map((a) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : ':---'));
    const lines = [
      `| ${header.join(' | ')} |`,
      `| ${delim.join(' | ')} |`,
      ...rows.map((row) => `| ${row.join(' | ')} |`),
    ];
    return lines.join('\n');
  };

  const handleCopyCSV = () => {
    Clipboard.setString(toCSV());
    setCopiedType('CSV');
    setTimeout(() => setCopiedType(null), 1800);
  };

  const handleCopyMD = () => {
    Clipboard.setString(toMarkdown());
    setCopiedType('Markdown');
    setTimeout(() => setCopiedType(null), 1800);
  };

  const handleShareImage = () => {
    if (!tableContentRef.current) return;
    const node = findNodeHandle(tableContentRef.current);
    if (!node) return;
    void captureAndShareView(node, '表格全景分享');
  };

  const handleShare = () => {
    handleShareImage();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeBtn}>
            <BrandIcon name="close" size={18} color={palette.text} />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={styles.title}>表格详情</Text>
            <Text style={styles.subTitle}>
              {header.length} 列 · {rows.length} 行
            </Text>
          </View>
          <View style={styles.actions}>
            <Pressable
              onPress={() => setFontSize((s) => Math.max(10, s - 1))}
              style={styles.pillBtn}
            >
              <Text style={styles.pillText}>A-</Text>
            </Pressable>
            <Pressable
              onPress={() => setFontSize((s) => Math.min(18, s + 1))}
              style={styles.pillBtn}
            >
              <Text style={styles.pillText}>A+</Text>
            </Pressable>
            <Pressable onPress={handleShare} style={styles.iconBtn}>
              <BrandIcon name="share" size={16} color={palette.blue} />
            </Pressable>
          </View>
        </View>

        <View style={styles.toolBar}>
          <Pressable onPress={handleCopyCSV} style={styles.copyBtn}>
            <Text style={styles.copyBtnText}>
              {copiedType === 'CSV' ? '✓ 已复制 CSV' : '❐ 复制 CSV'}
            </Text>
          </Pressable>
          <Pressable onPress={handleCopyMD} style={styles.copyBtn}>
            <Text style={styles.copyBtnText}>
              {copiedType === 'Markdown' ? '✓ 已复制 Markdown' : '❐ 复制 Markdown'}
            </Text>
          </Pressable>
        </View>

        <ScrollView style={styles.verticalScroll} contentContainerStyle={styles.content}>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View ref={tableContentRef} collapsable={false} style={styles.table}>
              <View style={[styles.row, styles.headerRow]}>
                {header.map((col, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.cell,
                      styles.headerCell,
                      idx === 0 && styles.cellFirst,
                    ]}
                  >
                    <Text
                      style={[
                        styles.headerCellText,
                        {
                          fontSize: fontSize + 0.5,
                          textAlign: align[idx] ?? 'left',
                        },
                      ]}
                    >
                      {col}
                    </Text>
                  </View>
                ))}
              </View>
              {rows.map((row, rIdx) => (
                <View
                  key={rIdx}
                  style={[styles.row, rIdx % 2 === 1 && styles.rowStripe]}
                >
                  {row.map((cell, cIdx) => (
                    <View
                      key={cIdx}
                      style={[styles.cell, cIdx === 0 && styles.cellFirst]}
                    >
                      <Text
                        selectable
                        style={[
                          styles.cellText,
                          {
                            fontSize,
                            textAlign: align[cIdx] ?? 'left',
                          },
                        ]}
                      >
                        {cell}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.footerBrand}>锦囊 · 数据洞察与表格</Text>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.bg,
      paddingTop: topInset,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
      gap: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.glassStrong,
    },
    titleWrap: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      color: c.text,
      fontSize: 16,
      fontWeight: '700',
    },
    subTitle: {
      color: c.textFaint,
      fontSize: 11,
      marginTop: 1,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    pillBtn: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: c.glassStrong,
    },
    pillText: {
      color: c.text,
      fontSize: 12,
      fontWeight: '600',
    },
    iconBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.blueSoft,
    },
    toolBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: space.lg,
      paddingVertical: 8,
      backgroundColor: c.bgElevated,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    copyBtn: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: c.glass,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    copyBtnText: {
      color: c.textDim,
      fontSize: 11.5,
      fontWeight: '500',
    },
    verticalScroll: {
      flex: 1,
    },
    content: {
      padding: space.lg,
    },
    table: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.borderStrong,
      backgroundColor: c.glass,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    headerRow: {
      backgroundColor: c.glassStrong,
      borderBottomWidth: 1,
      borderBottomColor: c.borderStrong,
    },
    rowStripe: {
      backgroundColor: c.bgElevated,
    },
    cell: {
      minWidth: 110,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: c.border,
      justifyContent: 'center',
    },
    headerCell: {
      paddingVertical: 12,
    },
    cellFirst: {
      borderLeftWidth: 0,
    },
    headerCellText: {
      color: c.text,
      fontWeight: '700',
      lineHeight: 18,
    },
    cellText: {
      color: c.text,
      lineHeight: 20,
    },
    footer: {
      paddingHorizontal: space.lg,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      alignItems: 'center',
      backgroundColor: c.bgElevated,
    },
    footerBrand: {
      color: c.textFaint,
      fontSize: 11,
      letterSpacing: 0.5,
    },
  });

