import React from 'react';
import { Clipboard, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import type { Approval, Block, Turn } from '../../protocol';
import { MarkdownView } from '../MarkdownView';
import { font, radius, useTheme, useThemedStyles, type Theme } from '../theme';
import { ApprovalCard } from './ApprovalCard';
import { CapabilityCard } from './CapabilityCard';

const ThinkingRow = React.memo(function ThinkingRow({
  text,
  onToggle,
  live,
}: {
  text: string;
  onToggle?: () => void;
  live?: boolean;
}): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  const [open, setOpen] = React.useState(false);
  const scrollRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  const MAX_OPEN = 12000;
  const LIVE_WINDOW = 2000;
  // 思考中展开时跟官方一样继续流，但只渲染最后 2000 字，避免每 token 重排 12k
  const shownRaw = open && live ? text.slice(-LIVE_WINDOW) : text;
  const shown = shownRaw.length > MAX_OPEN ? shownRaw.slice(-MAX_OPEN) : shownRaw;
  const truncated = text.length > MAX_OPEN;
  const preview = text.trim().split('\n')[0]?.replace(/\*\*/g, '').slice(0, 120) ?? '';
  // 实时思考收成 3 行窗：只跟最后几行，不再每 token 重排前面已读的内容
  const livePreview = text
    .trim()
    .split('\n')
    .slice(-3)
    .join('\n')
    .replace(/\*\*/g, '')
    .slice(-240);

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
        <Text style={[styles.rowText, live && styles.rowTextLive]} numberOfLines={live ? 3 : 1}>
          {live ? livePreview : preview}
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
      {/* 展开态限高 + 内部滚动，不改变外层列表高度 */}
      <ScrollView
        ref={scrollRef}
        style={styles.thinkingScroll}
        nestedScrollEnabled
        onContentSizeChange={() => {
          if (live && open) scrollRef.current?.scrollToEnd({ animated: false });
        }}
      >
        <Text style={styles.thinkingBody} selectable>
          {shown}
        </Text>
        {truncated ? (
          <Text style={styles.thinkingMore}>思考太长，这里只显示最后 {MAX_OPEN} 字。</Text>
        ) : null}
        {live ? (
          <Text style={styles.thinkingMore}>
            思考仍在输出，当前只跟最后 {LIVE_WINDOW} 字；收起后再展开可看全文。
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
});

const ToolRow = React.memo(function ToolRow({
  block,
}: {
  block: Extract<Block, { kind: 'tool' }>;
}): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [open, setOpen] = React.useState(false);
  const detail = block.detail?.slice(0, 4000);
  const color =
    block.state === 'running' ? palette.blue : block.state === 'error' ? palette.danger : palette.textFaint;

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

type ToolBlock = Extract<Block, { kind: 'tool' }>;

/**
 * 连续工具行合并：完整过程展开后，相邻的多个 tool 先收成一行
 * 「N 个工具 · a · b」，点开再看每条详情，避免一次读十个文件时刷屏。
 */
const ToolGroupRow = React.memo(function ToolGroupRow({
  tools,
}: {
  tools: ToolBlock[];
}): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [open, setOpen] = React.useState(false);
  const names = Array.from(new Set(tools.map((tool) => tool.name)));
  const errors = tools.filter((tool) => tool.state === 'error').length;
  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={open ? '收起工具组' : '展开工具组'}
        style={styles.row}
      >
        <Text style={styles.rowGlyph}>▤</Text>
        <Text style={styles.toolGroupTitle}>{tools.length} 个工具</Text>
        <Text style={styles.rowText} numberOfLines={1}>
          {names.join(' · ')}
        </Text>
        {errors > 0 ? <Text style={[styles.rowState, { color: palette.danger }]}>×{errors}</Text> : null}
        <Text style={styles.chevron}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open ? tools.map((tool) => <ToolRow key={tool.id} block={tool} />) : null}
    </View>
  );
});

type ProcessEntry =
  | { kind: 'block'; block: Block; key: string }
  | { kind: 'tools'; tools: ToolBlock[]; key: string };

/** 相邻 tool 长度 >=2 才合并；单独的 tool 保持原样 */
function groupProcessBlocks(blocks: Block[]): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  let run: ToolBlock[] = [];
  const flush = (): void => {
    if (run.length >= 2) entries.push({ kind: 'tools', tools: run, key: `tools-${run[0]?.id ?? ''}` });
    else if (run.length === 1 && run[0]) entries.push({ kind: 'block', block: run[0], key: run[0].id });
    run = [];
  };
  for (const block of blocks) {
    if (block.kind === 'tool') {
      run.push(block);
      continue;
    }
    flush();
    entries.push({ kind: 'block', block, key: block.id });
  }
  flush();
  return entries;
}

function renderBlock(
  block: Block,
  approvals: Record<string, Approval>,
  onToggleThinking?: () => void,
  live?: boolean,
  fontScale = 1
): React.ReactElement | null {
  switch (block.kind) {
    case 'thinking':
      return (
        <ThinkingRow key={block.id} text={block.text} onToggle={onToggleThinking} live={live} />
      );
    case 'tool':
      return <ToolRow key={block.id} block={block} />;
    case 'text':
      return <MarkdownView key={block.id} text={block.text} streaming={live} fontScale={fontScale} />;
    case 'approval': {
      const approval = approvals[block.approvalId];
      return approval ? <ApprovalCard key={block.id} approval={approval} /> : null;
    }
    case 'capability':
      return <CapabilityCard key={block.id} block={block} />;
    default:
      return null;
  }
}

function AssistantActions({ text }: { text: string }): React.ReactElement | null {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
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
        <Text style={[styles.actionGlyph, copied && { color: palette.ok }]}>{copied ? '✓' : '⧉'}</Text>
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
  expandProcess,
  fontScale = 1,
}: {
  turn: Turn;
  approvals: Record<string, Approval>;
  onToggleThinking?: () => void;
  fallbackDurationMs?: number;
  /** 外观设置「完成后收起过程」关掉时，完成的回合默认展开思考/工具 */
  expandProcess?: boolean;
  /** U7 对话字号倍率 */
  fontScale?: number;
}): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  const [open, setOpen] = React.useState(expandProcess === true);
  const completed = turn.status !== 'streaming';
  const visibleBlocks = React.useMemo(
    () => turn.blocks.filter((b) => !(b.kind === 'thinking' && !b.text.trim())),
    [turn.blocks],
  );
  const processBlocks = React.useMemo(
    () => visibleBlocks.filter((b) => b.kind === 'thinking' || b.kind === 'tool'),
    [visibleBlocks],
  );
  const processEntries = React.useMemo(() => groupProcessBlocks(processBlocks), [processBlocks]);
  const answerBlocks = React.useMemo(
    () => turn.blocks.filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text'),
    [turn.blocks],
  );
  // 审批/能力卡是"必须看见"的动作卡，不跟着完整过程折叠
  const noticeBlocks = React.useMemo(
    () => visibleBlocks.filter((b) => b.kind === 'approval' || b.kind === 'capability'),
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
        processEntries.map((entry) =>
          entry.kind === 'tools' ? (
            <ToolGroupRow key={entry.key} tools={entry.tools} />
          ) : (
            <React.Fragment key={entry.key}>
              {renderBlock(entry.block, approvals, onToggleThinking, false, fontScale)}
            </React.Fragment>
          ),
        )}

      {completed
        ? [
            ...noticeBlocks.map((b, i) => (
              <React.Fragment key={`notice-${b.id}-${i}`}>
                {renderBlock(b, approvals, onToggleThinking, undefined, fontScale)}
              </React.Fragment>
            )),
            ...answerBlocks.map((b, i) => (
              <React.Fragment key={`${b.id}-${i}`}>
                {renderBlock(b, approvals, onToggleThinking, undefined, fontScale)}
              </React.Fragment>
            )),
          ]
        : visibleBlocks.map((b, i) => (
            <React.Fragment key={`${b.id}-${i}`}>
              {renderBlock(
                b,
                approvals,
                onToggleThinking,
                turn.status === 'streaming' && i === visibleBlocks.length - 1,
                fontScale
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
  expandProcess,
  fontScale = 1,
}: {
  turn: Turn;
  approvals: Record<string, Approval>;
  onToggleThinking?: () => void;
  fallbackDurationMs?: number;
  expandProcess?: boolean;
  fontScale?: number;
}): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  if (turn.role === 'user') {
    const text = turn.blocks
      .map((b) => (b.kind === 'text' ? b.text : ''))
      .join('')
      .trim();
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text
            style={[
              styles.userText,
              fontScale !== 1 && { fontSize: 14 * fontScale, lineHeight: 22 * fontScale },
            ]}
          >
            {text}
          </Text>
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
      expandProcess={expandProcess}
      fontScale={fontScale}
    />
  );
}

export const TurnView = React.memo(TurnViewImpl);

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
  userRow: { alignItems: 'flex-end' },
  userBubble: {
    backgroundColor: c.bubble,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
    maxWidth: '84%',
  },
  userText: { color: c.text, fontSize: 14, lineHeight: 22 },

  assistant: { gap: 8 },
  summary: {
    paddingVertical: 8,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  summaryCheck: { color: c.ok, fontSize: 12, fontWeight: '700' },
  summaryTitle: { color: c.text, fontSize: 13, fontWeight: '600' },
  summaryDuration: { color: c.textDim, fontSize: 12 },
  summarySub: { color: c.textFaint, fontSize: 11.5, lineHeight: 16 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 2 },
  actionGlyph: { color: c.textFaint, fontSize: 15 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 2 },
  rowGlyph: { color: c.textFaint, fontSize: 11 },
  rowText: { color: c.textDim, fontSize: 13, flex: 1 },
  rowTextLive: { fontSize: 12, lineHeight: 17 },
  toolGroupTitle: { color: c.textDim, fontSize: 12, fontWeight: '600' },
  thinkingLabel: { color: c.textFaint, fontSize: 13 },
  toolName: { color: c.textFaint, fontSize: 11, fontFamily: font.mono },
  rowState: { fontSize: 11 },
  chevron: { color: c.textFaint, fontSize: 11 },

  thinkingOpenBox: {
    gap: 6,
    paddingVertical: 2,
  },
  thinkingActive: { color: c.blue },
  liveDot: { color: c.blue, fontSize: 8, paddingHorizontal: 2 },
  thinkingBodyWrap: {
    marginLeft: 18,
    paddingLeft: 12,
    paddingBottom: 6,
    borderLeftWidth: 2,
    borderLeftColor: c.border,
  },
  thinkingScroll: {
    maxHeight: 320,
    marginLeft: 18,
    paddingLeft: 12,
    paddingBottom: 6,
    borderLeftWidth: 2,
    borderLeftColor: c.border,
  },
  thinkingBody: { color: c.textDim, fontSize: 12.5, lineHeight: 19 },
  thinkingMore: { color: c.textFaint, fontSize: 11, lineHeight: 16, paddingTop: 6 },
  toolDetail: {
    marginLeft: 18,
    marginTop: 2,
    marginBottom: 4,
    padding: 8,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.bgElevated,
  },
  toolDetailText: { color: c.textDim, fontFamily: font.mono, fontSize: 11.5, lineHeight: 17 },
});
