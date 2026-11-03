import * as ImagePicker from 'expo-image-picker';
import { NativeModules, Platform } from 'react-native';

/**
 * 原生端选择附件（图片 / 视频 / 音频 / 任意文件）。
 *
 * - 图片：优先用 expo-image-picker（系统相册 + 自动将大图压缩到 0.75，避免 15MB 原图撑爆 JSON），
 *   拿不到 base64 时自动回退到原生 SAF `DshPalmHost.pickAttachments('image/*')`。
 * - 视频 / 音频 / 任意文件：直接调原生 `DshPalmHost.pickAttachments(mime)` 打开 Android 系统文件选择器（支持多选）。
 */

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

export interface PickedFile {
  base64: string;
  name: string;
  mime?: string;
  size?: number;
  kind?: AttachmentKind;
}

interface NativePickedItem {
  name: string;
  mime?: string;
  size?: number;
  base64: string;
}

interface PickNativeModule {
  pickAttachments?(mimeType: string | null): Promise<NativePickedItem[]>;
}

const native: PickNativeModule | null =
  Platform.OS === 'android' ? ((NativeModules.DshPalmHost as PickNativeModule | undefined) ?? null) : null;

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function mimeForKind(kind: AttachmentKind): string {
  switch (kind) {
    case 'image':
      return 'image/*';
    case 'video':
      return 'video/*';
    case 'audio':
      return 'audio/*';
    default:
      return '*/*';
  }
}

function inferKind(mime: string | undefined, fallback: AttachmentKind): AttachmentKind {
  if (!mime) return fallback;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return fallback;
}

export async function pickAttachments(kind: AttachmentKind = 'file'): Promise<PickedFile[]> {
  if (kind === 'image') {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.granted) {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.75,
          base64: true,
          allowsMultipleSelection: true,
        });
        if (!result.canceled && result.assets.length > 0) {
          const out: PickedFile[] = [];
          for (const asset of result.assets) {
            if (!asset.base64) continue;
            if (asset.fileSize && asset.fileSize > MAX_IMAGE_BYTES) {
              throw new Error(`图片「${asset.fileName ?? ''}」太大（上限 15MB）`);
            }
            const ext = asset.mimeType?.split('/')[1] || 'jpg';
            out.push({
              base64: asset.base64,
              name: asset.fileName ?? `image-${Date.now()}.${ext}`,
              mime: asset.mimeType ?? 'image/jpeg',
              size: asset.fileSize,
              kind: 'image',
            });
          }
          if (out.length > 0) return out;
        } else if (result.canceled) {
          return [];
        }
      }
    } catch (err) {
      // 如果只是图片过大报错，直接抛给上层提示
      if (err instanceof Error && err.message.includes('太大')) throw err;
    }
  }

  if (native?.pickAttachments) {
    const items = await native.pickAttachments(mimeForKind(kind));
    return (items ?? []).map((item) => ({
      base64: item.base64,
      name: item.name,
      mime: item.mime,
      size: item.size,
      kind: inferKind(item.mime, kind),
    }));
  }

  return [];
}

export async function pickImage(): Promise<PickedFile | null> {
  const list = await pickAttachments('image');
  return list[0] ?? null;
}

