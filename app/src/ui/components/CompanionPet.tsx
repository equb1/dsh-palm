import React from 'react';
import {
  Alert,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { store, useStore } from '../useStore';
import { BrandIcon } from './BrandIcon';
import { PetCanvas } from './PetCanvas';
import {
  getFloatingPetStatus,
  isOverlayPermissionGranted,
  requestOverlayPermission,
  setFloatingPetEnabled,
} from '../../lib/host';
import { radius, space, useTheme, useThemedStyles, type Theme } from '../theme';
import { getPetPack, PetStateMachine, type PetRole, type PetState } from '../../pet';

export type { PetRole } from '../../pet';

/* ------------------------------------------------------------------ *
 * 主组件：浮动在 Composer 输入框上方，并支持桌面外置常驻
 * ------------------------------------------------------------------ */

export function CompanionPet(): React.ReactElement | null {
  const state = useStore();
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [role, setRole] = React.useState<PetRole>('deepy');
  const [hudOpen, setHudOpen] = React.useState(false);
  const [floatingActive, setFloatingActive] = React.useState(false);
  const [petState, setPetState] = React.useState<PetState>('idle');
  const [currentAnim, setCurrentAnim] = React.useState<string>('idle');
  const [bubbleText, setBubbleText] = React.useState<string | undefined>(undefined);

  // 动画状态：完成时的空翻，或者呼吸微律动
  const flipAnim = React.useRef(new Animated.Value(0)).current;
  const bounceAnim = React.useRef(new Animated.Value(0)).current;

  // 状态机实例
  const smRef = React.useRef<PetStateMachine | null>(null);
  if (!smRef.current) {
    smRef.current = new PetStateMachine(getPetPack(role));
  }

  // 订阅状态机变化
  React.useEffect(() => {
    const sm = smRef.current;
    if (!sm) return;
    return sm.subscribe((st, anim, bubble) => {
      setPetState(st);
      setCurrentAnim(anim);
      setBubbleText(bubble);
    });
  }, []);

  // 角色切换同步到状态机
  React.useEffect(() => {
    smRef.current?.setPack(getPetPack(role));
  }, [role]);

  // 根据当前 App 状态计算伴侣状态并推入状态机
  const runningSessions = state.sessions.filter((s) => s.status === 'running');
  const waitingSessions = state.sessions.filter((s) => s.status === 'waiting_approval');
  const activeCount = runningSessions.length + waitingSessions.length;

  const currentRunning = state.detail?.status === 'running';
  const currentWaiting = state.detail?.status === 'waiting_approval';

  React.useEffect(() => {
    const latestTurn = state.detail?.turns?.slice(-1)[0];
    const isThinking = latestTurn?.blocks?.some((b) => b.kind === 'thinking');
    smRef.current?.updateContext({
      runningCount: runningSessions.length + (currentRunning ? 1 : 0),
      waitingApprovalCount: waitingSessions.length + (currentWaiting ? 1 : 0),
      hasError: Boolean(state.error),
      thinking: isThinking,
      latestTurnTitle: state.detail?.title,
    });
  }, [
    runningSessions.length,
    waitingSessions.length,
    currentRunning,
    currentWaiting,
    state.error,
    state.detail?.title,
    state.detail?.turns,
  ]);

  // 检查系统桌面悬浮窗状态
  React.useEffect(() => {
    void getFloatingPetStatus().then((st) => {
      if (st) setFloatingActive(st.isShowing);
    });
  }, []);

  // 当任务从 working 变为 done 时的空翻动作
  const prevPetState = React.useRef<PetState>(petState);
  React.useEffect(() => {
    if ((prevPetState.current === 'working' || prevPetState.current === 'juggling' || prevPetState.current === 'sweeping') && petState === 'idle') {
      flipAnim.setValue(0);
      Animated.sequence([
        Animated.timing(bounceAnim, { toValue: -14, duration: 250, useNativeDriver: true }),
        Animated.parallel([
          Animated.timing(flipAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
          Animated.timing(bounceAnim, { toValue: 0, duration: 450, useNativeDriver: true }),
        ]),
      ]).start();
    }
    prevPetState.current = petState;

    if (floatingActive) {
      void setFloatingPetEnabled(true, role, petState);
    }
  }, [petState, role, floatingActive, bounceAnim, flipAnim]);

  const spin = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // 开启 / 关闭「App 外显示」系统桌面悬浮窗
  const handleToggleFloating = async (val: boolean) => {
    if (val) {
      const granted = await isOverlayPermissionGranted();
      if (!granted) {
        Alert.alert(
          '开启「App 外显示」权限',
          '需要开启「悬浮窗 / 在其他应用上层显示」权限，桌宠才能跟您到桌面。',
          [
            { text: '去设置开启', onPress: () => void requestOverlayPermission() },
            { text: '取消', style: 'cancel' },
          ],
        );
        return;
      }
      const ok = await setFloatingPetEnabled(true, role, petState);
      if (ok) setFloatingActive(true);
    } else {
      const ok = await setFloatingPetEnabled(false);
      if (ok) setFloatingActive(false);
    }
  };

  return (
    <>
      <View style={styles.container} pointerEvents="box-none">
        {bubbleText ? (
          <View style={styles.bubble}>
            <Text style={styles.bubbleText} numberOfLines={2}>
              {bubbleText}
            </Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="伴侣宠物与任务监控"
          onPress={() => {
            const reactions = ['tapLeft', 'tapRight', 'tickle'] as const;
            const chosen = reactions[Math.floor(Math.random() * reactions.length)]!;
            smRef.current?.triggerReaction(chosen);
          }}
          onLongPress={() => setHudOpen(true)}
          style={styles.petTouch}
          hitSlop={8}
        >
          <Animated.View
            style={{
              transform: [{ translateY: bounceAnim }, { rotate: spin }],
            }}
          >
            <PetCanvas role={role} animation={currentAnim} size={64} />
          </Animated.View>

          {/* 并行任务数角标 */}
          {activeCount > 1 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{activeCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {/* 工作汇报与用量面板 (HUD) */}
      <Modal visible={hudOpen} transparent animationType="fade" onRequestClose={() => setHudOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setHudOpen(false)}>
          <Pressable style={styles.hudCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.hudHeader}>
              <View style={styles.hudTitleRow}>
                <PetCanvas role={role} animation={currentAnim} size={48} />
                <View>
                  <Text style={styles.hudName}>{role === 'deepy' ? 'Deepy (小蓝鲸)' : '鲸娘'}</Text>
                  <Text style={styles.hudStatus}>
                    {petState === 'coding'
                      ? `正在全力敲代码（${activeCount} 个任务执行中）…`
                      : petState === 'waiting'
                      ? '有任务在等你确认哦！'
                      : '目前没有进行中的任务，小憩中 Zzz'}
                  </Text>
                </View>
              </View>
              <Pressable onPress={() => setHudOpen(false)} style={styles.hudClose}>
                <BrandIcon name="close" size={16} color={palette.textDim} />
              </Pressable>
            </View>

            {/* 切换角色按钮 */}
            <View style={styles.roleSwitchRow}>
              <Pressable
                onPress={() => {
                  setRole('deepy');
                  if (floatingActive) void setFloatingPetEnabled(true, 'deepy', petState);
                }}
                style={[styles.roleBtn, role === 'deepy' && styles.roleBtnActive]}
              >
                <Text style={[styles.roleBtnText, role === 'deepy' && styles.roleBtnTextActive]}>
                  小鲸鱼 Deepy
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setRole('maid');
                  if (floatingActive) void setFloatingPetEnabled(true, 'maid', petState);
                }}
                style={[styles.roleBtn, role === 'maid' && styles.roleBtnActive]}
              >
                <Text style={[styles.roleBtnText, role === 'maid' && styles.roleBtnTextActive]}>
                  鲸娘
                </Text>
              </Pressable>
            </View>

            {/* 「App 外显示」系统悬浮窗常驻开关 */}
            <View style={styles.overlaySettingCard}>
              <View style={styles.overlayInfo}>
                <Text style={styles.overlayTitle}>App 外显示（桌面常驻）</Text>
                <Text style={styles.overlaySub}>
                  离开 App 后桌宠依然在手机桌面，可自由拖动，点击直达会话。
                </Text>
              </View>
              <Switch
                value={floatingActive}
                onValueChange={(val) => void handleToggleFloating(val)}
                trackColor={{ false: palette.border, true: palette.blue }}
                thumbColor="#FFFFFF"
              />
            </View>

            {/* 多任务并行汇报列表 */}
            <ScrollView style={styles.taskList} showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionTitle}>正在执行或待确认的任务</Text>
              {runningSessions.length === 0 && waitingSessions.length === 0 ? (
                <Text style={styles.emptyTasks}>暂无后台正在执行的并行任务</Text>
              ) : (
                [...waitingSessions, ...runningSessions].map((s) => (
                  <Pressable
                    key={s.id}
                    onPress={() => {
                      setHudOpen(false);
                      void store.openSessionRow(s.id, state.engineKind === 'light' ? 'light' : 'full');
                    }}
                    style={styles.taskRow}
                  >
                    <View style={styles.taskInfo}>
                      <Text style={styles.taskTitle} numberOfLines={1}>
                        {s.title}
                      </Text>
                      <Text style={styles.taskSub} numberOfLines={1}>
                        {s.status === 'waiting_approval' ? '✋ 等你确认操作' : '⚡ 正在生成回复…'}
                      </Text>
                    </View>
                    <View style={styles.taskJumpBtn}>
                      <Text style={styles.taskJumpText}>前往 ›</Text>
                    </View>
                  </Pressable>
                ))
              )}

              {/* 资源用量与余额提示 */}
              <View style={styles.usageCard}>
                <View style={styles.usageRow}>
                  <Text style={styles.usageLabel}>当前模型渠道：</Text>
                  <Text style={styles.usageVal}>
                    {state.engine.mode === 'full' ? '完整引擎 (Proot 本地容器)' : '轻引擎 (云端 API 直连)'}
                  </Text>
                </View>
                <View style={styles.usageRow}>
                  <Text style={styles.usageLabel}>账号状态：</Text>
                  <Text style={[styles.usageVal, { color: palette.ok }]}>
                    {state.account?.user?.email || state.account?.user?.maskedPhone
                      ? `已登录 · ${state.account.user.email || state.account.user.maskedPhone}`
                      : '正常可用'}
                  </Text>
                </View>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    container: {
      position: 'absolute',
      right: 22,
      top: -30,
      zIndex: 35,
      alignItems: 'flex-end',
    },
    bubble: {
      position: 'absolute',
      bottom: 50,
      right: 0,
      maxWidth: 160,
      backgroundColor: c.glassStrong,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.md,
      shadowColor: c.shadow,
      shadowOpacity: 0.1,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    bubbleText: {
      color: c.text,
      fontSize: 11,
      fontWeight: '500',
    },
    petTouch: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    badge: {
      position: 'absolute',
      top: -2,
      right: -2,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 3,
    },
    badgeText: {
      color: '#FFFFFF',
      fontSize: 9.5,
      fontWeight: 'bold',
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: c.backdrop,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: space.lg,
    },
    hudCard: {
      width: '100%',
      maxWidth: 380,
      maxHeight: 520,
      backgroundColor: c.bg,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: c.borderStrong,
      padding: space.lg,
      gap: 12,
      elevation: 12,
      shadowColor: c.shadow,
      shadowOpacity: 0.15,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
    },
    hudHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
    },
    hudTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    hudName: {
      color: c.text,
      fontSize: 15,
      fontWeight: '700',
    },
    hudStatus: {
      color: c.textDim,
      fontSize: 11.5,
      marginTop: 2,
      maxWidth: 240,
    },
    hudClose: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.glassStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    roleSwitchRow: {
      flexDirection: 'row',
      backgroundColor: c.bgElevated,
      borderRadius: radius.pill,
      padding: 3,
      gap: 4,
    },
    roleBtn: {
      flex: 1,
      paddingVertical: 6,
      borderRadius: radius.pill,
      alignItems: 'center',
    },
    roleBtnActive: {
      backgroundColor: c.blueSoft,
    },
    roleBtnText: {
      color: c.textDim,
      fontSize: 12,
      fontWeight: '500',
    },
    roleBtnTextActive: {
      color: c.blue,
      fontWeight: '600',
    },
    overlaySettingCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: c.bgElevated,
      padding: 12,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      gap: 10,
    },
    overlayInfo: {
      flex: 1,
      gap: 2,
    },
    overlayTitle: {
      color: c.text,
      fontSize: 13,
      fontWeight: '600',
    },
    overlaySub: {
      color: c.textDim,
      fontSize: 11,
      lineHeight: 15,
    },
    taskList: {
      maxHeight: 220,
    },
    sectionTitle: {
      color: c.textDim,
      fontSize: 12,
      fontWeight: '600',
      marginBottom: 8,
    },
    emptyTasks: {
      color: c.textFaint,
      fontSize: 12,
      paddingVertical: 12,
      textAlign: 'center',
    },
    taskRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: c.glassStrong,
      padding: 10,
      borderRadius: radius.md,
      marginBottom: 6,
    },
    taskInfo: {
      flex: 1,
      gap: 2,
      marginRight: 8,
    },
    taskTitle: {
      color: c.text,
      fontSize: 13,
      fontWeight: '600',
    },
    taskSub: {
      color: c.textDim,
      fontSize: 11,
    },
    taskJumpBtn: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.xs,
      backgroundColor: c.blueSoft,
    },
    taskJumpText: {
      color: c.blue,
      fontSize: 11,
      fontWeight: '600',
    },
    usageCard: {
      marginTop: 10,
      padding: 12,
      backgroundColor: c.bgElevated,
      borderRadius: radius.lg,
      gap: 6,
    },
    usageRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    usageLabel: {
      color: c.textDim,
      fontSize: 12,
    },
    usageVal: {
      color: c.text,
      fontSize: 12,
      fontWeight: '500',
    },
  });
