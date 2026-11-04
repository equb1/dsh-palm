/**
 * 附件命名 / 分类 / 路径（纯函数）。
 *
 * 原生 `Intake.kt` 是收件与命名的权威实现；这里的 `sanitizeName`
 * 是它的镜像（Web 调试、测试、展示兜底），改规则时两边一起改。
 */
import type { AttachmentClass, AttachmentEngine, AttachmentKind } from './types';

export const UPLOADS_REL_DIR = 'uploads';
/** 超过这个大小只在 chip 上提示「只按路径引用」 */
export const LARGE_BYTES = 20 * 1024 * 1024;

const NAME_STEM_MAX = 80;
const NAME_EXT_MAX = 16;

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  ppt: 'application/vnd.ms-powerpoint',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
};

/** mime → 主扩展名（同 mime 多个扩展名时按 EXT_MIME 顺序取第一个，如 jpg 而不是 jpeg） */
const MIME_EXT: Record<string, string> = {};
for (const [ext, mime] of Object.entries(EXT_MIME)) {
  if (!MIME_EXT[mime]) MIME_EXT[mime] = ext;
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']);
/** 轻引擎能直接读的文本/Office 格式 */
const LIGHT_EXT = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'docx', 'xlsx']);
const LIGHT_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const DOC_EXT = new Set([
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'doc',
  'ppt',
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'rtf',
  'odt',
  'ods',
  'odp',
]);
const DOC_MIME_PREFIXES = [
  'text/',
  'application/json',
  'application/pdf',
  'application/msword',
  'application/rtf',
  'application/vnd.ms-',
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.oasis.opendocument',
];

function normalizeMime(mime?: string | null): string {
  const value = String(mime ?? '').trim().toLowerCase();
  if (!value) return '';
  const semi = value.indexOf(';');
  return (semi >= 0 ? value.slice(0, semi) : value).trim();
}

/** 文件名里最后一段（去掉目录），扩展名小写 */
export function extensionOf(name?: string | null): string {
  const leaf = String(name ?? '').trim().split(/[\\/]/).pop() ?? '';
  const dot = leaf.lastIndexOf('.');
  if (dot <= 0 || dot >= leaf.length - 1) return '';
  return leaf.slice(dot + 1).toLowerCase();
}

function isNameChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  if (code < 0x80) return /[0-9A-Za-z._\- ]/.test(ch);
  // 约等于 Kotlin 的 Character.isLetterOrDigit：常用字母表 + CJK
  if ((code >= 0x00c0 && code <= 0x024f) || (code >= 0x0370 && code <= 0x04ff)) return true;
  if (code >= 0x3040 && code <= 0x30ff) return true;
  if (code >= 0x3400 && code <= 0x9fff) return true;
  if (code >= 0xac00 && code <= 0xd7af) return true;
  if (code >= 0xf900 && code <= 0xfaff) return true;
  if (code >= 0xff10 && code <= 0xff19) return true;
  if (code >= 0xff21 && code <= 0xff3a) return true;
  if (code >= 0xff41 && code <= 0xff5a) return true;
  return false;
}

function trimDotsAndSpaces(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && (value[start] === ' ' || value[start] === '.')) start += 1;
  while (end > start && (value[end - 1] === ' ' || value[end - 1] === '.')) end -= 1;
  return value.slice(start, end);
}

function extensionForMime(mime?: string | null): string {
  const value = normalizeMime(mime);
  return value ? MIME_EXT[value] ?? '' : '';
}

/**
 * 文件名 sanitize（镜像 Kotlin）：只留 CJK/字母/数字/`._-` 和空格，
 * `#%/\:*?"<>|` 与控制字符换 `_`；主名 ≤80、扩展名 ≤16；空名回退 `file-<ts>`。
 */
export function sanitizeName(raw?: string | null, mime?: string | null): string {
  const leaf = String(raw ?? '').trim().split(/[\\/]/).pop() ?? '';
  let cleaned = '';
  for (let i = 0; i < leaf.length; i += 1) {
    const ch = leaf.charAt(i);
    cleaned += isNameChar(ch) ? ch : '_';
  }
  const base = trimDotsAndSpaces(cleaned.replace(/ +/g, ' '));

  let stem = base;
  let ext = '';
  const dot = base.lastIndexOf('.');
  if (dot > 0 && dot < base.length - 1) {
    const candidate = base.slice(dot + 1);
    if (candidate.length <= NAME_EXT_MAX) {
      stem = base.slice(0, dot);
      ext = candidate;
    }
  }
  if (!ext) ext = extensionForMime(mime);
  if (!stem.trim()) stem = `file-${Date.now()}`;
  stem = trimDotsAndSpaces(stem.slice(0, NAME_STEM_MAX));
  if (!stem) stem = `file-${Date.now()}`;
  return ext ? `${stem}.${ext.slice(0, NAME_EXT_MAX)}` : stem;
}

/** sha256 前 16 位，用来组 `<hash16>-<name>` */
export function hashPrefix(hash?: string | null, length = 16): string {
  const hex = String(hash ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
  return hex.slice(0, Math.max(0, length));
}

/** 引擎工作区里的相对路径（轻 / 完整引擎按各自根目录拼） */
export function buildRelPath(hash: string | undefined, name: string): string {
  const safe = sanitizeName(name);
  const prefix = hashPrefix(hash);
  return `${UPLOADS_REL_DIR}/${prefix ? `${prefix}-` : ''}${safe}`;
}

/** 人类可读大小；未知返回「未知大小」 */
export function formatBytes(bytes?: number | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '未知大小';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** 大文件只走路径（>20MB），不是「不能收」 */
export function isLarge(bytes?: number | null): boolean {
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes > LARGE_BYTES;
}

function kindOf(mimeType: string, ext: string): AttachmentKind {
  if (mimeType.startsWith('image/') || IMAGE_EXT.has(ext)) return 'image';
  if (mimeType.startsWith('video/') || VIDEO_EXT.has(ext)) return 'video';
  if (mimeType.startsWith('audio/') || AUDIO_EXT.has(ext)) return 'audio';
  if (DOC_EXT.has(ext) || DOC_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) return 'document';
  return 'file';
}

/**
 * 分类矩阵：
 *  - 图片：kind=image，引擎标「完整」（轻引擎还不读图）；
 *  - text/md/json/csv/docx/xlsx：轻引擎可直接读；
 *  - pdf / pptx / doc / ppt / 音视频 / 其它：只保存路径 + 提示；
 *  - >20MB：额外提示只按路径引用。
 */
export function classify(mime?: string | null, name?: string | null, bytes?: number | null): AttachmentClass {
  const ext = extensionOf(name);
  const mimeType = normalizeMime(mime) || (ext ? EXT_MIME[ext] ?? '' : '');
  const kind = kindOf(mimeType, ext);

  let engine: AttachmentEngine = 'full';
  let saveOnly = false;
  let hint: string | undefined;
  if (kind === 'image') {
    // 轻引擎目前只能给路径，不接视觉；图片统一标「完整」
    engine = 'full';
  } else if (kind === 'video' || kind === 'audio') {
    saveOnly = true;
    hint = kind === 'video' ? '视频只保存文件，不解析' : '音频只保存文件，不解析';
  } else if (mimeType === 'application/pdf' || ext === 'pdf') {
    saveOnly = true;
    hint = 'PDF 暂不解析，只保存文件路径';
  } else if (LIGHT_EXT.has(ext) || LIGHT_MIMES.has(mimeType)) {
    engine = 'light';
  } else {
    saveOnly = true;
    hint = '这个格式暂不解析，只保存文件路径';
  }

  if (isLarge(bytes)) {
    const large = `${formatBytes(bytes)}，超过 20MB，只按路径引用`;
    hint = hint ? `${hint}；${large}` : large;
  }
  return { kind, engine, saveOnly, ...(hint ? { hint } : {}) };
}
