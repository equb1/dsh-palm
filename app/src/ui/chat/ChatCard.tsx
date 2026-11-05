import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, font, radius, space } from '../theme';

/**
 * 聊天里的动作卡（ChatCard）。
 *
 * 官方 dsh-go 把审批、提问、产物共用一张卡：20 圆角、16 内边距、
 * 警示色细线；卡片本身不用主色，主色只留给「允许本次」这类唯一主按钮。
 * 之前 ApprovalCard / CapabilityCard 各写了一套外框，圆角和边距已经漂移，
 * 这里收成一个组件，后面接「产物」卡也不用再抄一遍。
 */
export type ChatCardTone = 'neutral' | 'info' | 'warn' | 'danger' | 'success';

export interface ChatCardBadge {
  label: string;
  tone?: ChatCardTone;
}

export interface ChatCardProps {
  title: string;
  badge?: ChatCardBadge;
  /** 只影响描边；卡片底色保持白色，避免聊天流里出现大色块 */
  tone?: ChatCardTone;
  children?: React.ReactNode;
  /** 底部按钮行；主按钮自己带主色，卡片不再叠加 */
  actions?: React.ReactNode;
  /** 按钮下方的说明/限制提示 */
  hint?: string;
  style?: StyleProp<ViewStyle>;
}

interface ToneStyle {
  color: string;
  bg: string;
  border: string;
}

const TONES: Record<ChatCardTone, ToneStyle> = {
  neutral: { color: colors.textDim, bg: colors.glassStrong, border: colors.borderStrong },
  info: { color: colors.blue, bg: colors.blueSoft, border: 'rgba(65,118,230,0.24)' },
  warn: { color: colors.warn, bg: colors.warnSoft, border: 'rgba(245,158,11,0.28)' },
  danger: { color: colors.danger, bg: colors.dangerSoft, border: 'rgba(236,19,19,0.28)' },
  success: { color: colors.ok, bg: colors.okSoft, border: 'rgba(34,197,94,0.26)' },
};

export function ChatCard({
  title,
  badge,
  tone = 'neutral',
  children,
  actions,
  hint,
  style,
}: ChatCardProps): React.ReactElement {
  const cardTone = TONES[tone];
  const badgeTone = TONES[badge?.tone ?? tone];
  return (
    <View style={[styles.card, { borderColor: cardTone.border }, style]}>
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {badge ? (
          <View style={[styles.chip, { backgroundColor: badgeTone.bg }]}>
            <Text style={[styles.chipText, { color: badgeTone.color }]}>{badge.label}</Text>
          </View>
        ) : null}
      </View>
      {children}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** 卡片里的命令/参数块；diff 这类要按行上色的自己传 children */
export function ChatCardCodeBox({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  return (
    <View style={[styles.codeBox, style]}>
      {typeof children === 'string' ? (
        <Text style={styles.codeText} selectable>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.glass,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { color: colors.text, fontSize: 14.5, fontWeight: '600', flex: 1 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  chipText: { fontSize: 10.5, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: 2 },
  hint: { color: colors.textFaint, fontSize: 11.5, lineHeight: 17 },

  codeBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 9,
    gap: 1,
  },
  codeText: { fontFamily: font.mono, fontSize: 11.5, color: colors.textDim, lineHeight: 17 },
});
