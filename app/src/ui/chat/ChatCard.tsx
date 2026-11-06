import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { font, radius, space, useTheme, useThemedStyles, type Palette, type Theme } from '../theme';

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

function tones(c: Palette): Record<ChatCardTone, ToneStyle> {
  return {
    neutral: { color: c.textDim, bg: c.glassStrong, border: c.borderStrong },
    info: { color: c.blue, bg: c.blueSoft, border: c.infoBorder },
    warn: { color: c.warn, bg: c.warnSoft, border: c.warnBorder },
    danger: { color: c.danger, bg: c.dangerSoft, border: c.dangerBorder },
    success: { color: c.ok, bg: c.okSoft, border: c.successBorder },
  };
}

export function ChatCard({
  title,
  badge,
  tone = 'neutral',
  children,
  actions,
  hint,
  style,
}: ChatCardProps): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const toneSet = tones(palette);
  const cardTone = toneSet[tone];
  const badgeTone = toneSet[badge?.tone ?? tone];
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
  const styles = useThemedStyles(createStyles);
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

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
  card: {
    backgroundColor: c.glass,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { color: c.text, fontSize: 14.5, fontWeight: '600', flex: 1 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  chipText: { fontSize: 10.5, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: 2 },
  hint: { color: c.textFaint, fontSize: 11.5, lineHeight: 17 },

  codeBox: {
    backgroundColor: c.bgElevated,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    padding: 9,
    gap: 1,
  },
  codeText: { fontFamily: font.mono, fontSize: 11.5, color: c.textDim, lineHeight: 17 },
});
