import React from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Approval, Block, SessionDetail, Turn } from '../protocol';
import { store, useStore } from './useStore';
import { Btn, Dot, IconButton, Pill } from './parts';
import { Composer } from './Composer';
import { SmoothKeyboardAvoid } from './SmoothKeyboardAvoid';
import { MarkdownView } from './MarkdownView';
import { ModelSheet } from './ModelSheet';
import { pickAttachments } from '../lib/pickImage';
import { colors, font, radius, riskTone, semantic, space, topInset } from './theme';

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

/**
 * 提问卡片：官方卡片的样子——推荐选项竖排（带说明）、可以自己输入、也可以跳过。
 * dsh 的答案 schema 本来就有 custom 字段，之前只用了 selected。
 */
function QuestionActions({ approval }: { approval: Approval }): React.ReactElement {
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
          placeholderTextColor={colors.textFaint}
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
function ApprovalCard({ approval }: { approval: Approval }): React.ReactElement {
  const tone = riskTone(approval.risk);
  const isQuestion = approval.kind === 'question';
  return (
    <View style={styles.approval}>
      <View style={styles.approvalHead}>
        <Text style={styles.approvalTitle}>{approval.title}</Text>
        <View style={[styles.chip, { backgroundColor: tone.bg }]}>
          <Text style={[styles.chipText, { color: tone.color }]}>{isQuestion ? '等你选' : tone.label}</Text>
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

      {isQuestion ? (
        <QuestionActions approval={approval} />
      ) : (
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
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 块
 * ------------------------------------------------------------------ */

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

function TurnView({
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
  return (
    <View style={styles.assistant}>
      {turn.blocks.map((b) => renderBlock(b, approvals, onToggleThinking))}
      {turn.status === 'stopped' ? <Text style={styles.turnMeta}>已停止</Text> : null}
      {hasDoneDuration ? (
        <Text style={styles.turnMeta}>
          {(turn.meta!.durationMs! / 1000).toFixed(0)} 秒 · {turn.meta?.steps ?? 1} 步
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
  const nearBottom = React.useRef(true);
  const userInteracting = React.useRef(false);
  const preset = state.caps?.presets.find((p) => p.id === session.presetId);
  const running = session.status === 'running' || session.status === 'waiting_approval';

  // 从分享菜单带进来的图片：进到会话里就传上去
  React.useEffect(() => {
    if (state.pendingShare?.imagePath) void store.attachSharedImage();
  }, [session.id, state.pendingShare?.imagePath]);
  const hasText = draft.trim().length > 0;

  // 头部模型徽标：优先会话自己选的，其次宿主默认；名字太长就把 DeepSeek- 前缀砍掉
  const activeModel = session.model ?? state.defaultModel;
  const shortModelName = React.useMemo(() => {
    if (!activeModel) return null;
    const found = state.models.find((m) => m.provider === activeModel.provider && m.id === activeModel.model);
    return (found?.name ?? activeModel.model).replace(/^DeepSeek-?/i, '') || activeModel.model;
  }, [activeModel, state.models]);

  React.useEffect(() => {
    const onShow = (): void => {
      if (nearBottom.current) {
        // 零延迟瞬间对齐到底部，跟随外层平滑动画同步上推，绝不慢半拍
        scrollRef.current?.scrollToEnd({ animated: false });
      }
    };
    const willShowSub = Keyboard.addListener('keyboardWillShow', onShow);
    const didShowSub = Keyboard.addListener('keyboardDidShow', onShow);
    return () => {
      willShowSub.remove();
      didShowSub.remove();
    };
  }, []);

  const handleToggleThinking = (): void => {
    userInteracting.current = true;
    setTimeout(() => {
      userInteracting.current = false;
    }, 400);
  };

  const send = (): void => {
    const hasAttachments = state.pendingAttachments.length > 0;
    if (running && !hasText && !hasAttachments) {
      void store.stop();
      return;
    }
    if (!hasText && !hasAttachments) return;
    const text = draft.trim();
    setDraft('');
    void store.send(text);
  };

  return (
    <View style={styles.root}>
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
        <Pill onPress={() => store.openModelSheet()} style={styles.presetPill}>
          <Text style={styles.presetText} numberOfLines={1}>
            {shortModelName ?? '模型'}
          </Text>
        </Pill>
        <View style={{ flex: 1 }} />
        <IconButton
          glyph="✎"
          label="新建会话"
          onPress={() => void store.createSession(session.presetId)}
        />
      </View>

      <SmoothKeyboardAvoid style={styles.bodyWrap}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollOuter}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 140;
          }}
          scrollEventThrottle={64}
          onLayout={() => {
            if (nearBottom.current && !userInteracting.current) {
              // 伴随视口高度压缩实时定位，与输入框同帧贴合上移
              scrollRef.current?.scrollToEnd({ animated: false });
            }
          }}
          onContentSizeChange={() => {
            if (nearBottom.current && !userInteracting.current) {
              scrollRef.current?.scrollToEnd({ animated: false });
            }
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.scroll}>
            {session.turns.length === 0 ? (
              <View style={styles.emptyChat}>
                <Text style={styles.emptyChatTitle}>{preset?.name ?? '新会话'}</Text>
                <Text style={styles.emptyChatText}>{preset?.tagline ?? '说点什么开始'}</Text>
              </View>
            ) : (
              session.turns.map((t) => (
                <TurnView
                  key={t.id}
                  turn={t}
                  approvals={state.approvals}
                  onToggleThinking={handleToggleThinking}
                />
              ))
            )}
          </View>
        </ScrollView>

        {Boolean(state.error) ? (
          <Pressable onPress={() => store.clearError()}>
            <Text style={styles.error}>{state.error}</Text>
          </Pressable>
        ) : null}

        <ModelSheet />
        <Composer
          draft={draft}
          onChangeDraft={setDraft}
          onSend={send}
          onStop={() => void store.stop()}
          running={running}
          canStop={state.caps?.actions.includes('stop') ?? false}
          canSteer={state.caps?.actions.includes('steer') ?? false}
          placeholder={
            running
              ? state.caps?.actions.includes('steer')
                ? '生成中 · 可直接插话'
                : '生成中 · 等这一轮跑完'
              : '给锦囊发消息…'
          }
          presets={state.caps?.presets ?? []}
          activePresetId={session.presetId}
          // 真宿主没有会话内换预设的接口（capabilities.actions 里没有就不显示）
          showPresets={state.caps?.actions.includes('switch_preset') ?? false}
          onPickPreset={(id) => void store.setPreset(id)}
          permissions={state.permissions}
          activePermission={session.permission ?? state.defaultPermission}
          onPickPermission={(value) => void store.setPermission(value)}
          attachments={state.pendingAttachments}
          onRemoveAttachment={(id) => store.removeAttachment(id)}
          onPickAttachment={(kind) => {
            void (async () => {
              try {
                const list = await pickAttachments(kind);
                for (const item of list) {
                  await store.uploadAttachment(item.base64, item.name, item.kind ?? kind);
                }
              } catch (err) {
                store.setError(err instanceof Error ? err.message : String(err));
              }
            })();
          }}
        />
      </SmoothKeyboardAvoid>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: topInset },
  bodyWrap: { flex: 1 },

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
  userText: { color: colors.text, fontSize: 14, lineHeight: 22 },

  assistant: { gap: 8 },
  body: { color: colors.text, fontSize: 14, lineHeight: 22 },
  inlineCode: {
    fontFamily: font.mono,
    fontSize: 13,
    color: colors.text,
    backgroundColor: semantic.codeInline,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  turnMeta: { color: colors.textFaint, fontSize: 10.5 },

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
  thinkingBody: {
    color: colors.textDim,
    fontSize: 12.5,
    lineHeight: 19,
  },

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

  /* 提问卡片 */
  qWrap: { gap: 8, marginTop: 4 },
  qOption: {
    backgroundColor: colors.glass,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  qOptionPressed: { backgroundColor: colors.glassStrong },
  qOptionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qOptionLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  qRecommend: {
    color: colors.blue,
    fontSize: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.blue,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  qOptionDesc: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  qInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 2 },
  qInput: {
    flex: 1,
    backgroundColor: colors.glass,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    color: colors.text,
    fontSize: 13.5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxHeight: 96,
  },
  qSend: {
    backgroundColor: colors.blue,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  qSendText: { color: '#0b1220', fontSize: 13, fontWeight: '600' },
  qSkip: { alignSelf: 'flex-start', paddingVertical: 4 },
  qSkipText: { color: colors.textFaint, fontSize: 12.5 },
  codeBox: { backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: radius.sm, padding: 9, gap: 1 },
  codeText: { fontFamily: font.mono, fontSize: 11.5, color: colors.textDim, lineHeight: 17 },
  approvalActions: { flexDirection: 'row', gap: space.sm, marginTop: 2 },

  emptyChat: { paddingTop: 80, alignItems: 'center', gap: 6 },
  emptyChatTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  emptyChatText: { color: colors.textFaint, fontSize: 12.5 },

  error: { color: colors.danger, fontSize: 12, paddingHorizontal: space.lg, paddingBottom: 6 },
});
