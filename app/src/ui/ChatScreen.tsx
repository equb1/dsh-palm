import React from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { SessionDetail, Turn } from '../protocol';
import { store, useStore } from './useStore';
import { IconButton, Pill } from './parts';
import { EngineBadge } from './EngineBadge';
import { badgeFor, canSwitch } from '../state/engineManager';
import { isConversationReadOnly, stripEngineNoticeTurns } from '../lib/handoff';
import { Composer } from './Composer';
import { SmoothKeyboardAvoid } from './SmoothKeyboardAvoid';
import { ModelSheet } from './ModelSheet';
import { GeneratedFilesSheet } from './GeneratedFilesSheet';
import { collectGeneratedFiles } from '../lib/generatedFiles';
import { TurnView, JumpButton } from './chat';
import type { AttachmentKind } from '../lib/attachments/types';
import { radius, space, topInset, useThemedStyles, type Theme } from './theme';

/* ------------------------------------------------------------------ *
 * 会话页
 * ------------------------------------------------------------------ */

function TurnSeparator(): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  return <View style={styles.turnSeparator} />;
}

export function ChatScreen({ session }: { session: SessionDetail }): React.ReactElement {
  const state = useStore();
  const styles = useThemedStyles(createStyles);
  const [draft, setDraft] = React.useState('');
  const [showJump, setShowJump] = React.useState(false);
  const [filesOpen, setFilesOpen] = React.useState(false);
  const [selectionResetKey, setSelectionResetKey] = React.useState(0);
  // 浮动顶栏：先量高度给正文留位，列表滚起来再加底色/描边（玻璃感用半透明近似，不引原生 blur）
  // 先给顶栏一个稳定高度，避免首帧 onLayout 后列表整体下跳；实际高度仍以 onLayout 为准。
  const [headerH, setHeaderH] = React.useState(Math.round(topInset + 52));
  const [scrolled, setScrolled] = React.useState(false);
  const listRef = React.useRef<FlatList<Turn>>(null);
  const following = React.useRef(true);
  const scrollScheduled = React.useRef(false);
  const scrollFrame = React.useRef<number | null>(null);
  const viewportHeight = React.useRef(0);
  const contentHeight = React.useRef(0);
  const distanceFromAnswers = React.useRef(0);
  const touchActive = React.useRef(false);
  const userDragging = React.useRef(false);
  const programmaticUntil = React.useRef(0);
  const preset = state.caps?.presets.find((p) => p.id === session.presetId);
  const running = session.status === 'running' || session.status === 'waiting_approval';
  const engineBadge = badgeFor(state.engine);
  const engineSwitch = canSwitch(state.engine);
  // M2.7：轻引擎 401（账号 token 过期）时给一条可行动的恢复路径
  const needsAuthRecovery =
    state.engineKind === 'light' &&
    Boolean(state.error) &&
    /(401|登录|API Key|凭据|token)/i.test(state.error ?? '');
  // 逻辑会话按 activeSide 判断只读：完整侧链路断了就只读，绝不在轻引擎里重放
  const link = state.links.find(
    (item) =>
      item.id === session.id ||
      item.lightSessionId === session.id ||
      item.fullSessionId === session.id,
  );
  const readOnly = link ? isConversationReadOnly(link, state.engine.mode) : !state.currentId;
  const readOnlyText =
    link?.activeSide === 'full' && state.engine.mode !== 'full'
      ? '完整引擎已停止，这个会话只读；点这里切到完整模式继续 ›'
      : '已切换引擎，这个会话只读；点这里切回原引擎继续 ›';
  // M2.6：只读横幅一键回到会话所在的引擎并重开（完整侧会先起 proot）
  const resumeOnActiveSide = React.useCallback((): void => {
    if (!link) {
      store.closeSession();
      return;
    }
    const target = link.activeSide === 'full' ? 'full' : 'light';
    if (target === state.engine.mode) {
      void store.openSession(link.id);
      return;
    }
    void store.switchEngine(target).then((ok) => {
      if (ok) void store.openSession(link.id);
    });
  }, [link, state.engine.mode]);
  // 完整引擎在切 approval policy 时会写一条 user 角色提示，原生完整会话也不显示（I9）
  const turns = React.useMemo(
    () => (state.engineKind === 'remote' ? stripEngineNoticeTurns(session.turns) : session.turns),
    [session.turns, state.engineKind],
  );
  // 生成文件面板：只解析当前会话的工具结果，不额外请求宿主
  const generatedFiles = React.useMemo(() => collectGeneratedFiles(session.turns), [session.turns]);
  let lastAssistantIndex = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role === 'assistant') {
      lastAssistantIndex = i;
      break;
    }
  }

  // 系统分享进来的文件已由 store 收进待发列表，这里不用再单独处理
  const hasText = draft.trim().length > 0;

  // 头部模型徽标：优先会话自己选的，其次宿主默认；名字太长就把 DeepSeek- 前缀砍掉
  const activeModel = session.model ?? state.defaultModel;
  const shortModelName = React.useMemo(() => {
    if (!activeModel) return null;
    const found = state.models.find((m) => m.provider === activeModel.provider && m.id === activeModel.model);
    return (found?.name ?? activeModel.model).replace(/^DeepSeek-?/i, '') || activeModel.model;
  }, [activeModel, state.models]);
  const effortName = React.useMemo(() => {
    if (!activeModel) return null;
    const found = state.models.find((m) => m.provider === activeModel.provider && m.id === activeModel.model);
    const id = activeModel.reasoningEffort ?? found?.defaultEffort;
    return found?.efforts?.find((e) => e.id === id)?.name ?? null;
  }, [activeModel, state.models]);

  const scrollToLatest = React.useCallback((animated = false, force = false): void => {
    if (!force && !following.current) return;
    if (scrollScheduled.current) return;
    scrollScheduled.current = true;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollScheduled.current = false;
      scrollFrame.current = null;
      if (!force && !following.current) return;
      const offset = Math.max(0, contentHeight.current - viewportHeight.current);
      programmaticUntil.current = Date.now() + (animated ? 700 : 150);
      listRef.current?.scrollToOffset({ offset, animated });
    });
  }, []);

  React.useEffect(() => {
    const onShow = (): void => scrollToLatest(true);
    const willShowSub = Keyboard.addListener('keyboardWillShow', onShow);
    const didShowSub = Keyboard.addListener('keyboardDidShow', onShow);
    return () => {
      willShowSub.remove();
      didShowSub.remove();
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    };
  }, [scrollToLatest]);

  const handleListLayout = React.useCallback(
    (event: LayoutChangeEvent): void => {
      viewportHeight.current = event.nativeEvent.layout.height;
      scrollToLatest(false);
    },
    [scrollToLatest],
  );

  const handleContentSizeChange = React.useCallback(
    (_width: number, height: number): void => {
      contentHeight.current = height;
      scrollToLatest(false);
    },
    [scrollToLatest],
  );

  const handleScroll = React.useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const distance = Math.max(
        0,
        contentSize.height - contentOffset.y - layoutMeasurement.height,
      );
      distanceFromAnswers.current = distance;
      // 只有列表真实收到触摸后才认拖拽，避免测量修正/程序滚动误冻结追底。
      if (userDragging.current && distance > 24) following.current = false;
      const nextJump = distance > 220;
      setShowJump((current) => (current === nextJump ? current : nextJump));
      const nextScrolled = contentOffset.y > 8;
      setScrolled((current) => (current === nextScrolled ? current : nextScrolled));
    },
    [],
  );

  const handleTouchStart = React.useCallback((): void => {
    touchActive.current = true;
    programmaticUntil.current = 0;
    setSelectionResetKey((k) => k + 1);
  }, []);

  const handleTouchEnd = React.useCallback((): void => {
    touchActive.current = false;
  }, []);

  const handleScrollBeginDrag = React.useCallback((): void => {
    if (!touchActive.current) return;
    userDragging.current = true;
    if (distanceFromAnswers.current > 24) following.current = false;
  }, []);

  const handleMomentumBegin = React.useCallback((): void => {
    if (Date.now() < programmaticUntil.current) return;
    userDragging.current = true;
  }, []);

  const handleScrollSettled = React.useCallback((): void => {
    userDragging.current = false;
    if (distanceFromAnswers.current <= 24) {
      following.current = true;
      setShowJump(false);
    }
  }, []);

  const handleToggleThinking = React.useCallback((): void => {}, []);

  const pendingRewind = React.useRef<{ turnId: string } | null>(null);

  const handlePressUserTurn = React.useCallback(
    (turn: Turn, text: string): void => {
      // 点击只回填，不立刻重跑；点发送时才截断并重试这一轮
      pendingRewind.current = { turnId: turn.id };
      setDraft(text);
    },
    [],
  );

  // 换会话时丢掉待重试的回合，避免发到新会话里
  React.useEffect(() => {
    pendingRewind.current = null;
  }, [session.id]);

  const send = (): void => {
    const hasAttachments = state.pendingAttachments.length > 0;
    if (running && !hasText && !hasAttachments) {
      void store.stop();
      return;
    }
    if (!hasText && !hasAttachments) return;
    if (readOnly) {
      store.setError('已切换引擎，这个会话只读；回首页新建会话继续。');
      return;
    }
    const text = draft.trim();
    const rewind = pendingRewind.current;
    if (rewind) {
      // 有回填标记：这一次发送先回退到该回合之前，再带上（可编辑的）文本重试
      pendingRewind.current = null;
      void store.rewindAndRerun(rewind.turnId, text).then((ok) => {
        if (ok) setDraft((current) => (current === draft ? '' : current));
        else {
          pendingRewind.current = rewind;
          setDraft((current) => (current.trim().length > 0 ? current : text));
        }
      });
      return;
    }
    // 发送成功才清空草稿；失败时把用户这句话放回去
    void store.send(text).then((ok) => {
      if (ok) setDraft((current) => (current === draft ? '' : current));
      else setDraft((current) => (current.trim().length > 0 ? current : text));
    });
  };

  const renderTurn = React.useCallback(
    ({ item, index }: { item: Turn; index: number }): React.ReactElement => (
      <TurnView
        turn={item}
        approvals={state.approvals}
        onToggleThinking={handleToggleThinking}
        onPressUserTurn={handlePressUserTurn}
        expandProcess={!state.collapseProcess}
        fontScale={state.chatFontScale}
        selectionResetKey={selectionResetKey}
        fallbackDurationMs={
          index === lastAssistantIndex && item.status !== 'streaming' && session.updatedAt > item.createdAt
            ? session.updatedAt - item.createdAt
            : undefined
        }
      />
    ),
    [handlePressUserTurn, handleToggleThinking, lastAssistantIndex, selectionResetKey, session.updatedAt, state.approvals, state.chatFontScale, state.collapseProcess],
  );

  const renderEmpty = React.useCallback(
    (): React.ReactElement => (
      <View style={styles.emptyChat}>
        {state.detailLoading ? (
          <>
            <Text style={styles.emptyChatTitle}>正在打开会话…</Text>
            <Text style={styles.emptyChatText}>消息马上到</Text>
          </>
        ) : (
          <>
            <Text style={styles.emptyChatTitle}>{preset?.name ?? '新会话'}</Text>
            <Text style={styles.emptyChatText}>{preset?.tagline ?? '说点什么开始'}</Text>
          </>
        )}
      </View>
    ),
    [preset?.name, preset?.tagline, state.detailLoading, styles],
  );

  return (
    <View style={styles.root}>
      <View
        style={[styles.header, scrolled && styles.headerScrolled]}
        onLayout={(event) => {
          const next = Math.round(event.nativeEvent.layout.height);
          setHeaderH((current) => (current === next ? current : next));
        }}
      >
        <IconButton icon="back" label="返回会话列表" onPress={() => store.closeSession()} />
        <Pill style={styles.titlePill}>
          <Text style={styles.titleText} numberOfLines={1}>
            {session.title}
          </Text>
        </Pill>
        <Pill onPress={() => store.openModelSheet()} style={styles.presetPill}>
          <Text style={styles.presetText} numberOfLines={1}>
            {shortModelName ?? '模型'}
            {effortName ? ` · ${effortName}` : ''}
          </Text>
        </Pill>
        <EngineBadge
          kind={engineBadge.kind}
          label={engineBadge.label}
          onPress={
            engineSwitch.ok
              ? () => {
                  void store.switchEngine(state.engine.mode === 'light' ? 'full' : 'light');
                }
              : undefined
          }
        />
        <IconButton icon="folderOpen" label="生成文件" onPress={() => setFilesOpen(true)} />
        <View style={{ flex: 1 }} />
      </View>

      <SmoothKeyboardAvoid style={[styles.bodyWrap, { marginTop: headerH }]}>
        {readOnly ? (
          <Pressable onPress={resumeOnActiveSide}>
            <Text style={styles.readOnly}>{readOnlyText}</Text>
          </Pressable>
        ) : null}
        <View style={styles.listWrap}>
          <FlatList
            ref={listRef}
            style={styles.list}
            data={turns}
            renderItem={renderTurn}
            keyExtractor={(turn, index) => `${turn.id ?? turn.runId ?? 'turn'}#${index}`}
            extraData={state.approvals}
            ItemSeparatorComponent={TurnSeparator}
            ListEmptyComponent={renderEmpty}
            contentContainerStyle={styles.listContent}
            onLayout={handleListLayout}
            onContentSizeChange={handleContentSizeChange}
            onScroll={handleScroll}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onScrollBeginDrag={handleScrollBeginDrag}
            onMomentumScrollBegin={handleMomentumBegin}
            onScrollEndDrag={handleScrollSettled}
            onMomentumScrollEnd={handleScrollSettled}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={9}
            updateCellsBatchingPeriod={32}
            removeClippedSubviews={false}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          />

          <View style={styles.jumpWrap} pointerEvents="box-none">
            <JumpButton
              visible={showJump}
              running={running}
              onPress={() => {
                following.current = true;
                userDragging.current = false;
                setShowJump(false);
                scrollToLatest(true, true);
              }}
            />
          </View>
        </View>

        {Boolean(state.error) ? (
          <View style={styles.errorCard}>
            <View style={styles.errorGlyphWrap}>
              <Text style={styles.errorGlyph}>!</Text>
            </View>
            <Text style={styles.errorText} numberOfLines={3}>
              {state.error}
            </Text>
            {needsAuthRecovery ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="重新登录"
                onPress={() => void store.recoverLightAuth()}
                style={({ pressed }) => [styles.errorAction, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.errorActionText}>重新登录</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭错误提示"
              onPress={() => store.clearError()}
              hitSlop={8}
              style={({ pressed }) => [styles.errorClose, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.errorCloseText}>×</Text>
            </Pressable>
          </View>
        ) : null}

        <ModelSheet />
        <GeneratedFilesSheet
          visible={filesOpen}
          files={generatedFiles}
          onClose={() => setFilesOpen(false)}
        />
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
          // 真宿主没有会话内换预设的接口时，只显示当前锦囊，不给点
          showPresets={(state.caps?.presets?.length ?? 0) > 0}
          presetsInteractive={state.caps?.actions.includes('switch_preset') ?? false}
          onPickPreset={(id) => void store.setPreset(id)}
          permissions={state.permissions}
          activePermission={session.permission ?? state.defaultPermission}
          onPickPermission={(value) => void store.setPermission(value)}
          attachments={state.pendingAttachments}
          attaching={state.attaching}
          onRemoveAttachment={(id) => store.removeAttachment(id)}
          onPickAttachment={(kind: AttachmentKind) => {
            void store.attachFromPicker(kind);
          }}
        />
      </SmoothKeyboardAvoid>
    </View>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg, paddingTop: topInset },
  bodyWrap: { flex: 1 },

  header: {
    position: 'absolute',
    // 绝对定位以 padding box 为基准，root 的 paddingTop 不会自动生效，这里显式加安全区
    top: topInset,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    // 玻璃感近似：半透明白；列表滚到下面时再加深并补描边/投影
    backgroundColor: c.headerOverlay,
  },
  headerScrolled: {
    backgroundColor: c.headerSolid,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    elevation: 3,
    shadowColor: c.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  titlePill: { flexShrink: 1, paddingVertical: 3 },
  titleText: { color: c.text, fontSize: 14, fontWeight: '600' },
  presetPill: { flexShrink: 1 },
  presetText: { color: c.textDim, fontSize: 12 },
  readOnly: {
    color: c.warn,
    fontSize: 11.5,
    lineHeight: 17,
    paddingHorizontal: space.lg,
    paddingBottom: 4,
  },

  listWrap: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg },
  turnSeparator: { height: 14 },
  jumpWrap: { position: 'absolute', right: space.lg, bottom: space.lg },

  emptyChat: { paddingTop: 80, alignItems: 'center', gap: 6 },
  emptyChatTitle: { color: c.text, fontSize: 16, fontWeight: '600' },
  emptyChatText: { color: c.textFaint, fontSize: 12.5 },

  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: space.lg,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.dangerBorderSoft,
    backgroundColor: c.dangerSoft,
  },
  errorGlyphWrap: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: c.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorGlyph: { color: c.onDanger, fontSize: 11, fontWeight: '700', lineHeight: 13 },
  errorText: { flex: 1, color: c.danger, fontSize: 12, lineHeight: 17 },
  errorAction: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: c.glass,
  },
  errorActionText: { color: c.danger, fontSize: 12, fontWeight: '600' },
  errorClose: { paddingHorizontal: 2, paddingVertical: 2 },
  errorCloseText: { color: c.danger, fontSize: 16, lineHeight: 18 },
});
