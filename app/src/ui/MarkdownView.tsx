import React from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, font, radius, space } from './theme';

/* ------------------------------------------------------------------ *
 * 行内词法解析
 * ------------------------------------------------------------------ */

interface InlineToken {
  type: 'text' | 'bold' | 'italic' | 'strike' | 'code' | 'link';
  content: string;
  url?: string;
}

function parseInlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  // 匹配：链接、加粗、删除线、行内代码、斜体
  const regex = /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      });
    }

    const fullMatch = match[0];
    if (fullMatch.startsWith('[') && match[2] && match[3]) {
      tokens.push({
        type: 'link',
        content: match[2],
        url: match[3],
      });
    } else if (fullMatch.startsWith('**') && match[4]) {
      tokens.push({
        type: 'bold',
        content: match[4],
      });
    } else if (fullMatch.startsWith('~~') && match[5]) {
      tokens.push({
        type: 'strike',
        content: match[5],
      });
    } else if (fullMatch.startsWith('`') && match[6]) {
      tokens.push({
        type: 'code',
        content: match[6],
      });
    } else if (fullMatch.startsWith('*') && match[7]) {
      tokens.push({
        type: 'italic',
        content: match[7],
      });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      content: text.slice(lastIndex),
    });
  }

  return tokens;
}

function InlineText({ text, baseStyle }: { text: string; baseStyle?: object }): React.ReactElement {
  const tokens = parseInlineTokens(text);

  return (
    <Text style={baseStyle}>
      {tokens.map((token, idx) => {
        switch (token.type) {
          case 'bold':
            return (
              <Text key={idx} style={styles.bold}>
                {token.content}
              </Text>
            );
          case 'italic':
            return (
              <Text key={idx} style={styles.italic}>
                {token.content}
              </Text>
            );
          case 'strike':
            return (
              <Text key={idx} style={styles.strike}>
                {token.content}
              </Text>
            );
          case 'code':
            return (
              <Text key={idx} style={styles.inlineCode}>
                {` ${token.content} `}
              </Text>
            );
          case 'link':
            return (
              <Text
                key={idx}
                style={styles.link}
                onPress={() => {
                  if (token.url) {
                    Linking.openURL(token.url).catch(() => {});
                  }
                }}
              >
                {token.content}
              </Text>
            );
          default:
            return <Text key={idx}>{token.content}</Text>;
        }
      })}
    </Text>
  );
}

/* ------------------------------------------------------------------ *
 * 块级解析（流式容错）
 * ------------------------------------------------------------------ */

type BlockItem =
  | { type: 'h1' | 'h2' | 'h3'; text: string }
  | { type: 'codeblock'; lang: string; code: string }
  | { type: 'quote'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'hr' }
  | { type: 'table'; header: string[]; align: Array<'left' | 'center' | 'right'>; rows: string[][] }
  | { type: 'p'; text: string };

/* ---------------- 表格解析 ---------------- *
 * GFM：表头行 + 分隔行（|---|---|）+ 数据行。
 * 注意一个真实存在的坑（dsh-Go #208 也踩过）：表格紧贴在段落下面、中间没有空行时，
 * 按 GFM 它不能中断段落，整张表会被当成段落文字。这里我们直接把它当块级元素处理，
 * 不要求前面有空行——模型十次有八次不空行。
 */

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  // 转义的竖线先换成占位符，再还原
  const cells = s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
  return cells;
}

function parseAlign(cell: string): 'left' | 'center' | 'right' | null {
  const t = cell.trim();
  if (!/^:?-{1,}:?$/.test(t)) return null;
  const left = t.startsWith(':');
  const right = t.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

/** 当前行是表头、下一行是分隔行 -> 返回整张表 */
function tryParseTable(
  lines: string[],
  start: number,
): { block: Extract<BlockItem, { type: 'table' }>; next: number } | null {
  const headerLine = lines[start];
  const delimLine = lines[start + 1];
  if (headerLine === undefined || delimLine === undefined) return null;
  if (!headerLine.includes('|')) return null;

  const header = splitTableRow(headerLine);
  const delimCells = splitTableRow(delimLine);
  const aligns = delimCells.map(parseAlign);
  if (aligns.length === 0 || aligns.some((a) => a === null)) return null;
  if (header.length !== delimCells.length) return null;

  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '' || !line.includes('|')) break;
    // 遇到新的块级标记就停（表格不会跨标题/围栏/列表）
    if (/^(#{1,6}\s|>\s?|```)/.test(line.trim())) break;
    const cells = splitTableRow(line);
    // 补齐/裁剪到表头列数，避免错位
    while (cells.length < header.length) cells.push('');
    rows.push(cells.slice(0, header.length));
    i++;
  }

  return { block: { type: 'table', header, align: aligns as Array<'left' | 'center' | 'right'>, rows }, next: i };
}

function parseMarkdownBlocks(rawText: string): BlockItem[] {
  const lines = rawText.split('\n');
  const blocks: BlockItem[] = [];

  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];

  let currentQuote: string[] = [];
  let currentUl: string[] = [];
  let currentOl: string[] = [];
  let currentParagraph: string[] = [];

  const flushParagraph = (): void => {
    if (currentParagraph.length > 0) {
      blocks.push({ type: 'p', text: currentParagraph.join('\n') });
      currentParagraph = [];
    }
  };

  const flushQuote = (): void => {
    if (currentQuote.length > 0) {
      blocks.push({ type: 'quote', text: currentQuote.join('\n') });
      currentQuote = [];
    }
  };

  const flushUl = (): void => {
    if (currentUl.length > 0) {
      blocks.push({ type: 'ul', items: [...currentUl] });
      currentUl = [];
    }
  };

  const flushOl = (): void => {
    if (currentOl.length > 0) {
      blocks.push({ type: 'ol', items: [...currentOl] });
      currentOl = [];
    }
  };

  const flushAll = (): void => {
    flushParagraph();
    flushQuote();
    flushUl();
    flushOl();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // 1. 代码块处理（``` 支持未闭合的流式容错）
    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) {
        flushAll();
        inCodeBlock = true;
        codeLang = line.trim().slice(3).trim();
        codeLines = [];
      } else {
        inCodeBlock = false;
        blocks.push({
          type: 'codeblock',
          lang: codeLang,
          code: codeLines.join('\n'),
        });
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // 2. 空行 -> 结算当前积压块
    if (line.trim().length === 0) {
      flushAll();
      continue;
    }

    // 3. 表格：必须在段落之前判断，否则紧贴段落的表会被吞成纯文本
    const table = tryParseTable(lines, i);
    if (table) {
      flushAll();
      blocks.push(table.block);
      i = table.next - 1; // for 循环还会 i++
      continue;
    }

    // 4. 分割线: --- 或 ***
    if (/^(\*\*\*|---|___)\s*$/.test(line.trim())) {
      flushAll();
      blocks.push({ type: 'hr' });
      continue;
    }

    // 4. 标题: #, ##, ###
    const h1Match = /^#\s+(.+)$/.exec(line);
    if (h1Match) {
      flushAll();
      blocks.push({ type: 'h1', text: h1Match[1]! });
      continue;
    }
    const h2Match = /^##\s+(.+)$/.exec(line);
    if (h2Match) {
      flushAll();
      blocks.push({ type: 'h2', text: h2Match[1]! });
      continue;
    }
    const h3Match = /^###+\s+(.+)$/.exec(line);
    if (h3Match) {
      flushAll();
      blocks.push({ type: 'h3', text: h3Match[1]! });
      continue;
    }

    // 5. 引用块: > text
    const quoteMatch = /^>\s?(.*)$/.exec(line);
    if (quoteMatch) {
      flushParagraph();
      flushUl();
      flushOl();
      currentQuote.push(quoteMatch[1]!);
      continue;
    } else {
      flushQuote();
    }

    // 6. 无序列表: - item 或 * item
    const ulMatch = /^[-*+]\s+(.+)$/.exec(line);
    if (ulMatch) {
      flushParagraph();
      flushQuote();
      flushOl();
      currentUl.push(ulMatch[1]!);
      continue;
    } else {
      flushUl();
    }

    // 7. 有序列表: 1. item
    const olMatch = /^\d+\.\s+(.+)$/.exec(line);
    if (olMatch) {
      flushParagraph();
      flushQuote();
      flushUl();
      currentOl.push(olMatch[1]!);
      continue;
    } else {
      flushOl();
    }

    // 8. 普通段落
    currentParagraph.push(line);
  }

  // 流式输出尚未闭合的代码块自动收尾
  if (inCodeBlock) {
    blocks.push({
      type: 'codeblock',
      lang: codeLang,
      code: codeLines.join('\n'),
    });
  }

  flushAll();
  return blocks;
}

/* ------------------------------------------------------------------ *
 * 代码块组件（支持水平滚动与复制）
 * ------------------------------------------------------------------ */

function CodeBlockView({ lang, code }: { lang: string; code: string }): React.ReactElement {
  return (
    <View style={styles.codeBlockWrap}>
      {lang ? (
        <View style={styles.codeBlockHeader}>
          <Text style={styles.codeBlockLang}>{lang.toUpperCase()}</Text>
        </View>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.codeScroll}
      >
        <Text style={styles.codeBlockText}>{code}</Text>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 表格
 * ------------------------------------------------------------------ */

/**
 * GFM 表格。
 * 列少时按等分宽度撑满；列多（>=4）时改成横向滚动、每列给最小宽度，
 * 否则手机上会被压成一列两个字。
 */
function TableView({
  header,
  align,
  rows,
}: {
  header: string[];
  align: Array<'left' | 'center' | 'right'>;
  rows: string[][];
}): React.ReactElement {
  const wide = header.length >= 4;
  const cellStyle = (col: number): object => ({
    textAlign: align[col] ?? 'left',
    ...(wide ? { minWidth: 96 } : {}),
  });

  const body = (
    <View style={[styles.tableWrap, wide ? styles.tableWrapWide : null]}>
      <View style={[styles.tableRow, styles.tableHeaderRow]}>
        {header.map((cell, col) => (
          <View key={col} style={[styles.tableCell, col === 0 ? styles.tableCellFirst : null, wide ? null : { flex: 1 }]}>
            <InlineText text={cell} baseStyle={[styles.tableHeaderText, cellStyle(col)]} />
          </View>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={[styles.tableRow, r % 2 === 1 ? styles.tableRowStripe : null]}>
          {row.map((cell, col) => (
            <View key={col} style={[styles.tableCell, col === 0 ? styles.tableCellFirst : null, wide ? null : { flex: 1 }]}>
              <InlineText text={cell} baseStyle={[styles.tableCellText, cellStyle(col)]} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );

  if (!wide) return body;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {body}
    </ScrollView>
  );
}
/* ------------------------------------------------------------------ *
 * 主导出组件
 * ------------------------------------------------------------------ */

export function MarkdownView({ text, style }: { text: string; style?: object }): React.ReactElement {
  const blocks = React.useMemo(() => parseMarkdownBlocks(text), [text]);

  return (
    <View style={[styles.root, style]}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'h1':
            return (
              <View key={i} style={styles.h1Wrap}>
                <InlineText text={block.text} baseStyle={styles.h1Text} />
              </View>
            );
          case 'h2':
            return (
              <View key={i} style={styles.h2Wrap}>
                <InlineText text={block.text} baseStyle={styles.h2Text} />
              </View>
            );
          case 'h3':
            return (
              <View key={i} style={styles.h3Wrap}>
                <InlineText text={block.text} baseStyle={styles.h3Text} />
              </View>
            );
          case 'codeblock':
            return <CodeBlockView key={i} lang={block.lang} code={block.code} />;
          case 'table':
            return <TableView key={i} header={block.header} align={block.align} rows={block.rows} />;
          case 'quote':
            return (
              <View key={i} style={styles.quoteWrap}>
                <InlineText text={block.text} baseStyle={styles.quoteText} />
              </View>
            );
          case 'ul':
            return (
              <View key={i} style={styles.listWrap}>
                {block.items.map((item, idx) => (
                  <View key={idx} style={styles.listItem}>
                    <Text style={styles.bullet}>•</Text>
                    <View style={{ flex: 1 }}>
                      <InlineText text={item} baseStyle={styles.paragraph} />
                    </View>
                  </View>
                ))}
              </View>
            );
          case 'ol':
            return (
              <View key={i} style={styles.listWrap}>
                {block.items.map((item, idx) => (
                  <View key={idx} style={styles.listItem}>
                    <Text style={styles.orderNumber}>{idx + 1}.</Text>
                    <View style={{ flex: 1 }}>
                      <InlineText text={item} baseStyle={styles.paragraph} />
                    </View>
                  </View>
                ))}
              </View>
            );
          case 'hr':
            return <View key={i} style={styles.hr} />;
          case 'p':
          default:
            return (
              <View key={i} style={styles.pWrap}>
                <InlineText text={block.text} baseStyle={styles.paragraph} />
              </View>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  bold: { fontWeight: '700', color: colors.text },
  italic: { fontStyle: 'italic', color: colors.text },
  strike: { textDecorationLine: 'line-through', color: colors.textFaint },
  inlineCode: {
    fontFamily: font.mono,
    fontSize: 13,
    color: '#8BA4F9',
    backgroundColor: 'rgba(108, 138, 240, 0.12)',
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  link: {
    color: colors.blue,
    textDecorationLine: 'underline',
  },
  h1Wrap: { marginTop: 6, marginBottom: 2 },
  h1Text: { fontSize: 20, fontWeight: '700', color: colors.text, lineHeight: 28 },
  h2Wrap: { marginTop: 5, marginBottom: 2 },
  h2Text: { fontSize: 17, fontWeight: '700', color: colors.text, lineHeight: 24 },
  h3Wrap: { marginTop: 4, marginBottom: 1 },
  h3Text: { fontSize: 15, fontWeight: '600', color: colors.text, lineHeight: 22 },
  pWrap: { marginVertical: 1 },
  paragraph: {
    fontSize: 15,
    lineHeight: 24,
    color: colors.text,
  },
  quoteWrap: {
    borderLeftWidth: 3,
    borderLeftColor: colors.blue,
    paddingLeft: 10,
    marginVertical: 4,
  },
  quoteText: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.textDim,
    fontStyle: 'italic',
  },
  listWrap: { marginVertical: 2, gap: 4 },
  listItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  bullet: { color: colors.blue, fontSize: 16, lineHeight: 24 },
  orderNumber: { color: colors.textFaint, fontSize: 13, lineHeight: 24, minWidth: 16 },
  hr: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderStrong,
    marginVertical: 6,
  },
  codeBlockWrap: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginVertical: 4,
    overflow: 'hidden',
  },
  codeBlockHeader: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  codeBlockLang: {
    fontFamily: font.mono,
    fontSize: 10.5,
    color: colors.textFaint,
    fontWeight: '600',
  },
  codeScroll: { padding: 10 },
  codeBlockText: {
    fontFamily: font.mono,
    fontSize: 12.5,
    lineHeight: 18,
    color: '#D8DEE9',
  },
  /* 表格 */
  tableWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  tableWrapWide: { borderRadius: radius.sm },
  tableRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tableHeaderRow: { backgroundColor: colors.glassStrong, borderTopWidth: 0 },
  tableRowStripe: { backgroundColor: colors.glass },
  tableCell: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  tableCellFirst: { borderLeftWidth: 0 },
  tableHeaderText: { color: colors.text, fontSize: 13, fontWeight: '600', lineHeight: 19 },
  tableCellText: { color: colors.textDim, fontSize: 13, lineHeight: 19 },});

