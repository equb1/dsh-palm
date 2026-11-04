/**
 * 轻引擎的工具集。
 *
 * 覆盖 M1 的「文档 / 票据 / 纪要」：
 *  - bash：just-bash，落真实工作区（审批）
 *  - read_file / list_dir：读文本
 *  - write_file：写文本（审批）
 *  - create_docx / create_xlsx：结构化内容 → 真实 Office 文件（审批）
 *  - read_docx / read_xlsx：把用户已有的文档读回文本
 *  - generate_image：可选生图渠道（审批；没配就明确报错）
 *  - ask_user_question：把选择交回给界面
 *
 * 刻意不做「工具白名单之外的兼容层」：DSH 的老插件不在这里跑（docs/23 §4.4）。
 */
import type { AgentTool, AgentTool as Tool, PermissionPreset, ToolContext } from './types';
import { buildDocx, extractDocxText, type DocxBlock } from '../docs/docx';
import { buildXlsx, extractXlsxText, type SheetSpec } from '../docs/xlsx';
import { generateImage, extensionForImageMime, pngSize } from './image';
import { joinPath, normalizePath } from '../fs/path';
import { truncateMiddle } from '../shell/bash';
import { sanitizeSandboxPath } from '../../lib/filenames';

export const WORKSPACE_ROOT = '/workspace';

/** 模型给的路径 → 沙箱里的绝对路径（永远落在工作区里） */
export function toSandboxPath(input: unknown): string {
  const raw = typeof input === 'string' && input.trim().length > 0 ? input.trim() : '.';
  const virtual = raw.startsWith(`${WORKSPACE_ROOT}`)
    ? raw
    : raw.startsWith('/')
      ? `${WORKSPACE_ROOT}${raw}`
      : joinPath(WORKSPACE_ROOT, raw);
  const normalized = normalizePath(virtual);
  if (normalized === WORKSPACE_ROOT) return '/';
  if (!normalized.startsWith(`${WORKSPACE_ROOT}/`)) {
    throw new Error(`路径越出工作区：${raw}（只能访问 ${WORKSPACE_ROOT} 以内）`);
  }
  return normalized.slice(WORKSPACE_ROOT.length);
}

/** 沙箱路径 → 展示路径（给模型看的 /workspace/...） */
export function toDisplayPath(sandboxPath: string): string {
  return sandboxPath === '/' ? WORKSPACE_ROOT : `${WORKSPACE_ROOT}${sandboxPath}`;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

const READ_LIMIT_LINES = 400;
const READ_MAX_LINES = 2_000;
const READ_MAX_CHARS = 40_000;
const LIST_MAX_ENTRIES = 500;

const bashTool: Tool = {
  name: 'bash',
  description:
    '在工作区 /workspace 里执行一条 bash 命令。支持管道、重定向、变量、循环，以及 just-bash 内置的 grep/sed/awk/find/ls/cat/jq 等命令。' +
    '没有 node / python / git / ffmpeg，也没有网络。当前目录是 /workspace，文件路径可以直接写相对路径。',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的 bash 命令（单条，可含管道和 &&）' },
      timeout_ms: { type: 'number', description: '超时毫秒数，默认 30000，上限 120000' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  needsApproval: true,
  describeApproval(args) {
    const command = asString(args.command);
    const risky = /(rm\s+-[a-z]*r[a-z]*f|mkfs|dd\s+if=|shutdown|reboot|:\(\)\s*\{|chmod\s+777\s+\/)/i.test(
      command,
    );
    return {
      title: '执行命令',
      command,
      risk: risky ? 'high' : 'medium',
      summary: risky
        ? '这条命令看起来会删改系统级内容。工作区之外也读不到东西，但仍建议先看清楚。'
        : '会在手机的工作区 /workspace 里执行这条命令。',
    };
  },
  async execute(args, ctx) {
    const command = asString(args.command).trim();
    if (!command) return '[错误] command 为空';
    if (command.length > 20_000) return '[错误] 命令太长（上限 20000 字符）';
    const timeoutMs = Math.min(Math.max(asInt(args.timeout_ms, 30_000), 1_000), 120_000);
    const result = await ctx.bash.run(command, { signal: ctx.signal, timeoutMs });
    return result.text;
  },
};

const readFileTool: Tool = {
  name: 'read_file',
  description:
    '读取工作区里的一个文本文件，返回带行号的内容。大文件用 offset/limit 分段读。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径，相对于 /workspace（也可以写 /workspace/a.txt）' },
      offset: { type: 'number', description: '起始行号，从 1 开始，默认 1' },
      limit: { type: 'number', description: '最多读多少行，默认 400，上限 2000' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const target = toSandboxPath(args.path);
    const display = toDisplayPath(target);
    let stat;
    try {
      stat = await ctx.fs.stat(target);
    } catch (error) {
      return `[错误] ${error instanceof Error ? error.message : String(error)}`;
    }
    if (stat.isDirectory) return `[错误] ${display} 是目录，请用 list_dir`;
    let text: string;
    try {
      text = await ctx.fs.readFile(target);
    } catch (error) {
      return `[错误] ${error instanceof Error ? error.message : String(error)}`;
    }
    const lines = text.split('\n');
    const offset = Math.max(asInt(args.offset, 1), 1);
    const limit = Math.min(Math.max(asInt(args.limit, READ_LIMIT_LINES), 1), READ_MAX_LINES);
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const numbered = slice
      .map((line, index) => `${String(offset + index).padStart(6)} | ${line}`)
      .join('\n');
    const body = truncateMiddle(numbered, READ_MAX_CHARS).text;
    const shownTo = Math.min(offset + slice.length - 1, lines.length);
    return `${display}（共 ${lines.length} 行，显示 ${offset}-${shownTo}）\n${body}`;
  },
};

const writeFileTool: Tool = {
  name: 'write_file',
  description: '把文本写入工作区里的一个文件（覆盖已有内容；父目录不存在会自动创建）。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目标文件路径，相对于 /workspace' },
      content: { type: 'string', description: '完整文件内容' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  needsApproval: true,
  describeApproval(args) {
    const path = asString(args.path);
    const content = asString(args.content);
    let display = path;
    try {
      display = toDisplayPath(toSandboxPath(path));
    } catch {
      display = path;
    }
    return {
      title: '写入文件',
      command: `${display}  （${content.length} 字符）`,
      risk: 'medium',
      summary: '会覆盖工作区里的这个文件；原有内容不保留。',
    };
  },
  async execute(args, ctx) {
    const target = toSandboxPath(args.path);
    const content = asString(args.content);
    if (content.length > 2 * 1024 * 1024) return '[错误] 内容超过 2MB，手机端拒绝写入';
    const parent = target === '/' ? '/' : target.slice(0, target.lastIndexOf('/')) || '/';
    try {
      if (parent !== '/') await ctx.fs.mkdir(parent, { recursive: true });
      await ctx.fs.writeFile(target, content);
    } catch (error) {
      return `[错误] ${error instanceof Error ? error.message : String(error)}`;
    }
    return `已写入 ${toDisplayPath(target)}（${content.length} 字符）`;
  },
};

const listDirTool: Tool = {
  name: 'list_dir',
  description: '列出一个目录下的文件和子目录。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目录路径，默认 /workspace' },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const target = toSandboxPath(args.path);
    const display = toDisplayPath(target);
    let entries;
    try {
      entries = await ctx.fs.readdirWithFileTypes(target);
    } catch (error) {
      return `[错误] ${error instanceof Error ? error.message : String(error)}`;
    }
    if (entries.length === 0) return `${display} 是空目录`;
    const rows = entries
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
      .slice(0, LIST_MAX_ENTRIES)
      .map((entry) => `${entry.isDirectory ? 'd' : 'f'} ${entry.name}${entry.isDirectory ? '/' : ''}`);
    const more = entries.length > LIST_MAX_ENTRIES ? `\n…还有 ${entries.length - LIST_MAX_ENTRIES} 项` : '';
    return `${display}（${entries.length} 项）\n${rows.join('\n')}${more}`;
  },
};

const askUserTool: Tool = {
  name: 'ask_user_question',
  description:
    '向用户提问并等待回答。用户可能选一个选项，也可能直接输入文字，还可能跳过。' +
    '适合需要用户做选择（格式、口味、范围）或确认真实世界的信息；不要拿它问代码里能查到的东西。',
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: '问题列表；当前轻引擎一次只处理第一个问题',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '问题 id（可选）' },
            header: { type: 'string', description: '卡片标题，一句话' },
            question: { type: 'string', description: '问题本身' },
            multi_select: { type: 'boolean', description: '是否多选' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['label'],
              },
            },
          },
          required: ['question'],
        },
      },
    },
    required: ['questions'],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const list = Array.isArray(args.questions) ? (args.questions as Array<Record<string, unknown>>) : [];
    const first = list[0];
    if (!first) return '[错误] questions 为空';
    const options = Array.isArray(first.options)
      ? (first.options as Array<Record<string, unknown>>)
          .map((option) => ({
            label: asString(option.label),
            ...(typeof option.description === 'string' ? { description: option.description } : {}),
          }))
          .filter((option) => option.label.length > 0)
      : [];
    const answer = await ctx.askUser({
      ...(typeof first.id === 'string' ? { id: first.id } : {}),
      ...(typeof first.header === 'string' ? { header: first.header } : {}),
      question: asString(first.question),
      ...(options.length > 0 ? { options } : {}),
      ...(first.multi_select === true ? { multiSelect: true } : {}),
    });
    return JSON.stringify({ answers: [answer] });
  },
};

/* ------------------------------------------------------------------ *
 * 文档 / 表格 / 图片
 * ------------------------------------------------------------------ */

/** 模型给的文件名先 sanitize，再交给 `toSandboxPath` 做越界检查（安全边界不变） */
function generatedPath(path: unknown, extension: string, fallbackDir: string): string {
  return toSandboxPath(sanitizeSandboxPath(asString(path), extension, fallbackDir));
}

function parseBlocks(input: unknown): DocxBlock[] {
  const list = Array.isArray(input) ? (input as unknown[]) : [];
  const blocks: DocxBlock[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const type = asString(item.type);
    const text = asString(item.text);
    switch (type) {
      case 'heading':
        if (text) blocks.push({ type: 'heading', text, ...(typeof item.level === 'number' ? { level: item.level } : {}) });
        break;
      case 'paragraph':
        if (text) blocks.push({ type: 'paragraph', text });
        break;
      case 'bullet':
        if (text) blocks.push({ type: 'bullet', text });
        break;
      case 'numbered':
        if (text) blocks.push({ type: 'numbered', text });
        break;
      case 'code':
        if (text) blocks.push({ type: 'code', text });
        break;
      case 'pageBreak':
        blocks.push({ type: 'pageBreak' });
        break;
      case 'table': {
        const rows = Array.isArray(item.rows) ? (item.rows as unknown[]) : [];
        const normalized = rows
          .map((row) => (Array.isArray(row) ? (row as unknown[]).map((value) => asString(value)) : []))
          .filter((row) => row.length > 0);
        if (normalized.length > 0) {
          blocks.push({ type: 'table', rows: normalized, ...(item.header === false ? { header: false } : {}) });
        }
        break;
      }
      default:
        throw new Error(`不支持的 block 类型：${type || '(空)'}`);
    }
  }
  if (blocks.length === 0) throw new Error('blocks 为空');
  return blocks;
}

function parseSheets(input: unknown): SheetSpec[] {
  const list = Array.isArray(input) ? (input as unknown[]) : [];
  const sheets: SheetSpec[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const rows = Array.isArray(item.rows) ? (item.rows as unknown[]) : [];
    const normalized = rows.map((row) =>
      (Array.isArray(row) ? row : [row]).map((value) => {
        if (value == null) return null;
        if (typeof value === 'number' || typeof value === 'boolean') return value;
        return asString(value);
      }),
    );
    if (normalized.length === 0) continue;
    sheets.push({ name: asString(item.name) || `Sheet${sheets.length + 1}`, rows: normalized });
  }
  if (sheets.length === 0) throw new Error('sheets 为空');
  return sheets;
}

const createDocxTool: Tool = {
  name: 'create_docx',
  description:
    '把结构化内容写成 Word 文档（.docx）存到工作区。blocks 是有序数组：heading（可带 level 1-4）、' +
    'paragraph、bullet、numbered、table（rows 二维数组）、code、pageBreak。中文没问题。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目标路径，例如 docs/会议纪要.docx（没有扩展名会自动补）' },
      title: { type: 'string', description: '文档标题，可选' },
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['heading', 'paragraph', 'bullet', 'numbered', 'table', 'code', 'pageBreak'],
            },
            text: { type: 'string' },
            level: { type: 'number', description: 'heading 的层级，1-4' },
            rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            header: { type: 'boolean', description: 'table 第一行是否当表头，默认是' },
          },
          required: ['type'],
        },
      },
    },
    required: ['path', 'blocks'],
    additionalProperties: false,
  },
  needsApproval: true,
  describeApproval(args) {
    const path = asString(args.path);
    let display = path;
    try {
      display = toDisplayPath(generatedPath(path, '.docx', 'docs'));
    } catch {
      display = path;
    }
    const blocks = Array.isArray(args.blocks) ? args.blocks.length : 0;
    return {
      title: '生成 Word 文档',
      command: `${display}（${blocks} 个块）`,
      risk: 'medium',
      summary: '会在工作区里生成一个 .docx 文件；同名文件会被覆盖。',
    };
  },
  async execute(args, ctx) {
    const target = generatedPath(args.path, '.docx', 'docs');
    const display = toDisplayPath(target);
    try {
      const blocks = parseBlocks(args.blocks);
      const bytes = await buildDocx({
        ...(typeof args.title === 'string' && args.title.trim() ? { title: args.title.trim() } : {}),
        blocks,
      });
      const parent = target.slice(0, target.lastIndexOf('/')) || '/';
      if (parent !== '/') await ctx.fs.mkdir(parent, { recursive: true });
      await ctx.fs.writeFile(target, bytes);
      return `已生成 Word 文档 ${display}（${blocks.length} 个块，${(bytes.length / 1024).toFixed(1)} KB）`;
    } catch (error) {
      return `[错误] ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

const readDocxTool: Tool = {
  name: 'read_docx',
  description: '读取工作区里的 .docx，抽取纯文本（段落换行、表格用制表符分隔）。不能还原图片和复杂样式。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'docx 路径' },
      max_chars: { type: 'number', description: '最多返回多少字符，默认 30000' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const target = toSandboxPath(args.path);
    const display = toDisplayPath(target);
    try {
      const bytes = await ctx.fs.readFileBuffer(target);
      const text = extractDocxText(bytes);
      const max = Math.max(500, Math.min(asInt(args.max_chars, 30_000), 60_000));
      const clipped = truncateMiddle(text, max);
      return `${display}（${text.split('\n').length} 行）\n${clipped.text}`;
    } catch (error) {
      return `[错误] ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

const createXlsxTool: Tool = {
  name: 'create_xlsx',
  description:
    '把二维数据写成 Excel（.xlsx）存到工作区。sheets 是数组，每项 {name, rows}，rows 是二维数组' +
    '（第一行通常是表头）。数字会按数字写入，其它按文本。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目标路径，例如 docs/报销单.xlsx' },
      sheets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '工作表名，最多 31 字' },
            rows: {
              type: 'array',
              description: '二维数组；单元格可以是字符串/数字/布尔/null',
              items: { type: 'array', items: {} },
            },
          },
          required: ['rows'],
        },
      },
    },
    required: ['path', 'sheets'],
    additionalProperties: false,
  },
  needsApproval: true,
  describeApproval(args) {
    const path = asString(args.path);
    let display = path;
    try {
      display = toDisplayPath(generatedPath(path, '.xlsx', 'docs'));
    } catch {
      display = path;
    }
    const sheets = Array.isArray(args.sheets) ? args.sheets.length : 0;
    return {
      title: '生成 Excel 表格',
      command: `${display}（${sheets} 个工作表）`,
      risk: 'medium',
      summary: '会在工作区里生成一个 .xlsx 文件；同名文件会被覆盖。',
    };
  },
  async execute(args, ctx) {
    const target = generatedPath(args.path, '.xlsx', 'docs');
    const display = toDisplayPath(target);
    try {
      const sheets = parseSheets(args.sheets);
      const bytes = await buildXlsx(sheets);
      const parent = target.slice(0, target.lastIndexOf('/')) || '/';
      if (parent !== '/') await ctx.fs.mkdir(parent, { recursive: true });
      await ctx.fs.writeFile(target, bytes);
      const rows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
      return `已生成 Excel ${display}（${sheets.length} 个工作表，${rows} 行，${(bytes.length / 1024).toFixed(1)} KB）`;
    } catch (error) {
      return `[错误] ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

const readXlsxTool: Tool = {
  name: 'read_xlsx',
  description: '读取工作区里的 .xlsx，按工作表输出文本表格（行内用 | 分隔）。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'xlsx 路径' },
      sheet: { type: 'string', description: '只看某个工作表，默认全部' },
      max_rows: { type: 'number', description: '每个表最多多少行，默认 80' },
      max_cols: { type: 'number', description: '最多多少列，默认 20' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const target = toSandboxPath(args.path);
    const display = toDisplayPath(target);
    try {
      const bytes = await ctx.fs.readFileBuffer(target);
      const text = await extractXlsxText(bytes, {
        ...(typeof args.sheet === 'string' && args.sheet ? { sheet: args.sheet } : {}),
        maxRows: asInt(args.max_rows, 80),
        maxCols: asInt(args.max_cols, 20),
      });
      return `${display}\n${text}`;
    } catch (error) {
      return `[错误] ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

const generateImageTool: Tool = {
  name: 'generate_image',
  description:
    '调用生图渠道生成一张图片并保存到工作区。只有用户配置了生图渠道（Base URL / 模型 / Key）时才可用；' +
    '没配就如实告诉用户去「设置 → M1 实验室」配。',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '图片描述；建议写清主体、风格、构图' },
      path: { type: 'string', description: '保存路径，默认 images/<时间戳>.png' },
      size: { type: 'string', description: '尺寸，例如 1024x1024 / 1024x1792，默认用渠道配置' },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
  needsApproval: true,
  describeApproval(args) {
    const prompt = asString(args.prompt);
    const size = asString(args.size);
    const path = asString(args.path).trim();
    let display = '';
    try {
      display = path ? toDisplayPath(generatedPath(path, '.png', 'images')) : 'images/<时间戳>.png';
    } catch {
      display = path;
    }
    return {
      title: '生成图片',
      command:
        `${prompt.slice(0, 160)}${prompt.length > 160 ? '…' : ''}` +
        `${size ? `（${size}）` : ''}${display ? ` → ${display}` : ''}`,
      risk: 'medium',
      summary: '会调用生图渠道（可能计费），并把图片存进工作区。',
    };
  },
  async execute(args, ctx) {
    if (!ctx.image) {
      return '[错误] 没有配置生图渠道。告诉用户去「设置 → M1 实验室 → 生图（可选）」填 Base URL / 模型 / Key。';
    }
    const prompt = asString(args.prompt).trim();
    if (!prompt) return '[错误] prompt 为空';
    const rawPath = asString(args.path).trim();
    const target = rawPath || `images/img-${Date.now().toString(36)}`;
    try {
      const image = await generateImage(ctx.image, prompt, {
        ...(typeof args.size === 'string' && args.size.trim() ? { size: args.size.trim() } : {}),
        signal: ctx.signal,
      });
      // 扩展名按渠道真实 MIME 推导；模型给 .png 但实际是 jpeg 时会替换掉
      const finalTarget = generatedPath(target, `.${extensionForImageMime(image.mime)}`, 'images');
      const parent = finalTarget.slice(0, finalTarget.lastIndexOf('/')) || '/';
      if (parent !== '/') await ctx.fs.mkdir(parent, { recursive: true });
      await ctx.fs.writeFile(finalTarget, image.bytes);
      const size = pngSize(image.bytes);
      const dimensions = size ? `${size.width}×${size.height}` : image.mime;
      const revised = image.revisedPrompt
        ? `；渠道改写后的 prompt：${image.revisedPrompt.replace(/\s+/g, ' ').trim().slice(0, 120)}`
        : '';
      return `已生成图片 ${toDisplayPath(finalTarget)}（${dimensions}，${(image.bytes.length / 1024).toFixed(1)} KB${revised}）`;
    } catch (error) {
      return `[错误] ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const LIGHT_TOOLS: AgentTool[] = [
  bashTool,
  readFileTool,
  writeFileTool,
  listDirTool,
  createDocxTool,
  createXlsxTool,
  readDocxTool,
  readXlsxTool,
  generateImageTool,
  askUserTool,
];

const WRITE_TOOLS = new Set(['bash', 'write_file', 'create_docx', 'create_xlsx', 'generate_image']);

/** read-only 时不暴露写操作；workspace-write / danger-full-access 全给 */
export function toolsForPermission(permission: PermissionPreset): AgentTool[] {
  if (permission === 'read-only') {
    return LIGHT_TOOLS.filter((tool) => !WRITE_TOOLS.has(tool.name));
  }
  return LIGHT_TOOLS;
}

export function toolByName(name: string): AgentTool | undefined {
  return LIGHT_TOOLS.find((tool) => tool.name === name);
}

/** 只读时也要让模型知道"为什么没有 bash" */
export function permissionNote(permission: PermissionPreset): string {
  switch (permission) {
    case 'read-only':
      return '当前是只读权限：只能 read_file / list_dir / read_docx / read_xlsx / ask_user_question，不能执行命令或写文件。';
    case 'workspace-write':
      return '当前是工作区权限：可以执行 bash、写文件、生成文档，但每次都要用户批准。';
    case 'danger-full-access':
      return '当前是完整权限：bash、写文件和生成文档不再逐次批准，但仍只能访问 /workspace。';
  }
}

export const TOOL_CONTEXT_HELP: string = [
  '工具使用约定：',
  '- 工作区是 /workspace，shell 的当前目录也是 /workspace；路径优先写相对路径。',
  '- 查文件用 list_dir / read_file，改文件用 write_file，跑命令用 bash。',
  '- 生成 Word 用 create_docx（blocks 结构化，不用手写 XML）；生成 Excel 用 create_xlsx（sheets.rows 二维数组）。',
  '- 读用户已有的 docx/xlsx 用 read_docx / read_xlsx。生成完可以读回来核对。',
  '- 需要配图时用 generate_image；没配置渠道时它会报错，别假装生成了。',
  '- 不要臆造工具；需要用户做选择时用 ask_user_question。',
].join('\n');

export type { ToolContext };
