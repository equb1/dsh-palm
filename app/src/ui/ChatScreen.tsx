import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Approval, Block, SessionDetail, Turn } from '../protocol';
import { store, useStore } from './useStore';
import { Btn, Dot, IconButton, Pill } from './parts';
import { Composer } from './Composer';
import { colors, font, radius, riskTone, space, topInset } from './theme';

/* ------------------------------------------------------------------ *
 * 行内格式：**粗体** 和 `代码`
 * ------------------------------------------------------------------ */

function Inline({ text, style }: { text: string; style?: object }): React.ReactElement {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((s) => s.length > 0);
  return (
    <Text style={style}>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return (
            <Text key={i} style={{ fontWeight: '700' }}>
              {p.slice(2, -2)}
            </Text>
          );
        }
        if (p.startsWith('`') && p.endsWith('`')) {
          return (
            <Text key={i} style={styles.inlineCode}>
              {p.slice(1, -1)}
            </Text>
          );
        }
        return <Text key={i}>{p}</Text>;
      })}
    </Text>
  );
}

/* ------------------------------------------------------------------ *
 * 审批卡
 * ------------------------------------------------------------------ */

function ApprovalCard({ approval }: { approval: Approval }): React.ReactElement {
  const tone = riskTone(approval.risk);
  return (
    <View style={styles.approval}>
      <View style={styles.approvalHead}>
        <Text style={styles.approvalTitle}>{approval.title}</Text>
        <View style={[styles.chip, { backgroundColor: tone.bg }]}>
          <Text style={[styles.chipText, { color: tone.color }]}>{tone.label}</Text>
        </View>
      </View>

      {approval.command ? (
        <View style={styles.codeBox}>
          <Text style={styles.codeText}>{approval.command}</Text>
        </View>
      ) : null}

      <Text style={styles.approvalSummary}>{approval.summary}</Text>

      {approval.diff ? (
        <View style={styles.codeBox}>
          {approval.diff.split('\n').map((line, i) => (
            <Text
              key={i}
              style={[
                styles.codeText,
                line.startsWith('+') && { color: colors.ok },
                line.startsWith('-') && { color: colors.danger },
              ]}
            >
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.approvalActions}>
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
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 块
 * ------------------------------------------------------------------ */

function ThinkingRow({ text, streaming }: { text: string; streaming?: boolean }): React.ReactElement {
  // 默认展开：思考内容要能读完，而不是只剩第一行。用户点了才收起。
  const [open, setOpen] = React.useState(true);
  const firstLine = text.split('\n')[0] ?? '';
  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      accessibilityRole="button"
      accessibilityLabel="展开或收起思考"
      style={styles.row}
    >
      <Text style={styles.rowGlyph}>✳</Text>
      <Text style={styles.thinkingLabel}>思考</Text>
      <Text style={styles.rowText} numberOfLines={open ? undefined : 1}>
        {open ? text : firstLine}
      </Text>
      <Text style={styles.chevron}>{open ? '▴' : '▾'}</Text>
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

function renderBlock(block: Block, approvals: Record<string, Approval>, streaming = false): React.ReactElement | null {
  switch (block.kind) {
    case 'thinking':
      return <ThinkingRow key={block.id} text={block.text} streaming={streaming} />;
    case 'tool':
      return <ToolRow key={block.id} block={block} />;
    case 'text':
      return <Inline key={block.id} text={block.text} style={styles.body} />;
    case 'approval': {
      const approval = approvals[block.approvalId];
      return approval ? <ApprovalCard key={block.id} approval={approval} /> : null;
    }
    default:
      return null;
  }
}

function TurnView({ turn, approvals }: { turn: Turn; approvals: Record<string, Approval> }): React.ReactElement {
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
    <View style={styles.assistant}>
      {turn.blocks.map((b) => renderBlock(b, approvals, turn.status === 'streaming'))}
      {turn.status === 'stopped' ? <Text style={styles.turnMeta}>已停止</Text> : null}
      {turn.status === 'done' && turn.meta?.durationMs ? (
        <Text style={styles.turnMeta}>
          {(turn.meta.durationMs / 1000).toFixed(0)} 秒 · {turn.meta.steps} 步
        </Text>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 会话页
 * ------------------------------------------------------------------ */

export function ChatScreen({ session }: { session: SessionDetail }): React.ReactElement {
  const state = useStore();
  const [draft, setDraft] = React.useState('');
  const scrollRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  // 用户手动往上翻时不要抢回来；停在底部时跟着流式输出走
  const nearBottom = React.useRef(true);
  const preset = state.caps?.presets.find((p) => p.id === session.presetId);
  const running = session.status === 'running' || session.status === 'waiting_approval';
  const hasText = draft.trim().length > 0;

  const send = (): void => {
    if (running && !hasText) {
      void store.stop();
      return;
    }
    if (!hasText) return;
    setDraft('');
    void store.send(draft.trim());
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior="padding"
    >
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回会话列表" onPress={() => store.closeSession()} />
        <Pill style={styles.titlePill}>
          <Text style={styles.titleText} numberOfLines={1}>
            {session.title}
          </Text>
          <View style={styles.titleMeta}>
            <Dot color={running ? colors.blue : colors.textFaint} size={5} />
            <Text style={styles.titleMetaText}>{running ? '生成中' : '就绪'}</Text>
          </View>
        </Pill>
        <Pill style={styles.presetPill}>
          <Text style={styles.presetText} numberOfLines={1}>
            {preset?.glyph ?? '·'} {preset?.name ?? session.presetId}
          </Text>
        </Pill>
        <View style={{ flex: 1 }} />
        <IconButton
          glyph="✎"
          label="新建会话"
          onPress={() => void store.createSession(session.presetId)}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollOuter}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 140;
        }}
        scrollEventThrottle={64}
        onContentSizeChange={() => {
          // 流式输出时时内容会一直长高；只在用户停在底部时才自动跟随
          if (nearBottom.current) scrollRef.current?.scrollToEnd({ animated: false });
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.scroll}>
          {session.turns.length === 0 ? (
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatTitle}>{preset?.name ?? '新会话'}</Text>
              <Text style={styles.emptyChatText}>{preset?.tagline ?? '说点什么开始'}</Text>
            </View>
          ) : (
            session.turns.map((t) => <TurnView key={t.id} turn={t} approvals={state.approvals} />)
          )}
        </View>
      </ScrollView>

      {state.error ? (
        <Pressable onPress={() => store.clearError()}>
          <Text style={styles.error}>{state.error}</Text>
        </Pressable>
      ) : null}

      <Composer
        draft={draft}
        onChangeDraft={setDraft}
        onSend={send}
        onStop={() => void store.stop()}
        running={running}
        placeholder={running ? '生成中 · 可直接插话' : '给锦囊发消息…'}
        presets={state.caps?.presets ?? []}
        activePresetId={session.presetId}
        onPickPreset={(id) => void store.setPreset(id)}
      />    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: topInset },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  titlePill: { flexShrink: 1, flexDirection: 'column', alignItems: 'flex-start', gap: 2, paddingVertical: 6 },
  titleText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  titleMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  titleMetaText: { color: colors.textFaint, fontSize: 10.5 },
  presetPill: { flexShrink: 1 },
  presetText: { color: colors.textDim, fontSize: 12 },

  scrollOuter: { paddingBottom: space.lg },
  scroll: { paddingHorizontal: space.lg, paddingTop: space.md, gap: 14 },

  userRow: { alignItems: 'flex-end' },
  userBubble: {
    backgroundColor: colors.bubble,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
    maxWidth: '84%',
  },
  userText: { color: colors.text, fontSize: 15, lineHeight: 23 },

  assistant: { gap: 8 },
  body: { color: colors.text, fontSize: 15, lineHeight: 25 },
  inlineCode: { fontFamily: font.mono, fontSize: 13, color: colors.text, backgroundColor: colors.glassStrong },
  turnMeta: { color: colors.textFaint, fontSize: 10.5 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 2 },
  rowGlyph: { color: colors.textFaint, fontSize: 11 },
  rowText: { color: colors.textDim, fontSize: 13, flex: 1 },
  thinkingLabel: { color: colors.textFaint, fontSize: 13 },
  toolName: { color: colors.textFaint, fontSize: 11, fontFamily: font.mono },
  rowState: { fontSize: 11 },
  chevron: { color: colors.textFaint, fontSize: 11 },

  approval: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    padding: 14,
    gap: 10,
  },
  approvalHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  approvalTitle: { color: colors.text, fontSize: 14.5, fontWeight: '600', flex: 1 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  chipText: { fontSize: 10.5, fontWeight: '600' },
  approvalSummary: { color: colors.textDim, fontSize: 12.5, lineHeight: 19 },
  codeBox: { backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: radius.sm, padding: 9, gap: 1 },
  codeText: { fontFamily: font.mono, fontSize: 11.5, color: colors.textDim, lineHeight: 17 },
  approvalActions: { flexDirection: 'row', gap: space.sm, marginTop: 2 },

  emptyChat: { paddingTop: 80, alignItems: 'center', gap: 6 },
  emptyChatTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  emptyChatText: { color: colors.textFaint, fontSize: 12.5 },

  error: { color: colors.danger, fontSize: 12, paddingHorizontal: space.lg, paddingBottom: 6 },
});
