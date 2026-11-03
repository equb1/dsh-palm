/**
 * xlsx 生成 / 读取（SheetJS，纯 JS）。
 *
 * 写：aoa_to_sheet → book_new → write(type:'array')，不碰 Node Buffer。
 * 读：sheet_to_json(header:1)，转成文本表格给模型看；直接读二进制时用 `type:'array'`。
 *
 * SheetJS 走动态 import（包体约 800KB），第一次用表格时才加载。
 */
export type CellValue = string | number | boolean | null;

export interface SheetSpec {
  name: string;
  rows: CellValue[][];
}

type XlsxModule = typeof import('xlsx');
let xlsxModule: Promise<XlsxModule> | null = null;

function loadXlsx(): Promise<XlsxModule> {
  if (!xlsxModule) xlsxModule = import('xlsx');
  return xlsxModule;
}

/** 工作表名有长度/非法字符限制，顺手清一下 */
function sheetName(name: string, index: number): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').trim();
  return (cleaned || `Sheet${index + 1}`).slice(0, 31);
}

export async function buildXlsx(sheets: SheetSpec[]): Promise<Uint8Array> {
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  const used = new Set<string>();
  sheets.forEach((sheet, index) => {
    let name = sheetName(sheet.name, index);
    let suffix = 2;
    while (used.has(name)) {
      name = `${sheetName(sheet.name, index).slice(0, 28)}(${suffix})`;
      suffix += 1;
    }
    used.add(name);
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  });
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(output);
}

export interface ReadXlsxOptions {
  sheet?: string;
  maxRows?: number;
  maxCols?: number;
  maxChars?: number;
}

function formatCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** 读成文本：每个工作表一段，行内 ` | ` 分隔；行列和总字符都有上限 */
export async function extractXlsxText(bytes: Uint8Array, options: ReadXlsxOptions = {}): Promise<string> {
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(bytes, { type: 'array' });
  const names = workbook.SheetNames.filter((name) => !options.sheet || name === options.sheet);
  if (names.length === 0) throw new Error(`没有这个工作表：${options.sheet ?? ''}`);
  const maxRows = Math.max(1, Math.min(options.maxRows ?? 80, 500));
  const maxCols = Math.max(1, Math.min(options.maxCols ?? 20, 100));
  const maxChars = Math.max(200, Math.min(options.maxChars ?? 40_000, 80_000));

  const parts: string[] = [];
  for (const name of names) {
    const worksheet = workbook.Sheets[name];
    if (!worksheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      blankrows: false,
      defval: '',
    });
    const shown = rows.slice(0, maxRows).map((row) => row.slice(0, maxCols).map(formatCell).join(' | '));
    const more = rows.length > maxRows ? `\n…还有 ${rows.length - maxRows} 行` : '';
    parts.push(`## 工作表：${name}（${rows.length} 行 × ${rows[0]?.length ?? 0} 列）\n${shown.join('\n')}${more}`);
    if (parts.join('\n\n').length >= maxChars) break;
  }

  const text = parts.join('\n\n');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[表格内容超过 ${maxChars} 字符，已截断]`;
}
