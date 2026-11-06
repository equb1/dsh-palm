/**
 * 轻引擎图片视觉（M2.4）。
 *
 * 1.3 把附件落在 /workspace/uploads，只给模型路径；这里把图片读成 data URL，
 * 按 OpenAI 兼容的 image_url 形状发出去。没有视觉能力的模型只保留路径并明确提示。
 *
 * 只做本地文件 → data URL：手机工作区没有公网 URL，provider 也拿不到 file://。
 * 限制单张 8MB、最多 4 张，超限降级为路径，避免把内存/上下文打爆。
 */
import type { FileRef } from '../../protocol';
import { bytesToBase64 } from '../fs/encoding';

export const MAX_VISION_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VISION_TOTAL_BYTES = 16 * 1024 * 1024;
export const MAX_VISION_IMAGES = 4;

const VISION_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** 常见视觉模型名；未知模型按不支持处理，走路径降级 */
const VISION_MODEL_RE =
  /(gpt-4o|gpt-4\.1|gpt-5|o3|o4|claude-(3|4)|gemini|qwen.*vl|llava|pixtral|vision|multimodal)/i;

export function supportsVisionModel(model: string): boolean {
  return VISION_MODEL_RE.test(model.trim());
}

export function normalizeVisionMime(mime: string | undefined): string | undefined {
  const value = (mime ?? '').trim().toLowerCase();
  if (value === 'image/jpg') return 'image/jpeg';
  return VISION_MIME.has(value) ? value : undefined;
}

export interface VisionFileRef {
  /** SandboxFs 的虚拟路径，例如 /uploads/x.png */
  path: string;
  mime: string;
}

export interface VisionSelection {
  /** 可以按视觉输入发送的图片 */
  accepted: FileRef[];
  /** 有图片但被降级的数量 */
  rejected: number;
  /** 输入里是否出现过图片（用来说明「模型不支持视觉」） */
  hasImages: boolean;
  note?: string;
}

/** 从 sessions.send 的 files 里挑出可发送的图片；纯函数，便于单测 */
export function selectVisionFiles(
  files: readonly FileRef[] | undefined,
  supportsVision: boolean,
): VisionSelection {
  const list = files ?? [];
  const imageFiles = list.filter((file) => Boolean(normalizeVisionMime(file.mime)));
  if (imageFiles.length === 0) return { accepted: [], rejected: 0, hasImages: false };

  if (!supportsVision) {
    return {
      accepted: [],
      rejected: imageFiles.length,
      hasImages: true,
      note: '当前模型未声明视觉能力，图片只保留路径。',
    };
  }

  const accepted: FileRef[] = [];
  let rejected = 0;
  let totalBytes = 0;
  for (const file of imageFiles) {
    const size = typeof file.bytes === 'number' ? file.bytes : 0;
    const tooLarge = size > MAX_VISION_IMAGE_BYTES;
    const overTotal = totalBytes + size > MAX_VISION_TOTAL_BYTES;
    if (tooLarge || overTotal || accepted.length >= MAX_VISION_IMAGES) {
      rejected += 1;
      continue;
    }
    accepted.push(file);
    totalBytes += size;
  }

  return {
    accepted,
    rejected,
    hasImages: true,
    ...(rejected > 0
      ? {
          note: `部分图片超过视觉上限（最多 ${MAX_VISION_IMAGES} 张 / 单张 8MB / 合计 16MB），只保留路径。`,
        }
      : {}),
  };
}

/** FileRef → 历史里持久化的轻量引用（不存 base64） */
export function visionFileRef(file: FileRef): VisionFileRef {
  const mime = normalizeVisionMime(file.mime) ?? 'image/png';
  const rel = file.relPath.replace(/^\/+/, '');
  return { path: `/${rel}`, mime };
}

/** 读到的字节 → OpenAI 兼容的 data URL */
export function visionDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
