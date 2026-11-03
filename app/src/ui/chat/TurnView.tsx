import React from 'react';
import { Clipboard, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import type { Approval, Block, Turn } from '../../protocol';
import { MarkdownView } from '../MarkdownView';
import { colors, font, radius } from '../theme';
import { ApprovalCard } from './ApprovalCard';

function ThinkingRow({ text, onToggle }: { text: string; onToggle?: () => void }): React.ReactElement {
  const [userOpen, setUserOpen] = React.useState<boolean | null>(null);
  const open = userOpen ?? false;
  const tail = text.slice(-120).replace(/\s+/g, ' ').trim();

  const handleToggle = (): void => {
    onToggle?.();
    setUserOpen(!open);
  };

  if (!open) {
    return (
      <Pressable
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityLabel="展开思考"
        style={styles.row}
      >
        <Text style={styles.rowGlyph}>✳</Text>
        <Text style={styles.thinkingLabel}>思考</Text>
        <Text style={styles.rowText} numberOfLines={1}>
          {tail}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={handleToggle}
      accessibilityRole="button"
      accessibilityLabel="收起思考"
      style={styles.thinkingOpenBox}
    >
      <View style={styles.thinkingOpenHeader}>
        <Text style={styles.rowGlyph}>✳</Text>
        <Text style={styles.thinkingLabel}>思考过程</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.chevron}>▴</Text>
      </View>
      <MarkdownView text={text} />
    </Pressable>
  );
}

function ToolRow({ block }: { block: Extract<Block, { kind: 'tool' }> }): React.ReactElement {
  const color =
    block.state === 'running' ? colors.blue : block.state === 'error' ? colors.danger : colors.textFaint;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowGlyph, { color }]}>▤</Text>
      <Text style={styles.toolName}>{block.name}</Text>
      <Text style={styles.rowText} numberOfLines={1}>
        {block.summary}
      </Text>
      <Text style={[styles.rowState, { color }]}>
        {block.state === 'running' ? '·' : block.state === 'error' ? '×' : '✓'}
      </Text>
    </View>
  );
}

function renderBlock(
  block: Block,
  approvals: Record<string, Approval>,
  onToggleThinking?: () => void
): React.ReactElement | null {
  switch (block.kind) {
    case 'thinking':
      return <ThinkingRow key={block.id} text={block.text} onToggle={onToggleThinking} />;
    case 'tool':
      return <ToolRow key={block.id} block={block} />;
    case 'text':
      return <MarkdownView key={block.id} text={block.text} />;
    case 'approval': {
      const approval = approvals[block.approvalId];
      return approval ? <ApprovalCard key={block.id} approval={approval} /> : null;
    }
    default:
      return null;
  }
}

function AssistantActions({ text }: { text: string }): React.ReactElement | null {
  const [copied, setCopied] = React.useState(false);
  if (!text.trim()) return null;

  const copy = (): void => {
    Clipboard.setString(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel="复制回答" onPress={copy} hitSlop={8}>
        <Text style={[styles.actionGlyph, copied && { color: colors.ok }]}>{copied ? '✓' : '⧉'}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="分享回答"
        onPress={() => void Share.share({ message: text })}
        hitSlop={8}
      >
        <Text style={styles.actionGlyph}>↗</Text>
      </Pressable>
    </View>
  );
}

export function TurnView({
  turn,
  approvals,
  onToggleThinking,
}: {
  turn: Turn;
  approvals: Record<string, Approval>;
  onToggleThinking?: () => void;
}): React.ReactElement {
  if (turn.role === 'user') {
    const text = turn.blocks
      .map((b) => (b.kind === 'text' ? b.text : ''))
      .join('')
      .trim();
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{text}</Text>
        </View>
      </View>
    );
  }

  const hasDoneDuration = Boolean(turn.status === 'done' && turn.meta?.durationMs);
  const answerText = turn.blocks
    .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('\n');
  return (
    <View style={styles.assistant}>
      {turn.blocks.map((b) => renderBlock(b, approvals, onToggleThinking))}
      {turn.status === 'done' || turn.status === 'stopped' ? (
        <AssistantActions text={answerText} />
      ) : null}
      {turn.status === 'stopped' ? <Text style={styles.turnMeta}>已停止</Text> : null}
      {hasDoneDuration ? (
        <Text style={styles.turnMeta}>
          {(turn.meta!.durationMs! / 1000).toFixed(0)} 秒 · {turn.meta?.steps ?? 1} 步
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end' },
  userBubble: {
    backgroundColor: colors.bubble,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
    maxWidth: '84%',
  },
  userText: { color: colors.text, fontSize: 14, lineHeight: 22 },

  assistant: { gap: 8 },
  turnMeta: { color: colors.textFaint, fontSize: 10.5 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 2 },
  actionGlyph: { color: colors.textFaint, fontSize: 15 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 2 },
  rowGlyph: { color: colors.textFaint, fontSize: 11 },
  rowText: { color: colors.textDim, fontSize: 13, flex: 1 },
  thinkingLabel: { color: colors.textFaint, fontSize: 13 },
  toolName: { color: colors.textFaint, fontSize: 11, fontFamily: font.mono },
  rowState: { fontSize: 11 },
  chevron: { color: colors.textFaint, fontSize: 11 },

  thinkingOpenBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 10,
    gap: 8,
  },
  thinkingOpenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
});
