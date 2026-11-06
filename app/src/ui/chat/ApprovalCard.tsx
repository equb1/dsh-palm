import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Approval } from '../../protocol';
import { store } from '../useStore';
import { Btn } from '../parts';
import { font, radius, riskTone, useTheme, useThemedStyles, type Theme } from '../theme';
import { ChatCard, ChatCardCodeBox, type ChatCardTone } from './ChatCard';

/**
 * 提问卡片：官方卡片的样子——推荐选项竖排（带说明）、可以自己输入、也可以跳过。
 * dsh 的答案 schema 本来就有 custom 字段，之前只用了 selected。
 */
function QuestionActions({ approval }: { approval: Approval }): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [draft, setDraft] = React.useState('');
  const options = approval.options ?? [];
  const questionId = approval.questionId ?? '';
  // 只有"确认型"提问才有推荐项：引擎用 intent.approve 指明了哪个选项是批准。
  // 普通提问不标推荐——引擎不排优先级，标了就是编的。
  const recommended = approval.intent?.approve ?? null;

  return (
    <View style={styles.qWrap}>
      {options.map((opt) => (
        <Pressable
          key={opt.label}
          accessibilityRole="button"
          onPress={() => void store.answerQuestion(approval.id, questionId, [opt.label])}
          style={({ pressed }) => [styles.qOption, pressed && styles.qOptionPressed]}
        >
          <View style={styles.qOptionHead}>
            <Text style={styles.qOptionLabel}>{opt.label}</Text>
            {recommended !== null && opt.label === recommended ? (
              <Text style={styles.qRecommend}>推荐</Text>
            ) : null}
          </View>
          {opt.description ? <Text style={styles.qOptionDesc}>{opt.description}</Text> : null}
        </Pressable>
      ))}

      <View style={styles.qInputRow}>
        <TextInput
          style={styles.qInput}
          value={draft}
          onChangeText={setDraft}
          placeholder="或者直接说你的需求…"
          placeholderTextColor={palette.textFaint}
          multiline
          numberOfLines={2}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            const text = draft.trim();
            if (!text) return;
            setDraft('');
            void store.answerQuestion(approval.id, questionId, [], text);
          }}
          style={({ pressed }) => [styles.qSend, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.qSendText}>发送</Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => void store.answerQuestion(approval.id, questionId, [])}
        style={styles.qSkip}
      >
        <Text style={styles.qSkipText}>跳过这个问题</Text>
      </Pressable>
    </View>
  );
}

/** 卡片描边只提示风险；低风险/提问保持中性，避免聊天流里出现大色块 */
function cardTone(approval: Approval): ChatCardTone {
  if (approval.kind === 'question') return 'neutral';
  if (approval.risk === 'high') return 'danger';
  if (approval.risk === 'medium') return 'warn';
  return 'neutral';
}

function badgeTone(approval: Approval): ChatCardTone {
  if (approval.kind === 'question') return 'neutral';
  if (approval.risk === 'high') return 'danger';
  if (approval.risk === 'medium') return 'warn';
  return 'success';
}

export function ApprovalCard({ approval }: { approval: Approval }): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const isQuestion = approval.kind === 'question';
  const risk = riskTone(approval.risk, palette);
  return (
    <ChatCard
      title={approval.title}
      tone={cardTone(approval)}
      badge={
        isQuestion
          ? { label: '等你选', tone: badgeTone(approval) }
          : { label: risk.label, tone: badgeTone(approval) }
      }
      actions={
        isQuestion ? undefined : (
          <>
            <Btn
              label="拒绝"
              kind="ghost"
              onPress={() => void store.resolveApproval(approval.id, 'reject')}
              style={{ flex: 1 }}
            />
            <Btn
              label="批准"
              onPress={() => void store.resolveApproval(approval.id, 'approve')}
              style={{ flex: 1.2 }}
            />
          </>
        )
      }
    >
      {approval.command ? <ChatCardCodeBox>{approval.command}</ChatCardCodeBox> : null}

      <Text style={styles.summary}>{approval.summary}</Text>

      {approval.diff ? (
        <ChatCardCodeBox>
          {approval.diff.split('\n').map((line, i) => (
            <Text
              key={i}
              style={[
                styles.diffLine,
                line.startsWith('+') && { color: palette.ok },
                line.startsWith('-') && { color: palette.danger },
              ]}
            >
              {line}
            </Text>
          ))}
        </ChatCardCodeBox>
      ) : null}

      {isQuestion ? <QuestionActions approval={approval} /> : null}
    </ChatCard>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
  summary: { color: c.textDim, fontSize: 12.5, lineHeight: 19 },
  diffLine: { fontFamily: font.mono, fontSize: 11.5, color: c.textDim, lineHeight: 17 },

  qWrap: { gap: 8, marginTop: 4 },
  qOption: {
    backgroundColor: c.glass,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  qOptionPressed: { backgroundColor: c.glassStrong },
  qOptionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qOptionLabel: { color: c.text, fontSize: 14, fontWeight: '600' },
  qRecommend: {
    color: c.blue,
    fontSize: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.blue,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  qOptionDesc: { color: c.textFaint, fontSize: 12, lineHeight: 17 },
  qInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 2 },
  qInput: {
    flex: 1,
    backgroundColor: c.glass,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderStrong,
    color: c.text,
    fontSize: 13.5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxHeight: 96,
  },
  qSend: {
    backgroundColor: c.blue,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  qSendText: { color: c.onAccent, fontSize: 13, fontWeight: '600' },
  qSkip: { alignSelf: 'flex-start', paddingVertical: 4 },
  qSkipText: { color: c.textFaint, fontSize: 12.5 },
});
