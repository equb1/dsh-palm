import * as ImagePicker from 'expo-image-picker';
import { NativeModules, Platform } from 'react-native';

import type { FileRef, IntakeShare, IntakeSource } from './types';

/**
 * 原生附件收件（Android）。
 *
 * 复制文件、算 hash 都在原生后台线程做；JS 只拿路径引用，**不碰 base64**。
 * 非 Android / Expo Go 走 `intake.ts` 的空实现。
 */
interface IntakeNative {
  intakeFiles?(sources: IntakeSource[]): Promise<FileRef[]>;
  intakeShare?(): Promise<IntakeShare | null>;
  clearShare?(): Promise<boolean>;
  pickAttachments?(mimeType: string | null): Promise<FileRef[]>;
}

const native: IntakeNative | null =
  Platform.OS === 'android' ? ((NativeModules.DshPalmHost as IntakeNative | undefined) ?? null) : null;

export const intakeAvailable = typeof native?.intakeFiles === 'function';

/** 一批 URI/路径 → 已落盘的 FileRef[]；原生全失败时 reject 中文原因 */
export async function intakeFiles(sources: IntakeSource[]): Promise<FileRef[]> {
  if (!native?.intakeFiles || sources.length === 0) return [];
  // 只传存在的字段：RN 桥对 undefined 不友好
  const payload = sources.map((source) => ({
    ...(source.uri ? { uri: source.uri } : {}),
    ...(source.path ? { path: source.path } : {}),
    ...(source.name ? { name: source.name } : {}),
    ...(source.mime ? { mime: source.mime } : {}),
  }));
  return (await native.intakeFiles(payload)) ?? [];
}

/** 取走系统分享的内容；没有待处理分享时返回 null */
export async function intakeShare(): Promise<IntakeShare | null> {
  if (!native?.intakeShare) return null;
  return (await native.intakeShare()) ?? null;
}

/** 丢掉尚未消费的分享 Intent */
export async function clearShare(): Promise<void> {
  if (!native?.clearShare) return;
  await native.clearShare().catch(() => undefined);
}

/** 系统文件选择器（原生内部直接收件） */
export async function pickAttachments(mimeType = '*/*'): Promise<FileRef[]> {
  if (!native?.pickAttachments) return [];
  return (await native.pickAttachments(mimeType)) ?? [];
}

/**
 * 相册选图：只拿 URI，`base64:false`（大图不读进 JS 内存）。
 * 返回 null 表示用户取消；返回 [] 表示相册不可用，调用方回退到文件选择器。
 */
export async function intakeImagePicker(): Promise<IntakeSource[] | null> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return [];
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
      base64: false,
    });
    if (result.canceled) return null;
    return result.assets.map((asset) => ({
      uri: asset.uri,
      ...(asset.fileName ? { name: asset.fileName } : {}),
      ...(asset.mimeType ? { mime: asset.mimeType } : {}),
    }));
  } catch {
    return [];
  }
}
