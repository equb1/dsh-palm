import type { Preset, Workspace } from '../../app/src/protocol';

/**
 * 内置预设 —— 对应 docs/03-workspaces-presets.md 的「五个内置预设」。
 * MVP 只落地文档 / 票据 / 读图三个。
 */
export const PRESETS: Preset[] = [
  {
    id: 'doc',
    name: '文档助手',
    glyph: '文',
    tagline: '改格式、提表格、批量改名',
    version: '1.0.0',
    builtin: true,
    contract: {
      tools: ['docs.read', 'docs.write', 'xlsx.write', 'pdf.render', 'file.move'],
      fs: [
        { path: '~/workspaces/docs', mode: 'rw' },
        { path: '/sdcard/Download', mode: 'ro' },
      ],
      net: 'deny',
      exec: 'python-limited',
      surfaces: ['share_intake'],
    },
    modelPolicy: { needs: ['long_context>=64k'], prefer: 'deepseek-chat' },
  },
  {
    id: 'receipt',
    name: '票据管家',
    glyph: '票',
    tagline: '拍一张，记一笔',
    version: '1.0.0',
    builtin: true,
    contract: {
      tools: ['ocr.extract', 'xlsx.write', 'file.move'],
      fs: [{ path: '~/workspaces/docs', mode: 'rw' }],
      net: 'deny',
      exec: 'deny',
      surfaces: ['camera', 'gallery'],
    },
    modelPolicy: { needs: ['vision'], prefer: 'deepseek-vl' },
  },
  {
    id: 'vision',
    name: '读图问答',
    glyph: '图',
    tagline: '看说明书、看板书、看菜单',
    version: '1.0.0',
    builtin: true,
    contract: {
      tools: ['image.crop', 'vision.describe'],
      fs: [{ path: '~/workspaces/inbox', mode: 'rw' }],
      net: 'allow',
      exec: 'deny',
      surfaces: ['camera', 'gallery'],
    },
    modelPolicy: { needs: ['vision'] },
  },
];

export const WORKSPACES: Workspace[] = [
  {
    id: 'ws-docs',
    name: '文档',
    root: '~/workspaces/docs',
    presetIds: ['doc', 'receipt'],
  },
  {
    id: 'ws-inbox',
    name: '收件箱',
    root: '~/workspaces/inbox',
    presetIds: ['vision'],
  },
];

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}

/**
 * 每个预设一段可复现的脚本化对话，用来验证 UI 对各类块的处理。
 * 真引擎接上后这段会被真实输出替代。
 */
export interface ScriptStep {
  kind: 'thinking' | 'text' | 'tool' | 'approval' | 'wait';
  text?: string;
  tool?: { name: string; summary: string; detail?: string };
  approval?: {
    title: string;
    command: string;
    risk: 'low' | 'medium' | 'high';
    summary: string;
    diff?: string;
  };
  ms?: number;
}

export const SCRIPTS: Record<string, ScriptStep[]> = {
  doc: [
    { kind: 'thinking', text: '先看这份合同的结构，找到要改的地方。', ms: 300 },
    { kind: 'tool', tool: { name: 'docs.read', summary: '读取 合同_v3.docx', detail: '共 12 页，3 个表格' }, ms: 500 },
    { kind: 'text', text: '我看完了。这份合同有三处需要处理：\n\n1. 第 4 条的付款周期写的是「月结 90 天」，和你说的 30 天不一致\n2. 第 7 条的违约条款引用了旧版法规\n3. 附件里的报价表和正文金额对不上\n\n我先把表格提出来核对，改完再写回原文件。', ms: 900 },
    { kind: 'tool', tool: { name: 'xlsx.write', summary: '生成 金额核对.xlsx', detail: '3 行，发现 1 处差异' }, ms: 700 },
    {
      kind: 'approval',
      approval: {
        title: '要覆盖写入原文件',
        command: 'docs.write ~/workspaces/docs/合同_v3.docx',
        risk: 'medium',
        summary: '会替换原文件，旧版本保留为 合同_v3.bak.docx',
        diff: '- 付款周期：月结 90 天\n+ 付款周期：月结 30 天',
      },
      ms: 200,
    },
    { kind: 'wait', ms: 100 },
    { kind: 'text', text: '已经改好了，原文件备份为 `合同_v3.bak.docx`。\n\n金额核对表在 `金额核对.xlsx`，差异在第 3 行：报价单写的是 12.8 万，正文写 12.6 万。要我按哪个改？', ms: 700 },
  ],
  receipt: [
    { kind: 'thinking', text: '先把图里的字段提出来。', ms: 250 },
    { kind: 'tool', tool: { name: 'ocr.extract', summary: '识别票据', detail: '金额、日期、抬头、税号' }, ms: 600 },
    { kind: 'text', text: '识别到一张增值税普通发票：\n\n- 金额：**¥1,286.00**\n- 日期：2026-10-28\n- 抬头：杭州某某科技有限公司\n\n我记到本月台账里。', ms: 700 },
    { kind: 'tool', tool: { name: 'xlsx.write', summary: '追加到 2026-10 台账.xlsx', detail: '第 27 行' }, ms: 500 },
    { kind: 'text', text: '记好了，本月累计 27 笔，合计 ¥31,204.00。', ms: 500 },
  ],
  vision: [
    { kind: 'thinking', text: '看图。', ms: 200 },
    { kind: 'tool', tool: { name: 'vision.describe', summary: '分析图片', detail: '1024×768' }, ms: 700 },
    { kind: 'text', text: '这是一张路由器背面的标签。\n\n- 型号：AX3000\n- 管理地址：`192.168.31.1`\n- 初始 Wi-Fi：`Xiaomi_AX3000`\n\n要我把这些存进「设备信息」吗？', ms: 600 },
  ],
};
