/**
 * 轻引擎的创建入口（web / 非 Android 环境）。
 *
 * 真机实现见 `light.native.ts`：它用 expo-file-system 落真实工作区。
 * web 上既没有工作区也拿不到 SecureStore，所以明确报"不支持"，
 * 不要做一个跑在内存里的假引擎让用户以为能用。
 */
import type { LightHost } from '../engine/light/host';
import type { LightEngineSetup } from '../engine/light/config';

export type { LightEngineSetup } from '../engine/light/config';

/** 工作区自检：M1 实验室里"命令真的落到目录里"那条验证 */
export interface SelfCheckCase {
  command: string;
  ms: number;
  exitCode: number;
  out: string;
  error?: string;
}

export interface WorkspaceSelfCheck {
  root: string;
  kind: string;
  totalMs: number;
  results: SelfCheckCase[];
}

export async function createLightHost(_setup: LightEngineSetup): Promise<LightHost> {
  throw new Error('轻引擎需要 Android / iOS 原生构建（Expo Go 和 web 上没有真实工作区）');
}

export async function loadLightConfig(): Promise<LightEngineSetup | null> {
  return null;
}

export async function saveLightConfig(_setup: LightEngineSetup): Promise<void> {
  // web 上不持久化
}

export async function runWorkspaceSelfCheck(): Promise<WorkspaceSelfCheck> {
  throw new Error('工作区自检需要 Android / iOS 原生构建');
}
