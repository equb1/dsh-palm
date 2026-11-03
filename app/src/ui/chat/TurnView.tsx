import React from 'react';
import { Clipboard, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import type { Approval, Block, Turn } from '../../protocol';
import { MarkdownView } from '../MarkdownView';
import { colors, font, radius } from '../theme';
import { ApprovalCard } from './ApprovalCard';

function ThinkingRow({
  text,
  onToggle,
  live,
}: {
  text: string;
  onToggle?: () => void;
  live?: boolean;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  // 长任务（20+ 分钟）的思考可能有几十万字，整段 Markdown 渲染会把 JS 线程卡死；
  // 展开时只渲染最后一段，够看思路，又不会 OOM。
  const MAX_OPEN = 12000;
  const shown = text.length > MAX_OPEN ? text.slice(-MAX_OPEN) : text;
  const truncated = text.length > MAX_OPEN;
  const preview = text.trim().split('\n')[0]?.replace(/\*\*/g, '').slice(0, 120) ?? '';
  const ticker = text.slice(-800);

  // dsh-go 的做法：一轮结束就把展开的全文收回去，过程收进一行摘要。
  React.useEffect(() => {
    if (!live) setOpen(false);
  }, [live]);

  const handleToggle = (): void => {
    onToggle?.();
    setOpen((v) => !v);
  };

  const header = (
    <Pressable
      onPress={handleToggle}
      accessibilityRole="button"
      accessibilityLabel={open ? '收起思考' : '展开思考'}
      style={styles.row}
    >
      <Text style={styles.rowGlyph}>✳</Text>
      <Text style={[styles.thinkingLabel, live && styles.thinkingActive]}>
        {live ? '思考中' : '思考'}
      </Text>
      {!live && !open ? (
        <Text style={styles.rowText} numberOfLines={1}>
          {preview}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {live && !open ? <Text style={styles.liveDot}>●</Text> : null}
      <Text style={styles.chevron}>{open ? '▴' : '▾'}</Text>
    </Pressable>
  );

  if (!open) {
    return (
      <View>
        {header}
        {/* 流式中固定三行实时窗：不滚、不撑高列表，只跟最新写出来的字 */}
        {live ? (
          <View style={styles.tickerWrap}>
            <Text style={styles.tickerText} numberOfLines={3} ellipsizeMode="head">
              {ticker}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.thinkingOpenBox}>
      {header}
      {/* 展开态直接进页面滚动，不做嵌套 ScrollView，避免手势被外层吃掉 */}
      <View style={styles.thinkingBodyWrap}>
        <Text style={styles.thinkingBody} selectable>
          {shown}
        </Text>
        {truncated ? (
          <Text style={styles.thinkingMore}>思考太长，这里只显示最后 {MAX_OPEN} 字。</Text>
        ) : null}
      </View>
    </View>
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
  onToggleThinking?: () => void,
  live?: boolean
): React.ReactElement | null {
  switch (block.kind) {
    case 'thinking':
      return (
        <ThinkingRow key={block.id} text={block.text} onToggle={onToggleThinking} live={live} />
      );
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
      {turn.blocks.map((b, i) => (
        <React.Fragment key={`${b.id}-${i}`}>
          {renderBlock(b, approvals, onToggleThinking, turn.status === 'streaming')}
        </React.Fragment>
      ))}
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
    gap: 6,
    paddingVertical: 2,
  },
  thinkingActive: { color: colors.blue },
  liveDot: { color: colors.blue, fontSize: 8, paddingHorizontal: 2 },
  tickerWrap: {
    height: 57,
    overflow: 'hidden',
    marginLeft: 18,
    paddingLeft: 12,
    paddingTop: 2,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  tickerText: { color: colors.textDim, fontSize: 12.5, lineHeight: 19 },
  thinkingBodyWrap: {
    marginLeft: 18,
    paddingLeft: 12,
    paddingBottom: 6,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  thinkingBody: { color: colors.textDim, fontSize: 12.5, lineHeight: 19 },
  thinkingMore: { color: colors.textFaint, fontSize: 11, lineHeight: 16, paddingTop: 6 },
});
