/**
 * 从会话回合里提取“生成的文件”（P0 1.5）。
 *
 * 轻引擎的工具结果是一段中文文本，例如
 *   `已生成 Word 文档 /workspace/docs/会议 纪要 _1 100_.docx（3 个块，2.1 KB）`
 * 这里按工具名 + 固定前缀解析，不猜别的格式；路径里允许中文、空格、#、%。
 *
 * 只收 `state=done` 且结果里能完整拿到 `/workspace/...` 的块：
 *  - 失败 / 被拒的块跳过；
 *  - 结果被截断（detail 以 `…` 结尾且没有 `（` 边界）时跳过，避免“打开半截路径”；
 *  - 同一路径只留最后一次（模型可能先写废再覆盖）。
 */
import type { Turn } from '../protocol';
import { mimeForKey } from './filenames';

export type GeneratedFileKind = 'docx' | 'xlsx' | 'image' | 'file';

export interface GeneratedFile {
  /** 沙箱内相对路径，例如 `docs/会议 纪要 _1 100_.docx` */
  relPath: string;
  /** 文件名（relPath 最后一段） */
  name: string;
  mime: string;
  kind: GeneratedFileKind;
}

interface ResultSpec {
  prefix: string;
  kind: GeneratedFileKind;
  fallbackMime: string;
}

const RESULT_SPECS: Record<string, ResultSpec> = {
  create_docx: {
    prefix: '已生成 Word 文档 ',
    kind: 'docx',
    fallbackMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  create_xlsx: {
    prefix: '已生成 Excel ',
    kind: 'xlsx',
    fallbackMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  generate_image: {
    prefix: '已生成图片 ',
    kind: 'image',
    fallbackMime: 'image/png',
  },
  write_file: {
    prefix: '已写入 ',
    kind: 'file',
    fallbackMime: 'text/plain',
  },
};

function parseSandboxPath(detail: string, spec: ResultSpec): string | null {
  if (!detail.startsWith(spec.prefix)) return null;
  const rest = detail.slice(spec.prefix.length);
  const boundary = rest.indexOf('（');
  // 结果被 clip 到 200 字且没截到 `（`：路径可能不完整，宁可跳过
  if (boundary < 0 && detail.endsWith('…')) return null;
  const raw = (boundary >= 0 ? rest.slice(0, boundary) : rest).trim();
  if (!raw.startsWith('/workspace/')) return null;
  const relPath = raw.slice('/workspace/'.length).replace(/^\/+/, '');
  if (!relPath) return null;
  const segments = relPath.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return null;
  }
  return relPath;
}

/** 扫描回合里的工具块，返回去重后的生成文件（按首次出现顺序） */
export function collectGeneratedFiles(turns: Turn[]): GeneratedFile[] {
  const found = new Map<string, GeneratedFile>();
  for (const turn of turns) {
    for (const block of turn.blocks) {
      if (block.kind !== 'tool') continue;
      if (block.state !== 'done') continue;
      const detail = block.detail ?? '';
      if (!detail || detail.startsWith('[错误]') || detail.startsWith('[已拒绝]')) continue;
      const spec = RESULT_SPECS[block.name];
      if (!spec) continue;
      const relPath = parseSandboxPath(detail, spec);
      if (!relPath) continue;
      const name = relPath.split('/').pop() ?? relPath;
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 ? name.slice(dot + 1) : '';
      const mime = (ext ? mimeForKey(ext) : '') || spec.fallbackMime;
      // 同一路径后出现的覆盖前面的（重新生成/覆盖写）
      found.set(relPath, { relPath, name, mime, kind: spec.kind });
    }
  }
  return [...found.values()];
}

/** 面板上的类型标签 */
export function generatedFileLabel(kind: GeneratedFileKind): string {
  switch (kind) {
    case 'docx':
      return 'Word';
    case 'xlsx':
      return 'Excel';
    case 'image':
      return '图片';
    case 'file':
      return '文件';
  }
}
