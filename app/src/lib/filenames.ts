/**
 * 文件名 / 沙箱路径 sanitize（生成工具与附件展示共用）。
 *
 * 手机端有两个入口会碰到“用户/模型给的文件名”：
 *  - `Intake.kt` 收附件（原生是权威实现，这里不替代它）；
 *  - 轻引擎的 create_docx / create_xlsx / generate_image 落盘。
 *
 * 规则（和原生 Intake 保持一致，P0 1.5 收口）：
 *  - NFC 归一化；只留 CJK/Unicode 字母数字/空格/`.` `_` `-`；
 *  - `#` `%` `/` `\` `:` `*` `?` `"` `<` `>` `|` 与控制字符换 `_`；
 *  - 连续空格折叠成一个；首尾的点和空格剪掉；
 *  - 主名 ≤80、扩展名 ≤16（按码点截断，不会切坏 emoji/中文）；
 *  - 空名回退 `file-<ts>`；可传 mime 补扩展名。
 *
 * `sanitizeSandboxPath` 负责目录段和“扩展名冲突替换”，返回值是沙箱内的
 * 绝对虚拟路径（`/docs/…`）；真正的越界检查仍由 `tools.toSandboxPath` 做。
 */

const NAME_STEM_MAX = 80;
const NAME_EXT_MAX = 16;

/** 扩展名 → MIME（附件分类与生成文件展示共用） */
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
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

/** mime → 主扩展名（同 MIME 多扩展名取 EXT_MIME 顺序的第一个，如 jpg 而不是 jpeg） */
const MIME_EXT: Record<string, string> = {};
for (const [ext, mime] of Object.entries(EXT_MIME)) {
  if (!MIME_EXT[mime]) MIME_EXT[mime] = ext;
}

function normalizeMime(mime?: string | null): string {
  const value = String(mime ?? '').trim().toLowerCase();
  const semi = value.indexOf(';');
  return (semi >= 0 ? value.slice(0, semi) : value).trim();
}

/** 扩展名（可带点、大小写混写）→ 补全用的键；未知返回空串 */
export function normalizeKey(key?: string | null): string {
  return String(key ?? '')
    .trim()
    .replace(/^\.+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, NAME_EXT_MAX);
}

/** 文件扩展名 → MIME；未知返回空串 */
export function mimeForKey(key?: string | null): string {
  return EXT_MIME[normalizeKey(key)] ?? '';
}

/** MIME → 主扩展名；未知返回空串 */
export function keyForMime(mime?: string | null): string {
  const value = normalizeMime(mime);
  return value ? MIME_EXT[value] ?? '' : '';
}

export interface SanitizeNameOptions {
  /** 主名为空时的回退名（不带扩展名）；默认 `file-<ts>` */
  fallback?: string;
  /** 没有扩展名时按 MIME 补一个 */
  mime?: string | null;
  maxStem?: number;
  maxExt?: number;
}

/** Hermes 上 String#normalize 可能存在兼容问题，缺了就不做归一化 */
function nfc(value: string): string {
  try {
    return typeof value.normalize === 'function' ? value.normalize('NFC') : value;
  } catch {
    return value;
  }
}

let unicodeLetterOrNumber: RegExp | null = null;
try {
  // 现代 Hermes 支持 Unicode property escape；不支持时退回下面的区间表
  unicodeLetterOrNumber = new RegExp('^[\\p{L}\\p{N}]$', 'u');
} catch {
  unicodeLetterOrNumber = null;
}

function isNameChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x80) return /[0-9A-Za-z._\- ]/.test(ch);
  if (unicodeLetterOrNumber?.test(ch)) return true;
  // 兜底：和原生 Kotlin 的 Character.isLetterOrDigit 近似
  if (code >= 0x00c0 && code <= 0x024f) return true;
  if (code >= 0x0370 && code <= 0x04ff) return true;
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

/** 按码点截断，避免把 surrogate pair / emoji 切成半个 */
function truncateCodepoints(value: string, max: number): string {
  if (max <= 0) return '';
  let count = 0;
  let out = '';
  for (const ch of value) {
    if (count >= max) break;
    out += ch;
    count += 1;
  }
  return out;
}

function sanitizeFallback(fallback?: string, maxStem = NAME_STEM_MAX): string {
  const raw = String(fallback ?? '').trim();
  let cleaned = '';
  for (const ch of nfc(raw)) cleaned += isNameChar(ch) ? ch : '_';
  const stem = trimDotsAndSpaces(truncateCodepoints(trimDotsAndSpaces(cleaned.replace(/ +/g, ' ')), maxStem));
  return stem || `file-${Date.now()}`;
}

/**
 * 单个文件名 sanitize。
 *
 * `sanitizeFileName('周会 纪要 #1 100%.md')` → `周会 纪要 _1 100_.md`
 */
export function sanitizeFileName(raw?: string | null, options: SanitizeNameOptions = {}): string {
  const maxStem = options.maxStem ?? NAME_STEM_MAX;
  const maxExt = options.maxExt ?? NAME_EXT_MAX;
  const leaf = nfc(String(raw ?? ''))
    .trim()
    .split(/[\\/]/)
    .pop() as string;
  let cleaned = '';
  for (const ch of leaf) cleaned += isNameChar(ch) ? ch : '_';
  // 换行/制表等控制字符已经进 `_`，这里只折叠普通空格
  const base = trimDotsAndSpaces(cleaned.replace(/ +/g, ' '));

  let stem = base;
  let ext = '';
  const dot = base.lastIndexOf('.');
  if (dot > 0 && dot < base.length - 1) {
    const candidate = base.slice(dot + 1);
    if ([...candidate].length <= maxExt) {
      stem = base.slice(0, dot);
      ext = candidate;
    }
  }
  if (!ext) ext = keyForMime(options.mime);

  stem = trimDotsAndSpaces(truncateCodepoints(stem, maxStem));
  if (!stem) stem = sanitizeFallback(options.fallback, maxStem);
  if (!ext) return stem;
  return `${stem}.${truncateCodepoints(ext, maxExt)}`;
}

function normalizeExtension(ext: string): string {
  return normalizeKey(ext);
}

function splitSegments(raw: string): string[] {
  return raw
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '.' && part !== '..');
}

/**
 * 沙箱路径 sanitize：每一段都过文件名规则，最后一段补齐/替换扩展名。
 *
 * `sanitizeSandboxPath('docs/会议 纪要 #1 100%', '.docx', 'docs')`
 * → `/docs/会议 纪要 _1 100_.docx`
 */
export function sanitizeSandboxPath(rawPath: unknown, ext: string, fallbackDir = '/'): string {
  const raw = typeof rawPath === 'string' ? rawPath.trim() : '';
  const endsWithSeparator = /[\\/]\s*$/.test(raw);
  const segments = splitSegments(raw.replace(/^\/?workspace(?=\/|$)/i, ''));
  let filename = segments.pop() ?? '';
  if (endsWithSeparator && filename) {
    segments.push(filename);
    filename = '';
  }
  if (!filename) {
    const directory = splitSegments(fallbackDir).map((part) => sanitizeFileName(part) || 'dir');
    const desired = normalizeExtension(ext);
    const fallbackName = sanitizeFallback();
    const named = desired ? `${fallbackName}.${desired}` : fallbackName;
    return `/${[...directory, named].join('/')}`;
  }

  filename = sanitizeFileName(filename);
  const desired = normalizeExtension(ext);
  if (desired) {
    const dot = filename.lastIndexOf('.');
    const current = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
    if (current === desired) {
      // 已经是目标扩展名，保持原样
    } else if (current) {
      // 冲突扩展名：替换，而不是 report.doc.txt 这样叠两遍
      let stem = filename.slice(0, dot);
      while (stem.toLowerCase().endsWith(`.${desired}`)) {
        stem = stem.slice(0, stem.length - desired.length - 1);
      }
      filename = `${stem}.${desired}`;
    } else {
      filename = `${filename}.${desired}`;
    }
  }

  const directories = segments.map((part) => sanitizeFileName(part) || 'dir');
  return `/${[...directories, filename].join('/')}`;
}
