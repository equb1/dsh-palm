/**
 * 附件收件的非原生实现（Web / Node 调试用）。
 *
 * 真正的收件在 Android 原生 `Intake.kt`：这里全部返回空，
 * 不伪装成功、也不产生 base64 —— Web 上附件面板应是不可用状态。
 */
import type { FileRef, IntakeShare, IntakeSource } from './types';

export const intakeAvailable = false;

export async function intakeFiles(_sources: IntakeSource[]): Promise<FileRef[]> {
  return [];
}

export async function intakeShare(): Promise<IntakeShare | null> {
  return null;
}

export async function clearShare(): Promise<void> {
  /* Web 没有系统分享 Intent */
}

export async function pickAttachments(_mimeType = '*/*'): Promise<FileRef[]> {
  return [];
}

export async function intakeImagePicker(): Promise<IntakeSource[] | null> {
  return [];
}
