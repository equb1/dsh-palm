import React from 'react';
import {
  Alert,
  Clipboard,
  findNodeHandle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { BrandIcon, BrandMark } from '../components';
import { MarkdownView } from '../MarkdownView';
import { generateQrMatrix } from '../../lib/qrcode';
import { captureAndShareView, captureAndSaveView } from '../../lib/host';
import { radius, space, useTheme, useThemedStyles, type Theme } from '../theme';

export interface ShareTurnSheetProps {
  visible: boolean;
  onClose: () => void;
  userText: string;
  assistantText: string;
  modelName?: string;
  sessionTitle?: string;
}

type ShareTab = 'card' | 'qr' | 'text';

export function ShareTurnSheet({
  visible,
  onClose,
  userText,
  assistantText,
  modelName,
  sessionTitle,
}: ShareTurnSheetProps): React.ReactElement | null {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [tab, setTab] = React.useState<ShareTab>('card');
  const [copied, setCopied] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const cardRef = React.useRef<React.ComponentRef<typeof View>>(null);
  const qrRef = React.useRef<React.ComponentRef<typeof View>>(null);

  const fullText = `【问】${userText || '（无标题）'}\n\n【答】${assistantText}\n\n—— 由「锦囊 (DSH Palm)」· ${modelName || 'AI 助手'} 生成`;

  // 生成真实标准的二维码点阵矩阵
  const qrMatrix = React.useMemo(() => {
    try {
      const qrPayload = `https://cnb.cool/dsh?q=${encodeURIComponent(userText.slice(0, 100))}&a=${encodeURIComponent(assistantText.slice(0, 300))}`;
      return generateQrMatrix(qrPayload);
    } catch {
      return generateQrMatrix('https://cnb.cool/dsh');
    }
  }, [userText, assistantText]);

  const handleCopy = () => {
    Clipboard.setString(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveImage = async () => {
    const targetRef = tab === 'qr' ? qrRef.current : cardRef.current;
    if (!targetRef) return;
    const node = findNodeHandle(targetRef);
    if (!node) return;
    const ok = await captureAndSaveView(node, sessionTitle || '对话分享');
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleShareImage = async () => {
    if (tab === 'text') {
      handleCopy();
      try {
        await Share.share({ message: fullText, title: sessionTitle || '对话分享' });
      } catch {}
      return;
    }
    const targetRef = tab === 'qr' ? qrRef.current : cardRef.current;
    if (!targetRef) {
      handleCopy();
      return;
    }
    const node = findNodeHandle(targetRef);
    if (!node) {
      handleCopy();
      return;
    }
    const ok = await captureAndShareView(node, sessionTitle || '对话分享');
    if (!ok) {
      handleCopy();
      Alert.alert('提示', '已将对话文本复制到剪贴板');
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>分享本轮对话</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <BrandIcon name="close" size={16} color={palette.textDim} />
            </Pressable>
          </View>

          <View style={styles.tabs}>
            <Pressable
              onPress={() => setTab('card')}
              style={[styles.tab, tab === 'card' && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === 'card' && styles.tabTextActive]}>
                长图卡片
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setTab('qr')}
              style={[styles.tab, tab === 'qr' && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === 'qr' && styles.tabTextActive]}>
                二维码
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setTab('text')}
              style={[styles.tab, tab === 'text' && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === 'text' && styles.tabTextActive]}>
                文字链接
              </Text>
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {tab === 'card' && (
              <View ref={cardRef} collapsable={false} style={styles.cardPreview}>
                <View style={styles.cardHeader}>
                  <View style={styles.brandRow}>
                    <BrandMark size={22} color={palette.blue} />
                    <Text style={styles.brandName}>锦囊</Text>
                  </View>
                  <Text style={styles.cardDate}>
                    {new Date().toLocaleDateString('zh-CN')}
                  </Text>
                </View>

                {userText ? (
                  <View style={styles.userBubble}>
                    <Text style={styles.userLabel}>问</Text>
                    <Text style={styles.userContent}>{userText}</Text>
                  </View>
                ) : null}

                <View style={styles.assistantBlock}>
                  <Text style={styles.assistantLabel}>答</Text>
                  <View style={styles.mdContainer}>
                    <MarkdownView text={assistantText} />
                  </View>
                </View>

                <View style={styles.cardFooter}>
                  <View style={styles.footerLeft}>
                    <Text style={styles.watermarkTitle}>DSH Palm · 锦囊</Text>
                    <Text style={styles.watermarkSub}>
                      模型：{modelName || 'DeepSeek'}
                    </Text>
                  </View>
                  <BrandIcon name="sparkles" size={20} color={palette.blue} />
                </View>
              </View>
            )}

            {tab === 'qr' && (
              <View ref={qrRef} collapsable={false} style={styles.qrContainer}>
                <View style={styles.qrHeader}>
                  <BrandMark size={20} color={palette.blue} />
                  <Text style={styles.qrTitle}>DSH Palm · 锦囊分享</Text>
                </View>
                <View style={styles.qrBox}>
                  {/* 标准 ISO/IEC 18004 二维码 SVG 渲染 */}
                  {qrMatrix.length > 0 ? (
                    <Svg
                      width={210}
                      height={210}
                      viewBox={`0 0 ${qrMatrix.length} ${qrMatrix.length}`}
                    >
                      {qrMatrix.map((row, r) =>
                        row.map((cell, c) =>
                          cell ? (
                            <Rect
                              key={`${r}-${c}`}
                              x={c}
                              y={r}
                              width={1}
                              height={1}
                              fill="#0F172A"
                            />
                          ) : null,
                        ),
                      )}
                    </Svg>
                  ) : null}
                </View>
                <Text style={styles.qrHint}>扫码查看此段问答完整内容</Text>
                <Text style={styles.qrSubHint} numberOfLines={2}>
                  {userText || sessionTitle || '锦囊问答'}
                </Text>
              </View>
            )}

            {tab === 'text' && (
              <View style={styles.textContainer}>
                <View style={styles.textBox}>
                  <Text style={styles.rawText}>
                    {fullText}
                  </Text>
                </View>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable onPress={handleCopy} style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>
                {copied ? '✓ 已复制文本' : '❐ 复制'}
              </Text>
            </Pressable>
            {tab !== 'text' ? (
              <Pressable onPress={handleSaveImage} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>
                  {saved ? '✓ 已存相册' : '⬇ 存相册'}
                </Text>
              </Pressable>
            ) : null}
            <Pressable onPress={handleShareImage} style={styles.primaryBtn}>
              <BrandIcon name="share" size={16} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>
                {tab === 'text' ? '分享文本' : '分享图片'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: c.backdrop,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: c.bg,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      maxHeight: '88%',
      paddingBottom: 24,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.lg,
      paddingTop: space.md,
      paddingBottom: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    headerTitle: {
      color: c.text,
      fontSize: 16,
      fontWeight: '700',
    },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.glassStrong,
    },
    tabs: {
      flexDirection: 'row',
      paddingHorizontal: space.lg,
      paddingVertical: 10,
      gap: 8,
    },
    tab: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: radius.pill,
      alignItems: 'center',
      backgroundColor: c.glassStrong,
    },
    tabActive: {
      backgroundColor: c.blueSoft,
    },
    tabText: {
      color: c.textDim,
      fontSize: 13,
      fontWeight: '500',
    },
    tabTextActive: {
      color: c.blue,
      fontWeight: '600',
    },
    body: {
      maxHeight: 480,
    },
    bodyContent: {
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
    },
    cardPreview: {
      backgroundColor: '#FFFFFF',
      borderRadius: radius.lg,
      paddingHorizontal: space.lg,
      paddingTop: space.lg,
      paddingBottom: 28,
      borderWidth: 1,
      borderColor: '#E2E8F0',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 4,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: '#E2E8F0',
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    brandName: {
      color: '#0F172A',
      fontSize: 15,
      fontWeight: '700',
    },
    cardDate: {
      color: '#64748B',
      fontSize: 12,
    },
    userBubble: {
      backgroundColor: '#F8FAFC',
      borderRadius: radius.md,
      padding: 12,
      marginVertical: space.md,
      borderLeftWidth: 3,
      borderLeftColor: '#3B82F6',
    },
    userLabel: {
      color: '#3B82F6',
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 4,
    },
    userContent: {
      color: '#1E293B',
      fontSize: 14,
      lineHeight: 20,
    },
    assistantBlock: {
      marginVertical: space.xs,
    },
    assistantLabel: {
      color: '#10B981',
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 6,
    },
    mdContainer: {
      minHeight: 40,
    },
    cardFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: space.md,
      marginTop: space.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: '#E2E8F0',
    },
    footerLeft: {
      gap: 2,
    },
    watermarkTitle: {
      color: '#0F172A',
      fontSize: 13,
      fontWeight: '700',
    },
    watermarkSub: {
      color: '#94A3B8',
      fontSize: 11,
    },
    qrContainer: {
      backgroundColor: '#FFFFFF',
      borderRadius: radius.lg,
      padding: space.xl,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: '#E2E8F0',
    },
    qrHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 16,
    },
    qrTitle: {
      color: '#0F172A',
      fontSize: 14,
      fontWeight: '700',
    },
    qrBox: {
      width: 226,
      height: 226,
      backgroundColor: '#FFFFFF',
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: '#E2E8F0',
      padding: 8,
    },
    qrHint: {
      color: '#0F172A',
      fontSize: 14,
      fontWeight: '600',
      marginTop: 16,
    },
    qrSubHint: {
      color: '#64748B',
      fontSize: 12,
      marginTop: 4,
      textAlign: 'center',
    },
    textContainer: {
      backgroundColor: c.glassStrong,
      borderRadius: radius.lg,
      padding: space.md,
    },
    textBox: {
      backgroundColor: c.bgElevated,
      borderRadius: radius.md,
      padding: space.md,
    },
    rawText: {
      color: c.text,
      fontSize: 13,
      lineHeight: 19,
    },
    footer: {
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: space.lg,
      paddingTop: space.md,
    },
    secondaryBtn: {
      flex: 1,
      height: 44,
      borderRadius: radius.pill,
      backgroundColor: c.glassStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryBtnText: {
      color: c.text,
      fontSize: 14,
      fontWeight: '600',
    },
    primaryBtn: {
      flex: 1,
      height: 44,
      borderRadius: radius.pill,
      backgroundColor: c.blue,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    primaryBtnText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '600',
    },
  });
