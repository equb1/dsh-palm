/**
 * docx 生成 / 读取（纯 JS，跑在 Hermes 上）。
 *
 * 生成用 `docx` 包（Packer.toArrayBuffer，避免依赖 Node Buffer），
 * 读取用 `fflate` 解 zip 再抽 `word/document.xml` 里的 `<w:t>`——只取文本，
 * 不还原样式。这样体积小、不用把 mammoth 这类重库搬进手机。
 *
 * 两个依赖都走动态 import：引擎启动时不加载，第一次用到文档才付这个包体成本。
 */
import { strFromU8, unzipSync } from 'fflate';

export type DocxBlock =
  | { type: 'heading'; text: string; level?: number }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; text: string }
  | { type: 'table'; rows: Array<Array<string | number | boolean | null>>; header?: boolean }
  | { type: 'code'; text: string }
  | { type: 'pageBreak' };

type DocxModule = typeof import('docx');
let docxModule: Promise<DocxModule> | null = null;

function loadDocx(): Promise<DocxModule> {
  if (!docxModule) docxModule = import('docx');
  return docxModule;
}

const cell = (value: unknown): string => (value == null ? '' : String(value));

export async function buildDocx(input: { title?: string; blocks: DocxBlock[] }): Promise<Uint8Array> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    PageBreak,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
  } = await loadDocx();

  const headingFor = (level: number | undefined): (typeof HeadingLevel)[keyof typeof HeadingLevel] => {
    switch (level) {
      case 2:
        return HeadingLevel.HEADING_2;
      case 3:
        return HeadingLevel.HEADING_3;
      case 4:
        return HeadingLevel.HEADING_4;
      default:
        return HeadingLevel.HEADING_1;
    }
  };

  const children: Array<
    InstanceType<DocxModule['Paragraph']> | InstanceType<DocxModule['Table']>
  > = [];
  if (input.title) {
    children.push(new Paragraph({ text: input.title, heading: HeadingLevel.TITLE }));
  }

  for (const block of input.blocks) {
    switch (block.type) {
      case 'heading':
        children.push(new Paragraph({ text: block.text, heading: headingFor(block.level) }));
        break;
      case 'paragraph':
        children.push(new Paragraph({ children: [new TextRun(block.text)] }));
        break;
      case 'bullet':
        children.push(new Paragraph({ text: block.text, bullet: { level: 0 } }));
        break;
      case 'numbered':
        children.push(new Paragraph({ text: block.text, numbering: { reference: 'light-numbering', level: 0 } }));
        break;
      case 'code':
        children.push(
          new Paragraph({
            children: [new TextRun({ text: block.text, font: 'Courier New', size: 20 })],
            spacing: { before: 80, after: 80 },
          }),
        );
        break;
      case 'pageBreak':
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case 'table': {
        const rows = block.rows.length > 0 ? block.rows : [['']];
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: rows.map(
              (row, rowIndex) =>
                new TableRow({
                  tableHeader: block.header !== false && rowIndex === 0,
                  children: (row.length > 0 ? row : ['']).map(
                    (value) =>
                      new TableCell({
                        children: [new Paragraph({ children: [new TextRun(cell(value))] })],
                      }),
                  ),
                }),
            ),
          }),
        );
        break;
      }
    }
  }

  const document = new Document({
    numbering: {
      config: [
        {
          reference: 'light-numbering',
          levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
        },
      ],
    },
    sections: [{ properties: {}, children }],
  });

  const buffer = await Packer.toArrayBuffer(document);
  return new Uint8Array(buffer);
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function unescapeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return XML_ENTITIES[entity] ?? whole;
  });
}

/** 抽取 docx 的纯文本：段落换行，表格行内单元格用制表符分隔 */
export function extractDocxText(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('不是有效的 docx（无法解压）');
  }
  const xmlBytes = files['word/document.xml'];
  if (!xmlBytes) throw new Error('不是有效的 docx（缺 word/document.xml）');
  const xml = strFromU8(xmlBytes);

  // 按标签切开：文本节点原样累加，标签只用来判断段落/表格边界
  const tokens = xml.split(/(<[^>]+>)/).filter((token) => token.length > 0);
  let out = '';
  let inText = false;
  let cellDepth = 0;

  for (const token of tokens) {
    if (!token.startsWith('<')) {
      if (inText) out += unescapeXml(token);
      continue;
    }
    if (/^<w:t\b/.test(token)) {
      inText = true;
      continue;
    }
    if (token === '</w:t>') {
      inText = false;
      continue;
    }
    if (token === '<w:tab/>') {
      out += '\t';
      continue;
    }
    if (token === '<w:br/>' || token === '<w:cr/>') {
      out += '\n';
      continue;
    }
    if (/^<w:tc\b/.test(token)) {
      cellDepth += 1;
      continue;
    }
    if (token === '</w:tc>') {
      cellDepth = Math.max(0, cellDepth - 1);
      // 单元格之间用 tab；表格行尾在 </w:tr> 再换成换行
      if (out.length > 0 && !out.endsWith('\t') && !out.endsWith('\n')) out += '\t';
      continue;
    }
    if (token === '</w:tr>') {
      if (out.endsWith('\t')) out = `${out.slice(0, -1)}\n`;
      else if (!out.endsWith('\n')) out += '\n';
      continue;
    }
    if (token === '</w:p>' || token === '<w:p/>') {
      if (cellDepth === 0 && !out.endsWith('\n')) out += '\n';
    }
  }

  return out
    .replace(/\t+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
