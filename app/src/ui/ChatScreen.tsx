import React from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { SessionDetail } from '../protocol';
import { store, useStore } from './useStore';
import { Dot, IconButton, Pill } from './parts';
import { Composer } from './Composer';
import { SmoothKeyboardAvoid } from './SmoothKeyboardAvoid';
import { ModelSheet } from './ModelSheet';
import { TurnView } from './chat';
import { pickAttachments } from '../lib/pickImage';
import { colors, space, topInset } from './theme';

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
  const effortName = React.useMemo(() => {
    if (!activeModel) return null;
    const found = state.models.find((m) => m.provider === activeModel.provider && m.id === activeModel.model);
    const id = activeModel.reasoningEffort ?? found?.defaultEffort;
    return found?.efforts?.find((e) => e.id === id)?.name ?? null;
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
        <Pill onPress={() => store.openModelSheet()} style={styles.presetPill}>
          <Text style={styles.presetText} numberOfLines={1}>
            {shortModelName ?? '模型'}
            {effortName ? ` · ${effortName}` : ''}
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

  emptyChat: { paddingTop: 80, alignItems: 'center', gap: 6 },
  emptyChatTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  emptyChatText: { color: colors.textFaint, fontSize: 12.5 },

  error: { color: colors.danger, fontSize: 12, paddingHorizontal: space.lg, paddingBottom: 6 },
});
