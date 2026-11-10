import type { PetPack, PetReaction, PetState } from './types';

export interface StateMachineListener {
  (state: PetState, animationName: string, bubbleText?: string): void;
}

interface PetContext {
  runningCount: number;
  waitingApprovalCount: number;
  hasError: boolean;
  thinking: boolean;
  latestTurnTitle?: string;
}

type Timer = ReturnType<typeof setTimeout>;

const IDLE: PetContext = {
  runningCount: 0,
  waitingApprovalCount: 0,
  hasError: false,
  thinking: false,
};

/**
 * 12 态状态机（纯 TS，可单测）。
 *
 * 约定：
 * - `notification` / `error` 是瞬态，显示完自动回基础状态；
 * - `sleeping` 只在 idle 持续 sleepAfterMs 后进入，`waking` 是过渡；
 * - `triggerReaction` / `idlePool` 只改动画，不改基础状态；
 * - 所有 timer 都可取消，避免旧 transition 把新状态顶回去。
 */
export class PetStateMachine {
  private pack: PetPack;
  private context: PetContext = { ...IDLE };
  private currentState: PetState = 'idle';
  private currentAnim = 'idle';
  private bubbleText?: string;
  private lastActiveTime = Date.now();
  private stateStartTime = Date.now();
  private transientState: PetState | null = null;
  private reactionAnim: string | null = null;

  private pendingTransition: Timer | null = null;
  private transientTimer: Timer | null = null;
  private reactionTimer: Timer | null = null;
  private sleepTimer: Timer | null = null;
  private idlePoolTimer: Timer | null = null;
  private idleActionTimer: Timer | null = null;

  private listeners = new Set<StateMachineListener>();

  constructor(pack: PetPack) {
    this.pack = pack;
    this.currentAnim = this.animFor('idle');
    this.scheduleBaseTimers();
  }

  setPack(pack: PetPack): void {
    this.pack = pack;
    this.clearTimers();
    this.currentState = 'idle';
    this.currentAnim = this.animFor('idle');
    this.bubbleText = undefined;
    this.transientState = null;
    this.reactionAnim = null;
    this.stateStartTime = Date.now();
    this.scheduleBaseTimers();
    this.notify();
  }

  subscribe(listener: StateMachineListener): () => void {
    this.listeners.add(listener);
    listener(this.currentState, this.currentAnim, this.bubbleText);
    return () => this.listeners.delete(listener);
  }

  get state(): PetState {
    return this.currentState;
  }

  get animation(): string {
    return this.currentAnim;
  }

  /** 更新宿主指标，自动判定基础状态（瞬态期间不覆盖） */
  updateContext(params: {
    runningCount: number;
    waitingApprovalCount: number;
    hasError?: boolean;
    thinking?: boolean;
    latestTurnTitle?: string;
  }): void {
    const next: PetContext = {
      runningCount: Math.max(0, params.runningCount),
      waitingApprovalCount: Math.max(0, params.waitingApprovalCount),
      hasError: Boolean(params.hasError),
      thinking: Boolean(params.thinking),
      latestTurnTitle: params.latestTurnTitle,
    };
    const wasActive =
      this.context.runningCount > 0 ||
      this.context.waitingApprovalCount > 0 ||
      this.context.thinking ||
      this.context.hasError;
    const isActive =
      next.runningCount > 0 || next.waitingApprovalCount > 0 || next.thinking || next.hasError;
    this.context = next;

    if (wasActive && !isActive) {
      // 从有任务到完全空闲：给一次“完成”反馈，而不是直接掉回 idle
      this.notifyDone();
      return;
    }
    if (wasActive || isActive) this.lastActiveTime = Date.now();

    // 错误一旦出现，持续到 hasError 清除；之后由调用方 notifyDone/updateContext 恢复
    if (next.hasError) {
      this.transitionTo('error', false, '出错了…需要检查一下');
      return;
    }

    if (this.transientState) return;
    this.applyBaseState();
  }

  /** 一轮正常完成：播 2.4s 庆祝/notification，然后回基础状态 */
  notifyDone(title?: string): void {
    if (this.context.hasError) return;
    this.transientState = 'notification';
    this.transitionTo(
      'notification',
      true,
      this.pickBubble('done', title ? `${title} · 完成` : '这一轮搞定了'),
    );
    this.clearTimer('transientTimer');
    this.transientTimer = setTimeout(() => {
      this.transientState = null;
      this.transientTimer = null;
      this.applyBaseState();
    }, Math.max(1600, this.pack.timings.minDisplayMs + 1200));
  }

  /** 任务/网络错误：播 4.8s，然后回基础状态 */
  notifyError(message?: string): void {
    this.transientState = 'error';
    this.transitionTo('error', true, message ?? this.pickBubble('error', '出错了，我检查一下'));
    this.clearTimer('transientTimer');
    this.transientTimer = setTimeout(() => {
      this.transientState = null;
      this.transientTimer = null;
      this.applyBaseState();
    }, 4800);
  }

  /** 唤醒：从睡眠/空闲收到新活动时调用 */
  notifyActivity(): void {
    this.lastActiveTime = Date.now();
    if (this.currentState === 'sleeping') {
      this.transitionTo('waking', true, this.pickBubble('waking', '醒啦！随时准备干活'));
      this.clearTimer('pendingTransition');
      this.pendingTransition = setTimeout(() => {
        this.pendingTransition = null;
        this.applyBaseState();
      }, this.pack.timings.wakeMs);
    }
  }

  /** 用户交互：只改动画，不改基础状态；autoReturn 后恢复 */
  triggerReaction(reaction: PetReaction): void {
    const animName = this.pack.reactions[reaction];
    if (!animName) return;
    this.clearTimer('reactionTimer');
    this.reactionAnim = animName;
    this.currentAnim = animName;
    this.bubbleText = this.pickBubble(reaction);
    this.notify();
    this.reactionTimer = setTimeout(() => {
      this.reactionTimer = null;
      this.reactionAnim = null;
      this.applyBaseState();
    }, this.pack.timings.autoReturnMs);
  }

  destroy(): void {
    this.clearTimers();
    this.listeners.clear();
  }

  /* ------------------------------ 内部 ------------------------------ */

  private baseState(): PetState {
    const { waitingApprovalCount, runningCount, thinking, hasError } = this.context;
    if (hasError) return 'error';
    if (waitingApprovalCount > 0) return 'attention';
    if (runningCount > 0) {
      if (runningCount === 1 && thinking) return 'thinking';
      if (runningCount >= this.pack.tiers.sweeping.minTasks) return 'sweeping';
      if (runningCount >= this.pack.tiers.juggling.minTasks) return 'juggling';
      return 'working';
    }
    if (Date.now() - this.lastActiveTime >= this.pack.timings.sleepAfterMs) return 'sleeping';
    return 'idle';
  }

  private applyBaseState(): void {
    if (this.transientState || this.reactionAnim) return;
    const next = this.baseState();
    const bubble =
      next === 'attention'
        ? this.pickBubble('attention', '等待您的确认审批')
        : next === 'thinking'
          ? this.pickBubble('thinking', '正在思考…')
          : next === 'working'
            ? this.context.latestTurnTitle || this.pickBubble('working', '正在执行任务…')
            : next === 'juggling'
              ? `双任务并进 (${this.context.runningCount} 个)`
              : next === 'sweeping'
                ? `多任务全力推进中 (${this.context.runningCount} 个)`
                : next === 'sleeping'
                  ? this.pickBubble('sleeping', 'Zzz…')
                  : undefined;
    this.transitionTo(next, false, bubble);
  }

  private transitionTo(nextState: PetState, force = false, bubbleText?: string): void {
    const elapsed = Date.now() - this.stateStartTime;
    const changed = this.currentState !== nextState || this.bubbleText !== bubbleText;
    if (!changed) return;

    this.clearTimer('pendingTransition');
    if (!force && elapsed < this.pack.timings.minDisplayMs && this.currentState !== 'idle') {
      this.pendingTransition = setTimeout(() => {
        this.pendingTransition = null;
        this.transitionTo(nextState, true, bubbleText);
      }, this.pack.timings.minDisplayMs - elapsed);
      return;
    }

    this.currentState = nextState;
    this.stateStartTime = Date.now();
    this.bubbleText = bubbleText;
    this.currentAnim = this.animFor(nextState);
    this.notify();
  }

  private animFor(state: PetState): string {
    if (state === 'working') return this.pack.tiers.working.anim;
    if (state === 'juggling') return this.pack.tiers.juggling.anim;
    if (state === 'sweeping') return this.pack.tiers.sweeping.anim;
    return this.pack.states[state] ?? this.pack.states.idle ?? 'idle';
  }

  private pickBubble(key: string, fallback?: string): string | undefined {
    const lines = this.pack.bubbles?.[key];
    if (lines && lines.length > 0) {
      return lines[Math.floor(Math.random() * lines.length)];
    }
    return fallback;
  }

  private scheduleBaseTimers(): void {
    this.sleepTimer = setInterval(() => {
      if (this.transientState || this.reactionAnim) return;
      if (this.currentState === 'idle' && this.baseState() === 'sleeping') {
        this.applyBaseState();
      }
    }, 3000);

    const pickIdle = (): void => {
      if (
        !this.transientState &&
        !this.reactionAnim &&
        this.currentState === 'idle' &&
        this.pack.idlePool.length > 0
      ) {
        const total = this.pack.idlePool.reduce((sum, item) => sum + item.weight, 0);
        let rnd = Math.random() * total;
        for (const item of this.pack.idlePool) {
          if (rnd < item.weight) {
            this.currentAnim = item.anim;
            this.notify();
            this.clearTimer('idleActionTimer');
            this.idleActionTimer = setTimeout(() => {
              this.idleActionTimer = null;
              if (!this.transientState && !this.reactionAnim && this.currentState === 'idle') {
                this.currentAnim = this.animFor('idle');
                this.notify();
              }
            }, this.pack.timings.autoReturnMs);
            break;
          }
          rnd -= item.weight;
        }
      }
      const next = 8000 + Math.random() * 12000;
      this.idlePoolTimer = setTimeout(pickIdle, next);
    };
    this.idlePoolTimer = setTimeout(pickIdle, 8000);
  }

  private clearTimer(kind: 'pendingTransition' | 'transientTimer' | 'reactionTimer' | 'idleActionTimer'): void {
    const timer = this[kind];
    if (timer) clearTimeout(timer);
    this[kind] = null;
  }

  private clearTimers(): void {
    if (this.pendingTransition) clearTimeout(this.pendingTransition);
    if (this.transientTimer) clearTimeout(this.transientTimer);
    if (this.reactionTimer) clearTimeout(this.reactionTimer);
    if (this.sleepTimer) clearInterval(this.sleepTimer);
    if (this.idlePoolTimer) clearTimeout(this.idlePoolTimer);
    if (this.idleActionTimer) clearTimeout(this.idleActionTimer);
    this.pendingTransition = null;
    this.transientTimer = null;
    this.reactionTimer = null;
    this.sleepTimer = null;
    this.idlePoolTimer = null;
    this.idleActionTimer = null;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.currentState, this.currentAnim, this.bubbleText);
    }
  }
}
