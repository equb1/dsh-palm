/**
 * 预路由（纯函数，Node 可测）。
 *
 * 发送前判断这一轮该去轻引擎还是完整引擎；只做「该去哪」，
 * 不启 proot、不建会话、不碰 store。命中顺序固定：
 *
 *   手动 pin / 消息前缀
 *     > 明确不支持（PDF 转换/渲染/重算/旧 .doc/.ppt）
 *     > 当前已在完整引擎（粘住，不自动回轻）
 *     > 完整专属附件（pptx/压缩包/视频/>10MB）
 *     > 后台/锁屏
 *     > 代码执行（动作 + 解释器/编译器）
 *     > Office 编辑
 *     > 默认轻引擎
 *
 * 忙 / 待审批 / 正在启 proot 时不自动切，降级为 light（能力门会兜底）。
 */

export type RouteTarget = 'light' | 'full' | 'blocked-unsupported';
export type RouteOverride = 'light' | 'full' | null;

export interface RouteAttachment {
  name?: string;
  displayName?: string;
  mime?: string;
  bytes?: number;
  kind?: string;
}

export interface RouteEngineState {
  mode?: 'light' | 'starting-proot' | 'full';
  busy?: boolean;
  pendingApprovals?: number;
  starting?: boolean;
  link?: 'light' | 'proot' | 'remote' | null;
}

export interface RouteTurnInput {
  text: string;
  attachments?: RouteAttachment[];
  /** 会话级手动 pin */
  manualPin?: 'light' | 'full' | null;
  /** 当前逻辑会话是否已经在完整引擎（sticky） */
  activeFull?: boolean;
  /** 全局自动路由开关，默认 true */
  autoRoute?: boolean;
  engine?: RouteEngineState;
}

export interface RouteTurnResult {
  target: RouteTarget;
  reason: string;
  confidence: number;
  signals: string[];
  missing?: string[];
  /** 去掉「完整/轻」前缀后的正文 */
  text: string;
  override: RouteOverride;
}

export const ROUTE_FULL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ZIP_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v']);

const FULL_PREFIXES: RegExp[] = [
  /^用完整引擎[\s，,：:、-]*/u,
  /^完整模式[\s，,：:、-]*/u,
  /^完整[\s，,：:、-]+/u,
  /^全[\s，,：:、-]+/u,
];
const LIGHT_PREFIXES: RegExp[] = [
  /^留在轻引擎[\s，,：:、-]*/u,
  /^轻模式[\s，,：:、-]*/u,
  /^轻[\s，,：:、-]+/u,
];

/** 消息前缀覆盖；只认开头，避免误伤「完整文档」「轻松」这种正常句子 */
export function stripRouteOverride(input: string): { text: string; override: RouteOverride } {
  const text = input.trimStart();
  for (const pattern of FULL_PREFIXES) {
    const match = pattern.exec(text);
    if (match) return { text: text.slice(match[0].length).trimStart(), override: 'full' };
  }
  for (const pattern of LIGHT_PREFIXES) {
    const match = pattern.exec(text);
    if (match) return { text: text.slice(match[0].length).trimStart(), override: 'light' };
  }
  return { text, override: null };
}

function extensionOf(name?: string): string {
  const leaf = String(name ?? '').trim().split(/[\\/]/).pop() ?? '';
  const dot = leaf.lastIndexOf('.');
  return dot > 0 ? leaf.slice(dot + 1).toLowerCase() : '';
}

/** 去掉围栏代码块，只留叙述文本（判断动作词用） */
function proseOf(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .trim();
}

const ACTION_RE =
  /(运行|跑|执行|编译|构建|安装|装上|装一下|测试|调试|重算|启动|调用|跑一下|运行一下|写(?:个|一个)?脚本|做(?:个|一个)?脚本|批量处理|\b(?:run|execute|compile|build|install|test|debug|launch|benchmark)\b)/iu;

const INTERPRETER_RE =
  /(?:^|[^\w])(python[0-9.]*|node(?:js)?|npm|npx|pnpm|yarn|bun|deno|pip[0-9]*|pipenv|poetry|conda|uv|git|ffmpeg|ffprobe|apt(?:-get)?|dpkg|make|cmake|gcc|g\+\+|cc|clang(?:\+\+)?|javac|java|rustc|cargo|go|ruby|php|perl|mvn|gradle|tsc|pytest|jest|vitest|docker)(?![\w])/giu;

function interpretersIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(INTERPRETER_RE)) {
    const raw = (match[1] ?? '').toLowerCase();
    let normalized = raw;
    if (/^python[0-9.]*$/.test(raw)) normalized = 'python';
    else if (/^pip[0-9]*$/.test(raw)) normalized = 'pip';
    else if (/^node(?:js)?$/.test(raw)) normalized = 'node';
    else if (raw === 'apt-get') normalized = 'apt';
    else if (raw === 'cc') normalized = 'gcc';
    if (normalized && !found.includes(normalized)) found.push(normalized);
  }
  return found;
}

const BACKGROUND_RE =
  /(后台|锁屏|息屏|关屏|搁后台|继续跑|继续运行|长时间运行|挂起后|\bbackground\b|\block\s*screen\b)/iu;

const EDIT_VERB_RE =
  /(编辑|修改|改一下|改动|更新|追加|插入|加(?:一段|一行|一列|段落|行|列|公式|样式)|填充|替换|删除.{0,4}(?:行|列|段)|合并单元格|套用.{0,6}样式|调整.{0,6}(?:格式|版式|样式))/iu;
const CREATE_VERB_RE = /(创建|新建|生成|做一份|写一份|新建一份)/iu;

const PDF_ACTION_RE =
  /((转|转换|导出|生成|合并|拆分|压缩|做|制作|输出).{0,8}pdf|pdf.{0,8}(转|转换|导出|生成|合并|拆分|压缩|制作|输出))/iu;
const RENDER_RE = /(渲染|render|转成图片|导出图片|转图片|生成预览|预览版式|版式预览)/iu;
const RECALC_RE = /(重算|重新计算|公式.{0,6}(刷新|计算)|recalc(?:ulate)?)/iu;
const OLD_OFFICE_RE = /(\.doc(?![x\w])|\.ppt(?![x\w])|旧版.{0,4}(word|ppt|office)|旧\s*\.?\s*(doc|ppt))/iu;

function attachmentFullReason(attachments: RouteAttachment[]): { reason: string; missing: string[]; signals: string[] } | null {
  const missing: string[] = [];
  const signals: string[] = [];
  let reason = '';
  for (const file of attachments) {
    const ext = extensionOf(file.name ?? file.displayName);
    const mime = String(file.mime ?? '').toLowerCase();
    const kind = String(file.kind ?? '').toLowerCase();
    if (ext === 'pptx') {
      if (!missing.includes('pptx')) missing.push('pptx');
      signals.push('attachment:pptx');
      reason ||= 'pptx 需要完整引擎里的 python-pptx';
    }
    if (ZIP_EXTS.has(ext)) {
      if (!missing.includes('zip')) missing.push('zip');
      signals.push('attachment:archive');
      reason ||= '压缩包需要完整引擎解压';
    }
    if (kind === 'video' || mime.startsWith('video/') || VIDEO_EXTS.has(ext)) {
      if (!missing.includes('video')) missing.push('video');
      signals.push('attachment:video');
      reason ||= '视频需要完整引擎里的 ffmpeg';
    }
    if (typeof file.bytes === 'number' && file.bytes > ROUTE_FULL_ATTACHMENT_BYTES) {
      if (!missing.includes('>10MB')) missing.push('>10MB');
      signals.push('attachment:large');
      reason ||= '附件超过 10MB，轻引擎单次读不了';
    }
  }
  return reason ? { reason, missing, signals } : null;
}

function unsupportedReason(text: string, attachments: RouteAttachment[]): { reason: string; missing: string[] } | null {
  for (const file of attachments) {
    const ext = extensionOf(file.name ?? file.displayName);
    if (ext === 'doc') return { reason: '旧 .doc 格式暂不支持（需要 LibreOffice）', missing: ['doc', 'libreoffice'] };
    if (ext === 'ppt') return { reason: '旧 .ppt 格式暂不支持（需要 LibreOffice）', missing: ['ppt', 'libreoffice'] };
  }
  if (PDF_ACTION_RE.test(text)) {
    return { reason: 'PDF 转换 / 生成暂不支持（LibreOffice 未打包）', missing: ['pdf', 'libreoffice'] };
  }
  if (RENDER_RE.test(text)) {
    return { reason: '文档渲染 / 转图片暂不支持（需要 LibreOfficeKit）', missing: ['render', 'libreoffice'] };
  }
  if (RECALC_RE.test(text)) {
    return { reason: '公式重算暂不支持（需要 LibreOffice）', missing: ['recalc', 'libreoffice'] };
  }
  if (OLD_OFFICE_RE.test(text)) {
    return { reason: '旧 .doc / .ppt 格式暂不支持（需要 LibreOffice）', missing: ['doc', 'libreoffice'] };
  }
  return null;
}

const PPTX_ACTION_RE = /(生成|创建|新建|制作|编辑|修改|读取|解析|提取|总结|导出|转|做)/iu;

function officeEditConflict(text: string, attachments: RouteAttachment[]): boolean {
  const mentionsDoc = /\.(docx|xlsx)(?![\w])/iu.test(text) || /(word|excel|文档|表格)/iu.test(text);
  const mentionsPptx = /\.pptx(?![\w])/iu.test(text) || /(pptx|幻灯片|演示文稿)/iu.test(text);
  const fileDoc = attachments.some((file) => ['docx', 'xlsx'].includes(extensionOf(file.name ?? file.displayName)));
  const createOnly = CREATE_VERB_RE.test(text) && !EDIT_VERB_RE.test(text);
  if (mentionsPptx && PPTX_ACTION_RE.test(text)) return true;
  if (createOnly) return false;
  if (!EDIT_VERB_RE.test(text)) return false;
  return (mentionsDoc && (fileDoc || /\.(docx|xlsx)(?![\w])/iu.test(text))) || (fileDoc && EDIT_VERB_RE.test(text));
}

function busyDowngrade(engine?: RouteEngineState): string | null {
  if (!engine) return null;
  if (engine.mode === 'full') return null;
  if (engine.busy) return '正在执行回合，先留在轻引擎，等这一轮结束再切换';
  if ((engine.pendingApprovals ?? 0) > 0) return '还有审批/提问等着处理，先留在轻引擎';
  if (engine.mode === 'starting-proot' || engine.starting) return '完整引擎正在启动，先留在轻引擎';
  if (engine.link === 'remote') return '当前连着另一台电脑的宿主，不能自动切到本机完整引擎';
  return null;
}

export function routeTurn(input: RouteTurnInput): RouteTurnResult {
  const parsed = stripRouteOverride(input.text);
  const text = parsed.text.trim();
  const signals: string[] = [];
  const manualPin = input.manualPin ?? null;

  const result = (
    target: RouteTarget,
    reason: string,
    confidence: number,
    extra: { missing?: string[]; signals?: string[] } = {},
  ): RouteTurnResult => ({
    target,
    reason,
    confidence,
    signals: [...signals, ...(extra.signals ?? [])],
    ...(extra.missing && extra.missing.length > 0 ? { missing: extra.missing } : {}),
    text,
    override: parsed.override,
  });

  /* 1. 手动 pin / 消息前缀：用户说了算 */
  if (manualPin === 'light' || parsed.override === 'light') {
    signals.push(manualPin === 'light' ? 'manual_pin:light' : 'override:light');
    return result('light', '用户指定留在轻引擎', 0.98);
  }
  if (manualPin === 'full' || parsed.override === 'full') {
    signals.push(manualPin === 'full' ? 'manual_pin:full' : 'override:full');
    return result('full', '用户指定使用完整引擎', 0.98);
  }

  /* 2. 明确不支持的操作：不路由，直接说明 */
  const unsupported = unsupportedReason(text, input.attachments ?? []);
  if (unsupported) {
    signals.push('unsupported');
    return result('blocked-unsupported', unsupported.reason, 0.95, { missing: unsupported.missing });
  }

  /* 3. 已在完整引擎：短追问/任何追问都粘住，绝不自动回轻 */
  if (input.activeFull) {
    signals.push('sticky_full');
    const busy = busyDowngrade(input.engine);
    if (busy) {
      signals.push('engine_busy');
      return result('light', busy, 0.7);
    }
    return result('full', '当前逻辑会话已在完整引擎，继续用完整引擎', 0.9);
  }

  /* 3.5 自动路由关闭：先留在轻引擎，缺能力时由能力门提示 */
  if (input.autoRoute === false) {
    signals.push('auto_route_off');
    return result('light', '自动路由已关闭，先走轻引擎', 0.7);
  }

  /* 4. 完整专属附件 */
  const attachment = attachmentFullReason(input.attachments ?? []);
  if (attachment) {
    signals.push(...attachment.signals);
    const busy = busyDowngrade(input.engine);
    if (busy) {
      signals.push('engine_busy');
      return result('light', busy, 0.6);
    }
    return result('full', attachment.reason, 0.9, { missing: attachment.missing });
  }

  /* 5. 后台/锁屏长任务 */
  if (BACKGROUND_RE.test(text)) {
    signals.push('background');
    const busy = busyDowngrade(input.engine);
    if (busy) {
      signals.push('engine_busy');
      return result('light', busy, 0.6);
    }
    return result('full', '需要后台/锁屏继续运行，轻引擎会被系统冻结', 0.85);
  }

  /* 6. 代码执行：动作词 + 解释器/编译器（避免把「python 是什么」和裸代码块送去 proot） */
  const prose = proseOf(text);
  const interpreters = interpretersIn(text);
  if (interpreters.length > 0 && ACTION_RE.test(prose)) {
    signals.push('code_exec');
    const busy = busyDowngrade(input.engine);
    if (busy) {
      signals.push('engine_busy');
      return result('light', busy, 0.55);
    }
    return result('full', `要执行代码/脚本（${interpreters.join('、')}）`, 0.9, {
      missing: interpreters,
    });
  }

  /* 7. Office 编辑（创建/读取 docx/xlsx 仍走轻引擎；pptx 全部走完整） */
  if (officeEditConflict(text, input.attachments ?? [])) {
    signals.push('office_edit');
    const busy = busyDowngrade(input.engine);
    if (busy) {
      signals.push('engine_busy');
      return result('light', busy, 0.55);
    }
    return result('full', '编辑现有 Office 文档 / 处理 pptx 需要完整引擎的 Python 三件套', 0.82);
  }

  signals.push('default');
  return result('light', '默认走轻引擎', 0.5);
}

/** 预路由切完整时是否需要 danger-full-access（proot 里 bash 的 F8 限制） */
export function routeNeedsFullPermission(signals: string[]): boolean {
  return signals.some((signal) =>
    [
      'code_exec',
      'background',
      'office_edit',
      'attachment:pptx',
      'attachment:archive',
      'attachment:video',
    ].includes(signal),
  );
}
