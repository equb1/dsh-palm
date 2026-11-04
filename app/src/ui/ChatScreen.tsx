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
import { Composer } from './Composer';
import { SmoothKeyboardAvoid } from './SmoothKeyboardAvoid';
import { ModelSheet } from './ModelSheet';
import { TurnView, JumpButton } from './chat';
import { pickAttachments } from '../lib/pickImage';
import { colors, space, topInset } from './theme';

/* ------------------------------------------------------------------ *
 * 会话页
 * ------------------------------------------------------------------ */

function TurnSeparator(): React.ReactElement {
  return <View style={styles.turnSeparator} />;
}

export function ChatScreen({ session }: { session: SessionDetail }): React.ReactElement {
  const state = useStore();
  const [draft, setDraft] = React.useState('');
  const [showJump, setShowJump] = React.useState(false);
  const [footerHeight, setFooterHeight] = React.useState(0);
  const listRef = React.useRef<FlatList<Turn>>(null);
  const following = React.useRef(true);
  const scrollScheduled = React.useRef(false);
  const scrollFrame = React.useRef<number | null>(null);
  const viewportHeight = React.useRef(0);
  const contentHeight = React.useRef(0);
  const footerHeightRef = React.useRef(0);
  const distanceFromAnswers = React.useRef(0);
  const touchActive = React.useRef(false);
  const userDragging = React.useRef(false);
  const programmaticUntil = React.useRef(0);
  const preset = state.caps?.presets.find((p) => p.id === session.presetId);
  const running = session.status === 'running' || session.status === 'waiting_approval';
  const turns = session.turns;
  let lastAssistantIndex = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role === 'assistant') {
      lastAssistantIndex = i;
      break;
    }
  }

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
      const offset = Math.max(
        0,
        contentHeight.current - viewportHeight.current - footerHeightRef.current,
      );
      programmaticUntil.current = Date.now() + (animated ? 700 : 150);
      listRef.current?.scrollToOffset({ offset, animated });
    });
  }, []);

  const updateFooterHeight = React.useCallback((height: number): void => {
    const next = height > 0 ? Math.max(96, Math.round(height * 0.35)) : 0;
    footerHeightRef.current = next;
    setFooterHeight((current) => (current === next ? current : next));
  }, []);

  React.useEffect(() => {
    const onShow = (): void => scrollToLatest(false);
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
      updateFooterHeight(event.nativeEvent.layout.height);
      scrollToLatest(false);
    },
    [scrollToLatest, updateFooterHeight],
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
        contentSize.height -
          footerHeightRef.current -
          contentOffset.y -
          layoutMeasurement.height,
      );
      distanceFromAnswers.current = distance;
      // 只有列表真实收到触摸后才认拖拽，避免测量修正/程序滚动误冻结追底。
      if (userDragging.current && distance > 24) following.current = false;
      const nextJump = distance > 220;
      setShowJump((current) => (current === nextJump ? current : nextJump));
    },
    [],
  );

  const handleTouchStart = React.useCallback((): void => {
    touchActive.current = true;
    programmaticUntil.current = 0;
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

  const renderTurn = React.useCallback(
    ({ item, index }: { item: Turn; index: number }): React.ReactElement => (
      <TurnView
        turn={item}
        approvals={state.approvals}
        onToggleThinking={handleToggleThinking}
        fallbackDurationMs={
          index === lastAssistantIndex && item.status !== 'streaming' && session.updatedAt > item.createdAt
            ? session.updatedAt - item.createdAt
            : undefined
        }
      />
    ),
    [handleToggleThinking, lastAssistantIndex, session.updatedAt, state.approvals],
  );

  const renderEmpty = React.useCallback(
    (): React.ReactElement => (
      <View style={styles.emptyChat}>
        <Text style={styles.emptyChatTitle}>{preset?.name ?? '新会话'}</Text>
        <Text style={styles.emptyChatText}>{preset?.tagline ?? '说点什么开始'}</Text>
      </View>
    ),
    [preset?.name, preset?.tagline],
  );

  const renderFooter = React.useCallback(
    (): React.ReactElement => <View style={{ height: footerHeight }} />,
    [footerHeight],
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回会话列表" onPress={() => store.closeSession()} />
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
        <View style={{ flex: 1 }} />
      </View>

      <SmoothKeyboardAvoid style={styles.bodyWrap}>
        <View style={styles.listWrap}>
          <FlatList
            ref={listRef}
            style={styles.list}
            data={turns}
            renderItem={renderTurn}
            keyExtractor={(turn) => turn.runId ?? turn.id}
            extraData={state.approvals}
            ItemSeparatorComponent={TurnSeparator}
            ListEmptyComponent={renderEmpty}
            ListFooterComponent={renderFooter}
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
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            windowSize={9}
            updateCellsBatchingPeriod={32}
            removeClippedSubviews={false}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          />

          {showJump ? (
            <View style={styles.jumpWrap}>
              <JumpButton
                running={running}
                onPress={() => {
                  following.current = true;
                  userDragging.current = false;
                  setShowJump(false);
                  scrollToLatest(true, true);
                }}
              />
            </View>
          ) : null}
        </View>

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
          // 真宿主没有会话内换预设的接口时，只显示当前锦囊，不给点
          showPresets={(state.caps?.presets?.length ?? 0) > 0}
          presetsInteractive={state.caps?.actions.includes('switch_preset') ?? false}
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
  titlePill: { flexShrink: 1, paddingVertical: 3 },
  titleText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  presetPill: { flexShrink: 1 },
  presetText: { color: colors.textDim, fontSize: 12 },

  listWrap: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg },
  turnSeparator: { height: 14 },
  jumpWrap: { position: 'absolute', right: space.lg, bottom: space.lg },

  emptyChat: { paddingTop: 80, alignItems: 'center', gap: 6 },
  emptyChatTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  emptyChatText: { color: colors.textFaint, fontSize: 12.5 },

  error: { color: colors.danger, fontSize: 12, paddingHorizontal: space.lg, paddingBottom: 6 },
});
