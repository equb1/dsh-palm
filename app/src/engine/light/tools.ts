/**
 * 轻引擎的工具集。
 *
 * 只有五个，够 M1 的「文档 / 票据 / 纪要」跑起来：
 *  - bash：just-bash，落真实工作区（审批）
 *  - read_file / list_dir：读
 *  - write_file：写（审批）
 *  - ask_user_question：把选择交回给界面
 *
 * 刻意不做「工具白名单之外的兼容层」：DSH 的老插件不在这里跑（docs/23 §4.4）。
 */
import type { AgentTool, AgentTool as Tool, PermissionPreset, ToolContext } from './types';
import { joinPath, normalizePath } from '../fs/path';
import { truncateMiddle } from '../shell/bash';

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

export const LIGHT_TOOLS: AgentTool[] = [bashTool, readFileTool, writeFileTool, listDirTool, askUserTool];

/** read-only 时不暴露写操作；workspace-write / danger-full-access 全给 */
export function toolsForPermission(permission: PermissionPreset): AgentTool[] {
  if (permission === 'read-only') {
    return LIGHT_TOOLS.filter((tool) => tool.name !== 'bash' && tool.name !== 'write_file');
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
      return '当前是只读权限：只能 read_file / list_dir / ask_user_question，不能执行命令或写文件。';
    case 'workspace-write':
      return '当前是工作区权限：可以执行 bash 和写文件，但每次都要用户批准。';
    case 'danger-full-access':
      return '当前是完整权限：bash 和写文件不再逐次批准，但仍只能访问 /workspace。';
  }
}

export const TOOL_CONTEXT_HELP: string = [
  '工具使用约定：',
  '- 工作区是 /workspace，shell 的当前目录也是 /workspace；路径优先写相对路径。',
  '- 查文件用 list_dir / read_file，改文件用 write_file，跑命令用 bash。',
  '- 不要臆造工具；需要用户做选择时用 ask_user_question。',
].join('\n');

export type { ToolContext };
