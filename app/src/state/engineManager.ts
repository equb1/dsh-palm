/**
 * EngineManager：轻引擎 / 完整引擎（proot）的状态机。
 *
 * 这个文件是**纯函数**，不 import react-native、不碰定时器、不碰原生模块，
 * 所以可以直接在 Node 里跑测试。真正的副作用（连轻引擎、预热宿主、停宿主）
 * 由 `store.ts` 按 reducer 返回的 effects 顺序执行。
 *
 * 核心约定：
 * - 冷启动只走轻引擎；BOOT 永远不预热、不连接完整引擎（回归锁）。
 * - 切到完整引擎是两阶段：目标真的连上了，才断开当前链路（由 store 保证）。
 * - 失败/超时回退轻引擎时，保留 `lightReady`（轻引擎链路没有被拆掉）。
 */

export type EngineMode = 'light' | 'starting-proot' | 'full';
export type EngineTarget = 'light' | 'full';
/** 预热档位：触发式（默认）/ 智能（充电 + WiFi）/ 常备（高级） */
export type PrewarmTier = 'trigger' | 'smart' | 'always';

/** 当前链路：轻引擎 / 本机完整引擎 / 另一台电脑的宿主 */
export type EngineLink = 'light' | 'proot' | 'remote' | null;

/** 和 lib/host 的 HostStatus 结构一致；单独声明是为了让本文件零依赖 */
export interface EngineHost {
  engine: 'stopped' | 'starting' | 'ready' | 'failed';
  bridge: 'stopped' | 'starting' | 'ready' | 'failed';
  port: number;
  error: string | null;
  since: number;
  phase?: string;
  progress?: number;
  pairCode?: string | null;
}

export interface EngineSnapshot {
  /** 界面现在该展示哪套引擎 */
  mode: EngineMode;
  /** 用户想要的目标引擎 */
  target: EngineTarget;
  tier: PrewarmTier;
  /** 每次「切到完整引擎」自增；旧状态帧不会顶掉新一轮 */
  attemptId: number;
  /** 完整引擎启动/连上的进度 0–100 */
  progress: number;
  error: string | null;
  host: EngineHost | null;
  link: EngineLink;
  /** 轻引擎是否已经连上（切换失败时用它决定要不要重连） */
  lightReady: boolean;
  /** 本机完整引擎进程是否热着（启动中/已就绪/重试中） */
  prootWarm: boolean;
  /** 有回合在跑时禁止切换/回收 */
  busy: boolean;
  pendingApprovals: number;
  /** 0 = 不计时（忙或刚启动） */
  idleSince: number;
  /** 收到过多少帧宿主状态，调试/进度平滑用 */
  frames: number;
}

/** 状态机返回的副作用；store 按数组顺序执行 */
export type EngineEffect = 'connect-light' | 'warm-host' | 'connect-proot' | 'stop-host' | 'report';

export type EngineEvent =
  | { type: 'BOOT'; tier?: PrewarmTier; now?: number }
  | { type: 'LIGHT_CONNECTING' }
  | { type: 'LIGHT_READY'; now?: number }
  | { type: 'LIGHT_FAILED'; error?: string }
  | { type: 'SWITCH'; target: EngineTarget; now?: number }
  | { type: 'HOST_STATUS'; host: EngineHost }
  | { type: 'PROOT_TIMEOUT'; error?: string; attemptId?: number; now?: number }
  | { type: 'PROOT_FAILED'; error?: string; attemptId?: number; now?: number }
  | { type: 'PROOT_CONNECTED' }
  | { type: 'REMOTE_ATTACHED' }
  | { type: 'LINK_LOST'; error?: string; now?: number }
  | { type: 'SET_BUSY'; busy: boolean; pendingApprovals?: number; now?: number }
  | { type: 'RECLAIM'; reason?: string; now?: number }
  | { type: 'RECLAIMED' }
  | { type: 'SET_TIER'; tier: PrewarmTier }
  | { type: 'USER_ACTIVITY'; now?: number };

export interface EngineStep {
  state: EngineSnapshot;
  effects: EngineEffect[];
}

/** 空闲 10 分钟回收 proot */
export const IDLE_RECLAIM_MS = 10 * 60_000;
/** 完整引擎启动超时：HostRuntime 自带退避重试；首次装包要解压 rootfs，给 3 分钟 */
export const PROOT_BOOT_TIMEOUT_MS = 180_000;
/** 空闲巡检间隔 */
export const IDLE_SWEEP_MS = 60_000;

export const DEFAULT_PREWARM_TIER: PrewarmTier = 'trigger';

export const initialEngineState: EngineSnapshot = {
  mode: 'light',
  target: 'light',
  tier: DEFAULT_PREWARM_TIER,
  attemptId: 0,
  progress: 0,
  error: null,
  host: null,
  link: null,
  lightReady: false,
  prootWarm: false,
  busy: false,
  pendingApprovals: 0,
  idleSince: 0,
  frames: 0,
};

const NO_EFFECTS: EngineEffect[] = [];

function step(
  prev: EngineSnapshot,
  patch: Partial<EngineSnapshot>,
  effects: EngineEffect[] = NO_EFFECTS,
): EngineStep {
  let changed = false;
  for (const key of Object.keys(patch) as Array<keyof EngineSnapshot>) {
    if (patch[key] !== prev[key]) {
      changed = true;
      break;
    }
  }
  return { state: changed ? { ...prev, ...patch } : prev, effects };
}

function idleStart(state: EngineSnapshot, now?: number): number {
  if (state.busy) return 0;
  return now ?? Date.now();
}

/** 判断现在能不能切（纯函数，UI 和 store 用同一套规则） */
export function canSwitch(state: EngineSnapshot, target?: EngineTarget): { ok: boolean; reason?: string } {
  if (state.busy) return { ok: false, reason: '正在执行回合，等这一轮结束再切换引擎' };
  if (state.pendingApprovals > 0) return { ok: false, reason: '还有审批/提问等着处理，处理完再切换引擎' };
  if (state.mode === 'starting-proot') return { ok: false, reason: '完整引擎正在启动，请稍候' };
  if (state.link === 'remote' && target !== 'light') {
    return { ok: false, reason: '当前连着另一台电脑的宿主，先断开再切换引擎' };
  }
  const wanted = target ?? (state.mode === 'full' ? 'light' : 'full');
  if (wanted === 'full' && state.mode === 'full' && (state.link === 'remote' || state.link === 'proot')) {
    return { ok: false, reason: '已经是完整引擎' };
  }
  if (wanted === 'light' && state.mode === 'light' && state.link === 'light') {
    return { ok: false, reason: '已经是轻引擎' };
  }
  return { ok: true };
}

export interface EngineBadgeInfo {
  kind: 'light' | 'remote';
  label: string;
}

/**
 * 顶栏角标文案：`轻` / `完整 42%` / `完整`。
 * 和 `ui/EngineBadge.tsx` 的 props 对齐（kind 只有 light/remote）。
 */
export function badgeFor(state: EngineSnapshot): EngineBadgeInfo {
  if (state.mode === 'starting-proot') {
    const pct = Math.round(state.progress);
    if (pct >= 100) return { kind: 'remote', label: '完整 就绪' };
    if (pct > 0) return { kind: 'remote', label: `完整 ${pct}%` };
    return { kind: 'remote', label: '完整 启动中' };
  }
  // 连电脑宿主和本机完整引擎都是 mode=full；角标必须按 link 区分，否则电脑被标成「完整」
  if (state.link === 'remote') return { kind: 'remote', label: '电脑' };
  if (state.mode === 'full') return { kind: 'remote', label: '完整' };
  return { kind: 'light', label: '轻' };
}

export function reduceEngine(state: EngineSnapshot, event: EngineEvent): EngineStep {
  switch (event.type) {
    case 'BOOT': {
      // 回归锁：冷启动只连轻引擎，永远不预热/连接 proot。
      return step(
        state,
        {
          mode: 'light',
          target: 'light',
          ...(event.tier ? { tier: event.tier } : {}),
          attemptId: 0,
          progress: 0,
          error: null,
          link: null,
          lightReady: false,
          prootWarm: false,
          idleSince: idleStart(state, event.now),
        },
        ['connect-light'],
      );
    }

    case 'LIGHT_CONNECTING': {
      return step(state, { error: null, lightReady: false });
    }

    case 'LIGHT_READY': {
      return step(state, {
        link: 'light',
        lightReady: true,
        error: null,
        // 切完整引擎期间轻引擎在后台重连成功，不能把 mode/target 拽回 light
        mode: state.mode === 'starting-proot' ? 'starting-proot' : 'light',
        target: state.mode === 'starting-proot' ? state.target : 'light',
        idleSince: state.idleSince || idleStart(state, event.now),
      });
    }

    case 'LIGHT_FAILED': {
      return step(
        state,
        {
          lightReady: false,
          link: state.link === 'light' ? null : state.link,
          error: event.error ?? state.error ?? '轻引擎没连上',
          mode: state.mode === 'starting-proot' ? 'starting-proot' : 'light',
        },
        ['report'],
      );
    }

    case 'SWITCH': {
      const guard = canSwitch(state, event.target);
      if (!guard.ok) return { state, effects: NO_EFFECTS };
      if (event.target === 'full') {
        return step(
          state,
          {
            mode: 'starting-proot',
            target: 'full',
            attemptId: state.attemptId + 1,
            progress: 0,
            error: null,
            // 马上要 startHost，先当成"热着"：状态看门狗立刻开始盯
            prootWarm: true,
            idleSince: 0,
          },
          ['warm-host'],
        );
      }
      // 回轻引擎：先确保轻引擎连上。如果常备档位（always），宿主保持热着随时秒切；否则停宿主
      const effects: EngineEffect[] = state.tier === 'always' ? ['connect-light'] : ['connect-light', 'stop-host'];
      return step(
        state,
        {
          mode: 'light',
          target: 'light',
          progress: 0,
          error: null,
          idleSince: idleStart(state, event.now),
        },
        effects,
      );
    }

    case 'HOST_STATUS': {
      const host = event.host;
      const rawProgress = typeof host.progress === 'number' && host.progress >= 0 ? host.progress : null;
      const ready = host.engine === 'ready' && host.bridge === 'ready';
      const progress = ready ? 100 : rawProgress ?? state.progress;
      const prootWarm = host.engine !== 'stopped' || host.bridge !== 'stopped';
      const connectProot = state.mode === 'starting-proot' && ready;
      return step(
        state,
        {
          host,
          progress,
          prootWarm,
          frames: state.frames + 1,
          // 完全就绪时清掉旧错误；还在 starting/failed 时保留最近一次错误给界面
          error: ready ? null : (host.error ?? state.error),
        },
        connectProot ? ['connect-proot'] : NO_EFFECTS,
      );
    }

    case 'PROOT_CONNECTED': {
      return step(state, {
        mode: 'full',
        target: 'full',
        link: 'proot',
        lightReady: false,
        prootWarm: true,
        progress: 100,
        error: null,
        idleSince: idleStart(state),
      });
    }

    case 'PROOT_TIMEOUT':
    case 'PROOT_FAILED': {
      if (event.attemptId != null && event.attemptId !== state.attemptId) {
        return { state, effects: NO_EFFECTS };
      }
      // 回轻引擎：轻引擎链路如果还在就保留（lightReady 不动）
      return step(
        state,
        {
          mode: 'light',
          target: 'light',
          link: state.lightReady ? 'light' : null,
          progress: 0,
          error: event.error ?? state.error ?? '完整引擎没启动起来',
          idleSince: idleStart(state, event.now),
        },
        ['stop-host', 'report'],
      );
    }

    case 'REMOTE_ATTACHED': {
      return step(state, {
        mode: 'full',
        target: 'full',
        link: 'remote',
        lightReady: false,
        progress: 100,
        error: null,
        idleSince: idleStart(state),
      });
    }

    case 'LINK_LOST': {
      return step(
        state,
        {
          mode: 'light',
          target: 'light',
          link: null,
          lightReady: false,
          prootWarm: state.link === 'proot' ? false : state.prootWarm,
          progress: 0,
          error: event.error ?? '连接已断开',
          idleSince: idleStart(state, event.now),
        },
        ['connect-light'],
      );
    }

    case 'SET_BUSY': {
      const busy = event.busy;
      const pendingApprovals = event.pendingApprovals ?? state.pendingApprovals;
      let idleSince = state.idleSince;
      if (busy) idleSince = 0;
      else if (state.busy) idleSince = event.now ?? Date.now();
      return step(state, { busy, pendingApprovals, idleSince });
    }

    case 'RECLAIM': {
      if (!state.prootWarm) return { state, effects: NO_EFFECTS };
      if (state.mode !== 'light') return { state, effects: NO_EFFECTS };
      if (state.busy || state.pendingApprovals > 0) return { state, effects: NO_EFFECTS };
      if (state.link === 'proot' || state.link === 'remote') return { state, effects: NO_EFFECTS };
      // 手动/低内存回收不看空闲窗口；只有 idle 巡检要等满 10 分钟
      const forced = event.reason != null && event.reason !== 'idle';
      if (!forced && event.now != null && state.idleSince > 0 && event.now - state.idleSince < IDLE_RECLAIM_MS) {
        return { state, effects: NO_EFFECTS };
      }
      return { state, effects: ['stop-host'] };
    }

    case 'RECLAIMED': {
      return step(state, {
        prootWarm: false,
        link: state.link === 'proot' ? null : state.link,
        host: state.host
          ? { ...state.host, engine: 'stopped', bridge: 'stopped', phase: '已停止', progress: 0 }
          : null,
      });
    }

    case 'SET_TIER': {
      return step(state, { tier: event.tier });
    }

    case 'USER_ACTIVITY': {
      if (state.busy) return { state, effects: NO_EFFECTS };
      return step(state, { idleSince: event.now ?? Date.now() });
    }

    default:
      return { state, effects: NO_EFFECTS };
  }
}
