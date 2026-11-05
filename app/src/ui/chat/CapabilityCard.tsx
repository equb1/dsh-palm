import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Block } from '../../protocol';
import { hostAvailable } from '../../lib/host';
import { store, useStore } from '../useStore';
import { Btn } from '../parts';
import { colors, font, radius } from '../theme';
import { ChatCard, ChatCardCodeBox } from './ChatCard';

type CapabilityBlock = Extract<Block, { kind: 'capability' }>;

/**
 * 能力门卡片（1.4）：轻引擎缺能力时出现。
 *
 * 用户确认后走 Handoff：把轻引擎历史摘要 + 最近 8 条 + 已完成工具
 * 交给完整引擎，只继续未执行的那一步。命令类能力（bash）按 F8 还要
 * 明确提醒：完整引擎跑 bash 需要 danger-full-access，确认后由 store 设置。
 */
export function CapabilityCard({ block }: { block: CapabilityBlock }): React.ReactElement {
  const state = useStore();
  const [confirmed, setConfirmed] = React.useState(false);
  const [settled, setSettled] = React.useState<'idle' | 'handed' | 'stay'>(
    block.status === 'handed_off' ? 'handed' : 'idle',
  );
  const [pending, setPending] = React.useState(false);

  const busy = state.engine.busy;
  const approvals = Object.keys(state.approvals).length;
  const starting = state.engine.mode === 'starting-proot';
  const disabled = !hostAvailable || busy || approvals > 0 || starting || pending || settled !== 'idle';
  const needsConfirm = block.tool === 'bash';
  const isBash = block.tool === 'bash';

  const continueHandoff = async (): Promise<void> => {
    if (needsConfirm && !confirmed) {
      setConfirmed(true);
      return;
    }
    setPending(true);
    try {
      const ok = await store.continueHandoff(block);
      if (ok) setSettled('handed');
      else setConfirmed(true);
    } finally {
      setPending(false);
    }
  };

  const primaryLabel = (() => {
    if (settled === 'handed' || block.status === 'handed_off') return '已交接';
    if (pending) return '交接中…';
    if (needsConfirm && !confirmed) return '继续（需完全权限）';
    if (needsConfirm) return '确认并交接';
    return '用完整模式继续';
  })();

  const hint = (() => {
    if (settled === 'stay') return '已留在轻引擎；需要时重新点「用完整模式继续」。';
    if (settled === 'handed' || block.status === 'handed_off') {
      return '已交接，接下来由完整引擎继续；已完成的步骤不会重做。';
    }
    if (!disabled) return undefined;
    if (!hostAvailable) return '这台设备不支持完整引擎（需要原生构建）';
    if (busy) return '正在执行回合，等这一轮结束再试';
    if (approvals > 0) return '还有审批/提问等着处理，处理完再试';
    if (starting) return '完整引擎正在启动，请稍候';
    return '交接进行中…';
  })();

  return (
    <ChatCard
      title="这个操作需要完整引擎"
      tone="warn"
      badge={{ label: '缺能力', tone: 'warn' }}
      actions={
        settled === 'idle' ? (
          <>
            <Btn
              label="留在轻引擎"
              kind="ghost"
              disabled={pending}
              onPress={() => {
                store.stayOnLight(block);
                setSettled('stay');
              }}
              style={{ flex: 1 }}
            />
            <Btn
              label={primaryLabel}
              disabled={disabled}
              onPress={() => void continueHandoff()}
              style={{ flex: 1.3 }}
            />
          </>
        ) : undefined
      }
      hint={hint}
    >
      <Text style={styles.summary}>{block.summary}</Text>
      {block.reason ? <Text style={styles.reason}>{block.reason}</Text> : null}

      {block.missing.length > 0 ? (
        <View style={styles.missingRow}>
          {block.missing.map((item) => (
            <View key={item} style={styles.missingChip}>
              <Text style={styles.missingText}>{item}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {block.command ? <ChatCardCodeBox>{block.command}</ChatCardCodeBox> : null}

      {isBash ? (
        <View style={styles.warning}>
          <Text style={styles.warningTitle}>完整引擎执行命令需要完全权限（danger-full-access）</Text>
          <Text style={styles.warningBody}>
            确认后会把这条会话切到 danger-full-access；命令只会在 proot 的 /root/work 里执行。
          </Text>
          {!confirmed && settled === 'idle' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="我已知晓，继续"
              disabled={disabled}
              onPress={() => setConfirmed(true)}
              style={({ pressed }) => [styles.confirmRow, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.checkbox} />
              <Text style={styles.confirmText}>我已知晓，继续（下一步确认）</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </ChatCard>
  );
}

const styles = StyleSheet.create({
  summary: { color: colors.text, fontSize: 13, lineHeight: 19 },
  reason: { color: colors.textDim, fontSize: 12.5, lineHeight: 19 },
  missingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  missingChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: colors.bgElevated,
  },
  missingText: { color: colors.textDim, fontFamily: font.mono, fontSize: 11 },
  warning: {
    backgroundColor: colors.warnSoft,
    borderRadius: radius.md,
    padding: 10,
    gap: 4,
  },
  warningTitle: { color: colors.warn, fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  warningBody: { color: colors.textDim, fontSize: 11.5, lineHeight: 17 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 4 },
  checkbox: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: colors.warn,
  },
  confirmText: { color: colors.warn, fontSize: 12, fontWeight: '600' },
});
