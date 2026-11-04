import React from 'react';
import { Clipboard, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import type { Approval, Block, Turn } from '../../protocol';
import { MarkdownView } from '../MarkdownView';
import { colors, font, radius } from '../theme';
import { ApprovalCard } from './ApprovalCard';

const ThinkingRow = React.memo(function ThinkingRow({
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
      {!open ? (
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
    return header;
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
});

const ToolRow = React.memo(function ToolRow({
  block,
}: {
  block: Extract<Block, { kind: 'tool' }>;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const detail = block.detail?.slice(0, 4000);
  const color =
    block.state === 'running' ? colors.blue : block.state === 'error' ? colors.danger : colors.textFaint;

  return (
    <View>
      <Pressable
        onPress={detail ? () => setOpen((v) => !v) : undefined}
        accessibilityRole={detail ? 'button' : undefined}
        accessibilityLabel={detail ? `${block.name} 详情` : undefined}
        style={styles.row}
      >
        <Text style={[styles.rowGlyph, { color }]}>▤</Text>
        <Text style={styles.toolName}>{block.name}</Text>
        <Text style={styles.rowText} numberOfLines={1}>
          {block.summary}
        </Text>
        {detail ? <Text style={styles.chevron}>{open ? '▴' : '▾'}</Text> : null}
        <Text style={[styles.rowState, { color }]}>
          {block.state === 'running' ? '·' : block.state === 'error' ? '×' : '✓'}
        </Text>
      </Pressable>
      {open && detail ? (
        <View style={styles.toolDetail}>
          <Text style={styles.toolDetailText} selectable>
            {detail}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

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
      return <MarkdownView key={block.id} text={block.text} streaming={live} />;
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

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '';
  const total = Math.max(1, Math.round(ms / 1000));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes} 分 ${seconds} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

function processSummary(blocks: Block[]): string {
  const tools = blocks
    .filter((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool')
    .map((b) => b.name.toLowerCase());
  const has = (names: string[]): boolean => tools.some((t) => names.some((n) => t.includes(n)));
  const parts: string[] = [];
  if (has(['bash', 'exec', 'shell', 'command', 'terminal'])) parts.push('执行了命令');
  if (has(['write', 'edit', 'patch', 'apply'])) parts.push('修改了文件');
  if (has(['read', 'glob', 'grep', 'search', 'find', 'ls'])) parts.push('读取了文件');
  if (has(['present', 'deliver', 'share'])) parts.push('交付了文件');
  const thinking = blocks.filter((b) => b.kind === 'thinking').length;
  if (parts.length === 0) {
    if (tools.length > 0) parts.push(`运行了 ${tools.length} 个工具`);
    else if (thinking > 0) parts.push(`思考了 ${thinking} 次`);
  }
  return parts.length > 0 ? parts.join('，') + '等' : '';
}

const AssistantTurn = React.memo(function AssistantTurn({
  turn,
  approvals,
  onToggleThinking,
  fallbackDurationMs,
}: {
  turn: Turn;
  approvals: Record<string, Approval>;
  onToggleThinking?: () => void;
  fallbackDurationMs?: number;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const completed = turn.status !== 'streaming';
  const visibleBlocks = React.useMemo(
    () => turn.blocks.filter((b) => !(b.kind === 'thinking' && !b.text.trim())),
    [turn.blocks],
  );
  const processBlocks = React.useMemo(
    () => visibleBlocks.filter((b) => b.kind === 'thinking' || b.kind === 'tool'),
    [visibleBlocks],
  );
  const answerBlocks = React.useMemo(
    () => turn.blocks.filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text'),
    [turn.blocks],
  );
  const approvalBlocks = React.useMemo(
    () => visibleBlocks.filter((b) => b.kind === 'approval'),
    [visibleBlocks],
  );
  const answerText = React.useMemo(
    () => answerBlocks.map((b) => b.text).join('\n'),
    [answerBlocks],
  );
  const duration = formatDuration(turn.meta?.durationMs ?? fallbackDurationMs);
  const summary = React.useMemo(() => processSummary(turn.blocks), [turn.blocks]);

  return (
    <View style={styles.assistant}>
      {completed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? '收起过程' : '展开过程'}
          onPress={() => setOpen((v) => !v)}
          style={styles.summary}
        >
          <View style={styles.summaryHead}>
            <Text style={styles.summaryCheck}>✓</Text>
            <Text style={styles.summaryTitle}>
              {turn.status === 'stopped' ? '已停止' : turn.status === 'error' ? '出错' : '已完成'}
            </Text>
            {duration ? <Text style={styles.summaryDuration}>，用时 {duration}</Text> : null}
            <View style={{ flex: 1 }} />
            <Text style={styles.chevron}>{open ? '▴' : '▾'}</Text>
          </View>
          {summary ? <Text style={styles.summarySub}>{summary}</Text> : null}
        </Pressable>
      ) : null}

      {completed && open &&
        processBlocks.map((b, i) => (
          <React.Fragment key={`${b.id}-${i}`}>
            {renderBlock(b, approvals, onToggleThinking, false)}
          </React.Fragment>
        ))}

      {completed
        ? [
            ...approvalBlocks.map((b, i) => (
              <React.Fragment key={`ap-${b.id}-${i}`}>
                {renderBlock(b, approvals, onToggleThinking)}
              </React.Fragment>
            )),
            ...answerBlocks.map((b, i) => (
              <React.Fragment key={`${b.id}-${i}`}>
                {renderBlock(b, approvals, onToggleThinking)}
              </React.Fragment>
            )),
          ]
        : visibleBlocks.map((b, i) => (
            <React.Fragment key={`${b.id}-${i}`}>
              {renderBlock(
                b,
                approvals,
                onToggleThinking,
                turn.status === 'streaming' && i === visibleBlocks.length - 1
              )}
            </React.Fragment>
          ))}

      {completed ? <AssistantActions text={answerText} /> : null}
    </View>
  );
});

function TurnViewImpl({
  turn,
  approvals,
  onToggleThinking,
  fallbackDurationMs,
}: {
  turn: Turn;
  approvals: Record<string, Approval>;
  onToggleThinking?: () => void;
  fallbackDurationMs?: number;
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

  return (
    <AssistantTurn
      turn={turn}
      approvals={approvals}
      onToggleThinking={onToggleThinking}
      fallbackDurationMs={fallbackDurationMs}
    />
  );
}

export const TurnView = React.memo(TurnViewImpl);

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
  summary: {
    paddingVertical: 8,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  summaryCheck: { color: colors.ok, fontSize: 12, fontWeight: '700' },
  summaryTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  summaryDuration: { color: colors.textDim, fontSize: 12 },
  summarySub: { color: colors.textFaint, fontSize: 11.5, lineHeight: 16 },
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
  thinkingBodyWrap: {
    marginLeft: 18,
    paddingLeft: 12,
    paddingBottom: 6,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  thinkingBody: { color: colors.textDim, fontSize: 12.5, lineHeight: 19 },
  thinkingMore: { color: colors.textFaint, fontSize: 11, lineHeight: 16, paddingTop: 6 },
  toolDetail: {
    marginLeft: 18,
    marginTop: 2,
    marginBottom: 4,
    padding: 8,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  toolDetailText: { color: colors.textDim, fontFamily: font.mono, fontSize: 11.5, lineHeight: 17 },
});
