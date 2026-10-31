import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Approval, Block, SessionDetail, Turn } from '../protocol';
import { store, useStore } from './useStore';
import { Btn, Chip, Mono } from './parts';
import { colors, font, radius, riskColor, riskLabel, space, topInset } from './theme';

/* ------------------------------------------------------------------ *
 * 极简行内格式：**粗体** 和 `代码`
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
            <Text key={i} style={{ fontFamily: font.mono, color: colors.gold }}>
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
 * 审批卡：只看这一屏就要能做决定
 * ------------------------------------------------------------------ */

function ApprovalCard({ approval }: { approval: Approval }): React.ReactElement {
  const color = riskColor(approval.risk);
  return (
    <View style={[styles.approval, { borderLeftColor: color }]}>
      <View style={styles.approvalHead}>
        <Chip label={riskLabel(approval.risk)} color={color} bg={`${color}22`} />
        <Text style={styles.approvalTitle}>{approval.title}</Text>
      </View>

      {approval.command ? (
        <View style={styles.codeBox}>
          <Mono style={{ color: colors.text }}>{approval.command}</Mono>
        </View>
      ) : null}

      <Text style={styles.approvalSummary}>{approval.summary}</Text>

      {approval.diff ? (
        <View style={styles.codeBox}>
          <Mono>{approval.diff}</Mono>
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
          kind="gold"
          onPress={() => void store.resolveApproval(approval.id, 'approve')}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 块渲染
 * ------------------------------------------------------------------ */

function ThinkingBlock({ text }: { text: string }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const firstLine = text.split('\n')[0] ?? '';
  return (
    <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityLabel="展开或收起思考">
      <View style={styles.thinking}>
        <Text style={styles.thinkingLabel}>思考</Text>
        <Text style={styles.thinkingText} numberOfLines={open ? undefined : 1}>
          {open ? text : firstLine}
        </Text>
      </View>
    </Pressable>
  );
}

function ToolRow({ block }: { block: Extract<Block, { kind: 'tool' }> }): React.ReactElement {
  const color = block.state === 'running' ? colors.blue : block.state === 'error' ? colors.danger : colors.ok;
  return (
    <View style={styles.tool}>
      <View style={[styles.toolDot, { backgroundColor: color }]} />
      <Text style={styles.toolName}>{block.name}</Text>
      <Text style={styles.toolSummary} numberOfLines={1}>
        {block.summary}
      </Text>
      <Text style={{ color, fontSize: 11 }}>{block.state === 'running' ? '…' : block.state === 'error' ? '×' : '✓'}</Text>
    </View>
  );
}

function renderBlock(block: Block, approvals: Record<string, Approval>): React.ReactElement | null {
  switch (block.kind) {
    case 'thinking':
      return <ThinkingBlock key={block.id} text={block.text} />;
    case 'tool':
      return <ToolRow key={block.id} block={block} />;
    case 'text':
      return (
        <Inline key={block.id} text={block.text} style={styles.body} />
      );
    case 'approval': {
      const approval = approvals[block.approvalId];
      if (!approval) return null;
      return <ApprovalCard key={block.id} approval={approval} />;
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
      {turn.blocks.map((b) => renderBlock(b, approvals))}
      {turn.status === 'streaming' ? <Text style={styles.cursor}>▍</Text> : null}
      {turn.status === 'stopped' ? <Text style={styles.stopped}>已停止</Text> : null}
      {turn.status === 'done' && turn.meta?.durationMs ? (
        <Text style={styles.meta}>
          {(turn.meta.durationMs / 1000).toFixed(1)}s · {turn.meta.steps} 步
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
  const preset = state.caps?.presets.find((p) => p.id === session.presetId);
  const running = session.status === 'running' || session.status === 'waiting_approval';

  const send = (): void => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void store.send(text);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={styles.header}>
        <Pressable onPress={() => store.closeSession()} accessibilityRole="button" accessibilityLabel="返回">
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {session.title}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {preset?.name ?? session.presetId}
            {running ? ' · 运行中' : ''}
            {session.contract.net === 'deny' ? ' · 禁网' : ''}
          </Text>
        </View>
        {running ? (
          <Pressable onPress={() => void store.stop()} accessibilityRole="button" accessibilityLabel="停止">
            <Text style={styles.stop}>停止</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollOuter}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.scroll}>
        {session.turns.length === 0 ? (
          <View style={styles.emptyChat}>
            <Text style={styles.emptyChatTitle}>{preset?.name ?? '新会话'}</Text>
            <Text style={styles.emptyChatText}>{preset?.tagline}</Text>
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

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={running ? '运行中，输入即插话…' : '说点什么…'}
          placeholderTextColor={colors.faint}
          multiline
          accessibilityLabel="输入框"
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim()}
          accessibilityRole="button"
          accessibilityLabel={running ? '插话' : '发送'}
          style={({ pressed }) => [
            styles.send,
            { opacity: draft.trim() ? (pressed ? 0.7 : 1) : 0.35 },
          ]}
        >
          <Text style={styles.sendText}>{running ? '插' : '↑'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  back: { color: colors.dim, fontSize: 28, width: 24, marginTop: -4 },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  headerSub: { color: colors.faint, fontSize: 11, marginTop: 2 },
  stop: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  scrollOuter: { paddingBottom: space.xl },
  scroll: { padding: space.lg, gap: space.md },

  userRow: { alignItems: 'flex-end' },
  userBubble: {
    backgroundColor: colors.cardAlt,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.lg,
    maxWidth: '86%',
  },
  userText: { color: colors.text, fontSize: 15, lineHeight: 22 },

  assistant: { gap: 10 },
  body: { color: colors.text, fontSize: 15, lineHeight: 23 },
  cursor: { color: colors.gold, fontSize: 14, marginTop: -6 },

  thinking: { borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: 10, gap: 3 },
  thinkingLabel: { color: colors.faint, fontSize: 10, letterSpacing: 1 },
  thinkingText: { color: colors.dim, fontSize: 12, lineHeight: 18 },

  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  toolDot: { width: 6, height: 6, borderRadius: 3 },
  toolName: { color: colors.dim, fontSize: 11, fontFamily: font.mono },
  toolSummary: { color: colors.text, fontSize: 12, flex: 1 },

  approval: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    padding: space.md,
    gap: 10,
  },
  approvalHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  approvalTitle: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  approvalSummary: { color: colors.dim, fontSize: 12, lineHeight: 18 },
  codeBox: {
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    padding: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  approvalActions: { flexDirection: 'row', gap: space.sm, marginTop: 2 },

  stopped: { color: colors.faint, fontSize: 11 },
  meta: { color: colors.faint, fontSize: 10 },

  emptyChat: { paddingTop: space.xxl, alignItems: 'center', gap: 6 },
  emptyChatTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  emptyChatText: { color: colors.faint, fontSize: 12 },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: '#1A1408', fontSize: 16, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 12, paddingHorizontal: space.lg, paddingBottom: 6 },
});
