import React from 'react';
import {
  Animated,
  BackHandler,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { SessionSummary } from '../protocol';
import type { AttachmentKind } from '../lib/attachments/types';
import { store, useStore } from './useStore';
import { IconButton } from './parts';
import {
  BottomSheet,
  BrandIcon,
  BrandMark,
  EmptyState,
  RotatingHint,
  TypewriterText,
} from './components';
import { SessionDrawer } from './SessionDrawer';
import { ModelSheet } from './ModelSheet';
import { Composer } from './Composer';
import { SmoothKeyboardAvoid } from './SmoothKeyboardAvoid';
import { radius, space, topInset, useTheme, useThemedStyles, type Palette, type Theme } from './theme';

const HOME_HINTS = [
  '帮我把刚才的会议要点整理成一份周报…',
  '分析一下上传的表格，画张趋势图…',
  '写一段 Python 脚本处理工作区里的文件…',
  '或者直接从下面选一个锦囊开始',
] as const;

function relTime(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.round(hour / 24);
  if (day === 1) return '昨天';
  if (day < 7) return `${day} 天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

function statusTones(c: Palette): Record<string, { label: string; color: string; bg: string }> {
  return {
    running: { label: '生成中', color: c.blue, bg: c.blueSoft },
    waiting_approval: { label: '待确认', color: c.warn, bg: c.warnSoft },
    error: { label: '出错', color: c.danger, bg: c.dangerSoft },
  };
}

function StatusTag({ s }: { s: SessionSummary }): React.ReactElement | null {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const tone = statusTones(palette)[s.status];
  if (!tone) return null;
  return (
    <View style={[styles.tag, { backgroundColor: tone.bg }]}>
      <Text style={[styles.tagText, { color: tone.color }]}>{tone.label}</Text>
    </View>
  );
}

export function HomeScreen(): React.ReactElement {
  const state = useStore();
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [draft, setDraft] = React.useState('');
  const [drawer, setDrawer] = React.useState(false);
  const [modeSheetOpen, setModeSheetOpen] = React.useState(false);
  // 抽屉 0→1 进度；首页主体同步轻微右移，形成“推开”而不是一张死板的面板。
  const drawerAnim = React.useRef(new Animated.Value(0)).current;

  // 左侧滑动手势唤出抽屉（采用 Capture 阶段优先拦截，不受 ScrollView 抢事件影响）
  const homePanResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (evt, gesture) =>
          !drawer && gesture.dx > 14 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.3,
        onMoveShouldSetPanResponder: (evt, gesture) =>
          !drawer && gesture.dx > 14 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.3,
        onPanResponderGrant: () => {
          drawerAnim.stopAnimation();
        },
        onPanResponderMove: (_evt, gesture) => {
          const next = Math.max(0, Math.min(1, gesture.dx / 302));
          drawerAnim.setValue(next);
        },
        onPanResponderRelease: (_evt, gesture) => {
          const next = Math.max(0, Math.min(1, gesture.dx / 302));
          if (next > 0.25 || gesture.vx > 0.3) {
            setDrawer(true);
            Animated.spring(drawerAnim, {
              toValue: 1,
              friction: 8,
              tension: 65,
              useNativeDriver: true,
            }).start();
          } else {
            Animated.spring(drawerAnim, {
              toValue: 0,
              friction: 8,
              tension: 65,
              useNativeDriver: true,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(drawerAnim, {
            toValue: 0,
            friction: 8,
            tension: 65,
            useNativeDriver: true,
          }).start();
        },
      }),
    [drawer, drawerAnim],
  );

  // 从系统分享菜单进来的文字：填进输入框（只填一次；回前台再分享也生效）
  React.useEffect(() => {
    const shared = store.takeShareText();
    if (shared) setDraft((d) => (d.trim().length > 0 ? d : shared));
  }, [state.pendingShare?.text]);

  React.useEffect(() => {
    if (!drawer) return;
    const onBackPress = (): boolean => {
      setDrawer(false);
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [drawer]);

  const presets = state.caps?.presets ?? [];
  const preset = presets.find((p) => p.id === state.draftPresetId) ?? presets[0];
  const activeModel = state.defaultModel;
  const activeModelOption = state.models.find(
    (m) => m.provider === activeModel?.provider && m.id === activeModel?.model
  );
  const effortName = activeModelOption?.efforts?.find(
    (e) => e.id === (activeModel?.reasoningEffort ?? activeModelOption?.defaultEffort)
  )?.name;
  const modelLabel = `${(activeModelOption?.name ?? activeModel?.model ?? '模型').replace(/^DeepSeek-?/i, '')}${
    effortName ? ' · ' + effortName : ''
  }`;
  const hasText = draft.trim().length > 0;

  // 首装解压 + 完整引擎冷启动有 10 多秒，这段时间首页别只显示"未连接"
  const engine = state.engine;
  const booting = engine.mode === 'starting-proot';
  const bootHost = engine.host ?? state.host;
  const bootPct = engine.progress > 0 ? engine.progress : (bootHost?.progress ?? 0);
  const bootLabel = bootHost?.phase
    ? bootHost.phase + (bootPct > 0 && bootPct < 100 ? ` ${bootPct}%` : '')
    : '完整引擎启动中';
  const modeLabel = booting
    ? bootPct > 0 && bootPct < 100
      ? `启动中 ${bootPct}%`
      : '启动中'
    : engine.mode === 'full'
      ? '完整'
      : '轻';

  const connColor =
    state.conn === 'connected' ? palette.ok : state.conn === 'reconnecting' || booting ? palette.warn : palette.danger;
  const connLabel =
    booting
      ? bootLabel
      : state.conn === 'connected'
        ? (state.caps?.host.name ?? '已连接')
        : state.conn === 'reconnecting'
          ? '重连中'
          : state.conn === 'connecting'
            ? '连接中'
            : '未连接';

  const send = (): void => {
    if (!hasText && state.pendingAttachments.length === 0) return;
    const text = draft.trim();
    // 发送成功才清空草稿：引擎没连上/切完整引擎失败时，用户这句话不能丢
    void store.startWith(text).then((ok) => {
      if (ok) setDraft((current) => (current === draft ? '' : current));
      else setDraft((current) => (current.trim().length > 0 ? current : text));
    });
  };

  const handlePickAttachment = (kind: AttachmentKind): void => {
    // 原生收件落盘 → store 里分类、去重；错误由 store 统一展示
    void store.attachFromPicker(kind);
  };

  return (
    <View style={styles.root} {...homePanResponder.panHandlers}>
      <Animated.View
        style={{
          flex: 1,
          transform: [
            {
              translateX: drawerAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 42] }),
            },
          ],
        }}
      >
      <View style={styles.header}>
        <IconButton icon="menu" label="打开会话列表" onPress={() => setDrawer(true)} />
        <View style={styles.brandBlock}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`模型：${modelLabel}`}
            onPress={() => store.openModelSheet()}
            style={({ pressed }) => [styles.modelChip, pressed && { opacity: 0.65 }]}
          >
            <Text style={styles.modelChipText} numberOfLines={1}>
              {modelLabel}
            </Text>
            <View style={{ transform: [{ rotate: '-90deg' }] }}>
              <BrandIcon name="back" size={11} color={palette.textFaint} strokeWidth={2} />
            </View>
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`运行模式：${modeLabel}`}
          onPress={() => setModeSheetOpen(true)}
          style={({ pressed }) => [styles.modePill, pressed && { opacity: 0.75 }]}
        >
          <View style={[styles.modeDot, { backgroundColor: connColor }]} />
          <BrandIcon
            name={booting ? 'loader' : engine.mode === 'full' ? 'box' : 'zap'}
            size={14}
            color={engine.mode === 'full' ? palette.text : palette.blue}
          />
          <Text style={[styles.modeText, engine.mode === 'full' && { color: palette.text }]}>
            {booting ? modeLabel : `${modeLabel}模式`}
          </Text>
        </Pressable>
      </View>

      {engine.mode === 'light' && !engine.lightReady && Boolean(engine.error) ? (
        <Pressable accessibilityRole="button" onPress={() => store.openLightSetup()} style={styles.lightSetup}>
          <Text style={styles.lightSetupText}>轻引擎未就绪 · 点这里配置模型渠道 ›</Text>
        </Pressable>
      ) : null}

      <SmoothKeyboardAvoid style={styles.bodyWrap}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollOuter}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.greeting}>
            <TypewriterText text="需要我做点什么？" style={styles.greetingTitle} />
            <RotatingHint items={HOME_HINTS} style={styles.greetingSub} />
          </View>

          {Boolean(state.error) ? (
            <Pressable onPress={() => store.clearError()}>
              <Text style={styles.error}>{state.error}</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <Composer
          draft={draft}
          onChangeDraft={setDraft}
          onSend={send}
          placeholder="给锦囊发消息…"
          presets={presets}
          activePresetId={state.draftPresetId}
          onPickPreset={(id) => store.setDraftPreset(id)}
          permissions={state.permissions}
          activePermission={state.defaultPermission}
          onPickPermission={(value) => void store.setPermission(value)}
          attachments={state.pendingAttachments}
          attaching={state.attaching}
          onPickAttachment={handlePickAttachment}
          onRemoveAttachment={(id) => store.removeAttachment(id)}
        />
      </SmoothKeyboardAvoid>
      </Animated.View>

      <BottomSheet
        visible={modeSheetOpen}
        onClose={() => setModeSheetOpen(false)}
        sheetStyle={styles.modeSheet}
      >
        <View style={styles.modeSheetHead}>
          <View>
            <Text style={styles.modeSheetTitle}>运行模式</Text>
            <Text style={styles.modeSheetSub}>{connLabel}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭运行模式"
            onPress={() => setModeSheetOpen(false)}
            style={styles.modeClose}
          >
            <BrandIcon name="close" size={16} color={palette.textDim} />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="轻模式"
          accessibilityState={{ selected: engine.mode === 'light' }}
          onPress={() => {
            setModeSheetOpen(false);
            if (engine.mode !== 'light') void store.switchEngine('light');
          }}
          style={[styles.modeRow, engine.mode === 'light' && styles.modeRowActive]}
        >
          <View style={[styles.modeIcon, { backgroundColor: palette.blueSoft }]}>
            <BrandIcon name="zap" size={18} color={palette.blue} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.modeName}>轻模式</Text>
            <Text style={styles.modeHint}>秒开、省电；问答、轻文档和附件引用</Text>
          </View>
          {engine.mode === 'light' ? <BrandIcon name="check" size={16} color={palette.blue} /> : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="完整模式"
          accessibilityState={{ selected: engine.mode === 'full' }}
          onPress={() => {
            setModeSheetOpen(false);
            if (engine.mode !== 'full') void store.switchEngine('full');
          }}
          style={[styles.modeRow, engine.mode === 'full' && styles.modeRowActive]}
        >
          <View style={[styles.modeIcon, { backgroundColor: palette.glassStrong }]}>
            <BrandIcon name="box" size={18} color={palette.textDim} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.modeName}>完整模式</Text>
            <Text style={styles.modeHint}>Python / Linux / Office 编辑；首次启动稍慢</Text>
          </View>
          {engine.mode === 'full' ? <BrandIcon name="check" size={16} color={palette.blue} /> : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="连接电脑宿主"
          onPress={() => {
            setModeSheetOpen(false);
            store.openConnectModal();
          }}
          style={styles.modeRow}
        >
          <View style={[styles.modeIcon, { backgroundColor: palette.glassStrong }]}>
            <BrandIcon name="laptop" size={18} color={palette.textDim} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.modeName}>连接电脑宿主</Text>
            <Text style={styles.modeHint}>同一 Wi-Fi 扫描或手填地址，用电脑上的 dsh</Text>
          </View>
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <BrandIcon name="back" size={15} color={palette.textFaint} />
          </View>
        </Pressable>
      </BottomSheet>

      <SessionDrawer visible={drawer} onClose={() => setDrawer(false)} progress={drawerAnim} />
      <ModelSheet />
    </View>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg, paddingTop: topInset },
    bodyWrap: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingHorizontal: space.lg,
      paddingTop: space.sm,
      paddingBottom: space.sm,
    },
    headerModel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      height: 32,
      maxWidth: 172,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      backgroundColor: c.glassStrong,
    },
    headerModelText: { color: c.text, fontSize: 12, flexShrink: 1 },
    headerModelChevron: { color: c.textFaint, fontSize: 9 },
    brandBlock: { flex: 1, minWidth: 0, gap: 1 },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    modelChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      alignSelf: 'flex-start',
      maxWidth: '100%',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: c.glassStrong,
    },
    modelChipText: { color: c.textFaint, fontSize: 11.5, lineHeight: 16, flexShrink: 1 },
    modePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      height: 32,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      backgroundColor: c.glass,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    modeDot: { width: 5, height: 5, borderRadius: 3 },
    modeText: { color: c.blue, fontSize: 11.5, fontWeight: '600' },
    modeSheet: {
      backgroundColor: c.bg,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingHorizontal: space.lg,
      paddingTop: space.md,
      paddingBottom: 24,
      gap: 8,
    },
    modeSheetHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 4,
    },
    modeSheetTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
    modeSheetSub: { color: c.textFaint, fontSize: 11.5, marginTop: 2 },
    modeClose: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.glass,
    },
    modeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.glass,
    },
    modeRowActive: { borderColor: c.blue, backgroundColor: c.blueSoft },
    modeIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modeName: { color: c.text, fontSize: 14, fontWeight: '600' },
    modeHint: { color: c.textFaint, fontSize: 11.5, lineHeight: 16 },
    brandMark: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.goldSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandGlyph: { color: c.gold, fontSize: 18, fontWeight: '700' },
    brand: { color: c.text, fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: 1.5 },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
    lightSetup: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 16 },
    lightSetupText: { color: c.blue, fontSize: 11.5, textAlign: 'center' },
    connRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    connText: { color: c.textFaint, fontSize: 11 },
    disconnect: { color: c.textDim, fontSize: 12 },

    scrollOuter: { paddingBottom: space.lg, flexGrow: 1 },

    greeting: { paddingHorizontal: space.xl, paddingTop: 64, paddingBottom: 40, alignItems: 'center', gap: 10 },
    greetingTitle: {
      color: c.text,
      fontSize: 24,
      lineHeight: 32,
      minHeight: 32,
      fontWeight: '600',
      letterSpacing: 0.2,
      textAlign: 'center',
    },
    greetingSub: {
      color: c.textFaint,
      fontSize: 13,
      lineHeight: 20,
      minHeight: 40,
      textAlign: 'center',
      maxWidth: 320,
    },

    list: { paddingHorizontal: space.lg, gap: 8 },
    sectionTitle: { color: c.textFaint, fontSize: 12, lineHeight: 18, letterSpacing: 0.2, marginBottom: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      padding: 12,
      borderRadius: radius.lg,
      backgroundColor: c.glass,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
    rowTitle: { color: c.text, fontSize: 14, lineHeight: 22, fontWeight: '500', flex: 1 },
    rowTime: { color: c.textFaint, fontSize: 11, lineHeight: 16 },
    rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowPreview: { color: c.textDim, fontSize: 13, lineHeight: 20, flex: 1 },
    engineTag: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.xs,
      backgroundColor: c.glassStrong,
    },
    engineTagFull: { backgroundColor: c.blueSoft },
    engineTagText: { color: c.textFaint, fontSize: 10, fontWeight: '600' },
    engineTagTextFull: { color: c.blue },
    tag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
    tagText: { fontSize: 10, fontWeight: '600' },

    error: { color: c.danger, fontSize: 12, paddingHorizontal: space.lg, marginTop: space.md },
  });
