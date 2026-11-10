/**
 * 数据驱动的桌宠规范定义（参考 ccch1mneyyy/dsh-go）
 */

export type PetRole = 'deepy' | 'maid' | 'xiaoji';

export type PetState =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'juggling'
  | 'sweeping'
  | 'notification'
  | 'attention'
  | 'error'
  | 'carrying'
  | 'sleeping'
  | 'waking'
  | 'roam';

export type PetReaction = 'tapLeft' | 'tapRight' | 'tickle' | 'drag';

export interface PetAnimationFrame {
  /** 精灵表中的帧索引（从 0 开始） */
  i: number;
  /** 当前帧持续时长（毫秒） */
  ms: number;
}

export interface PetAnimation {
  /** 精灵表相对资产路径或模块名，如 "sheet_working.png" */
  sheet: string;
  /** 单帧宽度（像素） */
  frameW: number;
  /** 单帧高度（像素） */
  frameH: number;
  /** 精灵表格网列数 */
  cols: number;
  /** 帧序列 */
  frames: PetAnimationFrame[];
  /** 是否循环播放 */
  loop: boolean;
}

export interface PetBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PetPack {
  id: string;
  name: string;
  version: string;
  /** 标准画布大小，如 128x128 */
  canvas: { width: number; height: number };
  /** 脚底/对齐锚点归一化坐标，如 { x: 0.5, y: 1.0 } */
  anchor: { x: number; y: number };
  /** 核心角色包围盒（用于动态裁剪透明空边与窗口自适应） */
  contentBox: PetBox;
  /** 交互碰撞区定义（头部、肚子等），支持不同点击反应 */
  hitBoxes?: Record<string, PetBox>;
  /** 逐帧动画集 */
  animations: Record<string, PetAnimation>;
  /** 状态到动画名的映射 */
  states: Record<PetState, string>;
  /** 并发任务阶梯规则：1 个任务 working，2 个 juggling，3 个及以上 sweeping */
  tiers: {
    working: { minTasks: 1; maxTasks: 1; anim: string };
    juggling: { minTasks: 2; maxTasks: 2; anim: string };
    sweeping: { minTasks: 3; maxTasks: number; anim: string };
  };
  /** 空闲动作池：按权重随机播放小动作（喷水、发呆、左右张望） */
  idlePool: Array<{
    anim: string;
    weight: number;
    intervalMinMs?: number;
    intervalMaxMs?: number;
  }>;
  /** 状态的特殊插播变体 */
  bonus?: Record<string, { anim: string; chance: number }>;
  /** 交互响应动作 */
  reactions: Partial<Record<PetReaction, string>>;
  /** 时间控制（毫秒） */
  timings: {
    /** 动作最短展示时间，防止多状态频繁跳变抖动 */
    minDisplayMs: number;
    /** 交互或插播动作完成后多久回到 idle */
    autoReturnMs: number;
    /** 唤醒时长 */
    wakeMs: number;
    /** 闲置多久自动进入睡眠（默认 60000ms = 60s） */
    sleepAfterMs: number;
  };
  /** 状态/交互对应的气泡台词；key 可用状态名或 reaction 名 */
  bubbles?: Record<string, string[]>;
}

