import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { QaView } from '../../protocol/qa';
import { radius, useThemedStyles, type Theme } from '../theme';
import { ChatCard, ChatCardCodeBox, type ChatCardTone } from './ChatCard';

/**
 * 历史/已处理的问答卡：只负责展示，不提供任何按钮或输入框。
 * 等待回答的仍走 ApprovalCard 的交互态。
 */
export function ReadonlyQaCard({ qa }: { qa: QaView }): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  const tone: ChatCardTone =
    qa.status === 'answered' || qa.status === 'approved'
      ? 'success'
      : qa.status === 'rejected'
        ? 'danger'
        : 'neutral';
  const hasAnswer = qa.selected.length > 0 || Boolean(qa.custom);
  return (
    <ChatCard
      title={qa.title}
      tone={tone}
      badge={{ label: qa.statusLabel, tone }}
    >
      {qa.kind === 'approval' && qa.command ? (
        <ChatCardCodeBox>{qa.command}</ChatCardCodeBox>
      ) : null}

      {qa.question ? <Text style={styles.question}>{qa.question}</Text> : null}
      {qa.kind === 'approval' && qa.summary && qa.summary !== qa.question ? (
        <Text style={styles.note}>{qa.summary}</Text>
      ) : null}

      {qa.selected.length > 0 ? (
        <View style={styles.answerBlock}>
          <Text style={styles.answerLabel}>你的选择</Text>
          <View style={styles.choiceRow}>
            {qa.selected.map((item) => (
              <View key={item} style={styles.choice}>
                <Text style={styles.choiceText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {qa.custom ? (
        <View style={styles.answerBlock}>
          <Text style={styles.answerLabel}>{qa.selected.length > 0 ? '你的补充' : '你的回答'}</Text>
          <Text style={styles.custom} selectable>
            {qa.custom}
          </Text>
        </View>
      ) : null}

      {!hasAnswer ? (
        <Text style={styles.empty}>
          {qa.kind === 'approval'
            ? qa.status === 'approved'
              ? '已批准本次操作'
              : '已拒绝本次操作'
            : qa.status === 'rejected'
              ? '已拒绝回答'
              : '已跳过，没有作答'}
        </Text>
      ) : null}
    </ChatCard>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    question: { color: c.text, fontSize: 13.5, lineHeight: 20 },
    note: { color: c.textDim, fontSize: 12.5, lineHeight: 19 },
    answerBlock: { gap: 6, marginTop: 2 },
    answerLabel: { color: c.textFaint, fontSize: 11, fontWeight: '600' },
    choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    choice: {
      backgroundColor: c.glassStrong,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    choiceText: { color: c.text, fontSize: 12.5 },
    custom: {
      color: c.text,
      fontSize: 13,
      lineHeight: 20,
      backgroundColor: c.bgElevated,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    empty: { color: c.textFaint, fontSize: 12, lineHeight: 18 },
  });
