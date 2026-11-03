import React from 'react';
import {
  Animated,
  Clipboard,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, font, radius, semantic, space } from './theme';
import { highlight, type SyntaxKind } from './syntax';

const SYNTAX_STYLES: Record<SyntaxKind, { color?: string; fontStyle?: 'italic' }> = {
  plain: {},
  comment: { color: '#6E7781', fontStyle: 'italic' },
  string: { color: '#0A7D32' },
  keyword: { color: '#8250DF' },
  literal: { color: '#0550AE' },
  number: { color: '#0550AE' },
  function: { color: '#0550AE' },
  operator: { color: '#57606A' },
  property: { color: '#0550AE' },
  tag: { color: '#116329' },
};

/* ------------------------------------------------------------------ *
 * 剪贴板复制工具
 * ------------------------------------------------------------------ */

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    Clipboard.setString(text);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 流式光标
 * ------------------------------------------------------------------ */

function StreamingCursor(): React.ReactElement {
  const opacity = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.15,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.Text style={[styles.cursorText, { opacity }]}>
      {' ▎'}
    </Animated.Text>
  );
}

/* ------------------------------------------------------------------ *
 * 行内词法解析
 * ------------------------------------------------------------------ */

interface InlineToken {
  type: 'text' | 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'image';
  content: string;
  url?: string;
  alt?: string;
}

function parseInlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  // 匹配：图片、链接、加粗、删除线、行内代码、斜体
  const regex =
    /(!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\*([^*]+)\*)/g;
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
    if (fullMatch.startsWith('![') && match[3]) {
      tokens.push({
        type: 'image',
        content: match[2] ?? '',
        alt: match[2] ?? '',
        url: match[3],
      });
    } else if (fullMatch.startsWith('[') && match[4] && match[5]) {
      tokens.push({
        type: 'link',
        content: match[4],
        url: match[5],
      });
    } else if (fullMatch.startsWith('**') && match[6]) {
      tokens.push({
        type: 'bold',
        content: match[6],
      });
    } else if (fullMatch.startsWith('~~') && match[7]) {
      tokens.push({
        type: 'strike',
        content: match[7],
      });
    } else if (fullMatch.startsWith('`') && match[8]) {
      tokens.push({
        type: 'code',
        content: match[8],
      });
    } else if (fullMatch.startsWith('*') && match[9]) {
      tokens.push({
        type: 'italic',
        content: match[9],
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

function handleOpenUrl(url?: string): void {
  if (!url) return;
  const target = url.trim();
  Linking.canOpenURL(target)
    .then((supported) => {
      if (supported) {
        Linking.openURL(target).catch(() => {});
      } else {
        // 部分 deep link 或协议可能 canOpenURL 返回 false，仍尝试唤起
        Linking.openURL(target).catch(() => {});
      }
    })
    .catch(() => {
      Linking.openURL(target).catch(() => {});
    });
}

function InlineText({
  text,
  baseStyle,
  trailingCursor,
}: {
  text: string;
  baseStyle?: object;
  trailingCursor?: boolean;
}): React.ReactElement {
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
                onPress={() => handleOpenUrl(token.url)}
              >
                {token.content}
              </Text>
            );
          case 'image':
            return (
              <Text
                key={idx}
                style={styles.link}
                onPress={() => handleOpenUrl(token.url)}
              >
                {`[图片: ${token.alt || '未命名'}]`}
              </Text>
            );
          default:
            return <Text key={idx}>{token.content}</Text>;
        }
      })}
      {trailingCursor ? <StreamingCursor /> : null}
    </Text>
  );
}

/* ------------------------------------------------------------------ *
 * 块级解析（流式容错）
 * ------------------------------------------------------------------ */

/** 把已稳定的 Markdown 前缀和正在增长的尾部切开：只重新解析尾部 */
function splitStableMarkdown(text: string): { stable: string; tail: string } {
  const lines = text.split('\n');
  let fence = false;
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.startsWith('```')) fence = !fence;
    else if (!fence && line === '') cut = i;
  }
  if (cut < 0) return { stable: '', tail: text };
  return {
    stable: lines.slice(0, cut).join('\n'),
    tail: lines.slice(cut + 1).join('\n'),
  };
}

type BlockItem =
  | { type: 'h1' | 'h2' | 'h3'; text: string }
  | { type: 'codeblock'; lang: string; code: string }
  | { type: 'quote'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'hr' }
  | { type: 'image'; alt: string; url: string }
  | { type: 'table'; header: string[]; align: Array<'left' | 'center' | 'right'>; rows: string[][] }
  | { type: 'p'; text: string };

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
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
    if (/^(#{1,6}\s|>\s?|```|!\[)/.test(line.trim())) break;
    const cells = splitTableRow(line);
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

    // 3. 表格
    const table = tryParseTable(lines, i);
    if (table) {
      flushAll();
      blocks.push(table.block);
      i = table.next - 1;
      continue;
    }

    // 4. 单行图片: ![alt](url)
    const imgMatch = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line.trim());
    if (imgMatch && imgMatch[2]) {
      flushAll();
      blocks.push({
        type: 'image',
        alt: imgMatch[1] ?? '',
        url: imgMatch[2].trim(),
      });
      continue;
    }

    // 5. 分割线: --- 或 *** 或 ___
    if (/^(\*\*\*|---|___)\s*$/.test(line.trim())) {
      flushAll();
      blocks.push({ type: 'hr' });
      continue;
    }

    // 6. 标题: #, ##, ###
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

    // 7. 引用块: > text
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

    // 8. 无序列表: - item 或 * item
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

    // 9. 有序列表: 1. item
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

    // 10. 普通段落
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
 * 代码块组件（支持水平滚动与一键复制反馈）
 * ------------------------------------------------------------------ */

function CodeBlockView({ lang, code }: { lang: string; code: string }): React.ReactElement {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = React.useCallback(async () => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
      }, 1800);
    }
  }, [code]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const displayLang = lang ? lang.toUpperCase() : 'TEXT';
  const tokens = React.useMemo(() => highlight(code, lang), [code, lang]);

  return (
    <View style={styles.codeBlockWrap}>
      <View style={styles.codeBlockHeader}>
        <Text style={styles.codeBlockLang}>{displayLang}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="复制代码"
          onPress={handleCopy}
          hitSlop={6}
          style={({ pressed }) => [
            styles.codeCopyBtn,
            copied && styles.codeCopyBtnCopied,
            pressed && styles.codeCopyBtnPressed,
          ]}
        >
          <Text style={[styles.codeCopyText, copied && styles.codeCopyTextCopied]}>
            {copied ? '✓ 已复制' : '❐ 复制'}
          </Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.codeScroll}
      >
        <Text style={styles.codeBlockText}>
          {tokens.map((token, i) =>
            token.kind === 'plain' ? (
              token.text
            ) : (
              <Text key={i} style={SYNTAX_STYLES[token.kind]}>
                {token.text}
              </Text>
            ),
          )}
        </Text>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 图片视图
 * ------------------------------------------------------------------ */

function ImageView({ alt, url }: { alt: string; url: string }): React.ReactElement {
  const [hasError, setHasError] = React.useState(false);

  return (
    <View style={styles.imageCard}>
      {hasError ? (
        <View style={styles.imageFallback}>
          <Text style={styles.imageFallbackIcon}>🖼</Text>
          <Text style={styles.imageFallbackText}>{alt || '无法载入图片'}</Text>
          <Text style={styles.imageFallbackSub} numberOfLines={1}>
            {url}
          </Text>
        </View>
      ) : (
        <Pressable onPress={() => handleOpenUrl(url)}>
          <Image
            source={{ uri: url }}
            style={styles.image}
            resizeMode="contain"
            onError={() => setHasError(true)}
          />
        </Pressable>
      )}
      {alt ? (
        <View style={styles.imageCaptionWrap}>
          <Text style={styles.imageCaption} numberOfLines={2}>
            {alt}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * 表格
 * ------------------------------------------------------------------ */

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
  const cellAlign = (col: number): TextStyleAlign => {
    return align[col] ?? 'left';
  };

  const body = (
    <View style={[styles.tableWrap, wide ? styles.tableWrapWide : null]}>
      <View style={[styles.tableRow, styles.tableHeaderRow]}>
        {header.map((cell, col) => (
          <View
            key={col}
            style={[
              styles.tableCell,
              col === 0 ? styles.tableCellFirst : null,
              wide ? styles.tableCellWide : { flex: 1 },
            ]}
          >
            <InlineText
              text={cell}
              baseStyle={{ ...styles.tableHeaderText, textAlign: cellAlign(col) }}
            />
          </View>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={[styles.tableRow, r % 2 === 1 ? styles.tableRowStripe : null]}>
          {row.map((cell, col) => (
            <View
              key={col}
              style={[
                styles.tableCell,
                col === 0 ? styles.tableCellFirst : null,
                wide ? styles.tableCellWide : { flex: 1 },
              ]}
            >
              <InlineText
                text={cell}
                baseStyle={{ ...styles.tableCellText, textAlign: cellAlign(col) }}
              />
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

type TextStyleAlign = 'left' | 'center' | 'right' | 'justify' | 'auto';

/* ------------------------------------------------------------------ *
 * 主导出组件
 * ------------------------------------------------------------------ */

export interface MarkdownViewProps {
  text: string;
  style?: StyleProp<ViewStyle>;
  /** 是否处于流式生成中，为 true 时末尾显示脉冲光标 */
  streaming?: boolean;
  /** 兼容 isStreaming 属性 */
  isStreaming?: boolean;
}

export function MarkdownView({
  text,
  style,
  streaming,
  isStreaming,
}: MarkdownViewProps): React.ReactElement {
  const activeStreaming = Boolean(streaming || isStreaming);
  const { stable, tail } = splitStableMarkdown(text);
  const stableBlocks = React.useMemo(
    () => (stable ? parseMarkdownBlocks(stable) : []),
    [stable]
  );
  const tailBlocks = React.useMemo(() => (tail ? parseMarkdownBlocks(tail) : []), [tail]);
  const blocks = React.useMemo(
    () => [...stableBlocks, ...tailBlocks],
    [stableBlocks, tailBlocks]
  );

  const lastBlockIndex = blocks.length - 1;
  const lastBlock = blocks[lastBlockIndex];
  const lastBlockIsParagraph = lastBlock && lastBlock.type === 'p';

  return (
    <View style={[styles.root, style]}>
      {blocks.map((block, i) => {
        const isLast = i === lastBlockIndex;
        const showCursorInParagraph = isLast && activeStreaming && block.type === 'p';

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
          case 'image':
            return <ImageView key={i} alt={block.alt} url={block.url} />;
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
                    <View style={styles.listContent}>
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
                    <View style={styles.listContent}>
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
                <InlineText
                  text={block.text}
                  baseStyle={styles.paragraph}
                  trailingCursor={showCursorInParagraph}
                />
              </View>
            );
        }
      })}

      {/* 当最后一块不是普通段落（例如代码块/表格结尾），但依然在流式时，显示独立光标行 */}
      {activeStreaming && !lastBlockIsParagraph ? (
        <View style={styles.trailingCursorWrap}>
          <StreamingCursor />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  bold: { fontWeight: '700', color: colors.text },
  italic: { fontStyle: 'italic', color: colors.text },
  strike: { textDecorationLine: 'line-through', color: colors.textFaint },
  inlineCode: {
    fontFamily: font.mono,
    fontSize: 13,
    color: colors.text,
    backgroundColor: semantic.codeInline,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 5,
  },
  link: {
    color: semantic.link,
    textDecorationLine: 'underline',
  },
  cursorText: {
    fontFamily: font.mono,
    color: colors.blue,
    fontSize: 14,
    fontWeight: '700',
  },
  trailingCursorWrap: {
    paddingVertical: 2,
  },
  h1Wrap: { marginTop: 6, marginBottom: 2 },
  h1Text: { fontSize: 21, lineHeight: 30, fontWeight: '700', color: colors.text },
  h2Wrap: { marginTop: 5, marginBottom: 2 },
  h2Text: { fontSize: 19, lineHeight: 28, fontWeight: '700', color: colors.text },
  h3Wrap: { marginTop: 4, marginBottom: 1 },
  h3Text: { fontSize: 17, lineHeight: 24, fontWeight: '600', color: colors.text },
  pWrap: { marginVertical: 1 },
  paragraph: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.text,
  },
  quoteWrap: {
    borderLeftWidth: 3,
    borderLeftColor: colors.borderStrong,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
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
  listContent: { flex: 1 },
  bullet: { color: colors.blue, fontSize: 16, lineHeight: 24 },
  orderNumber: { color: colors.textFaint, fontSize: 13, lineHeight: 24, minWidth: 18 },
  hr: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderStrong,
    marginVertical: 6,
  },
  /* 代码块 */
  codeBlockWrap: {
    backgroundColor: semantic.codeBlock,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginVertical: 4,
    overflow: 'hidden',
  },
  codeBlockHeader: {
    backgroundColor: colors.glassStrong,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  codeBlockLang: {
    fontFamily: font.mono,
    fontSize: 11,
    color: colors.textFaint,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  codeCopyBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  codeCopyBtnCopied: {
    backgroundColor: colors.okSoft,
  },
  codeCopyBtnPressed: {
    opacity: 0.7,
  },
  codeCopyText: {
    fontFamily: font.mono,
    fontSize: 11,
    color: colors.textDim,
  },
  codeCopyTextCopied: {
    color: colors.ok,
    fontWeight: '600',
  },
  codeScroll: { padding: 12 },
  codeBlockText: {
    fontFamily: font.mono,
    fontSize: 11.5,
    lineHeight: 17,
    color: '#1F2328',
  },
  /* 图片 */
  imageCard: {
    marginVertical: 6,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: 220,
    backgroundColor: 'transparent',
  },
  imageFallback: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
  },
  imageFallbackIcon: {
    fontSize: 28,
    marginBottom: 6,
    opacity: 0.6,
  },
  imageFallbackText: {
    fontSize: 13,
    color: colors.textDim,
    fontWeight: '500',
  },
  imageFallbackSub: {
    fontSize: 11,
    color: colors.textFaint,
    marginTop: 2,
    fontFamily: font.mono,
  },
  imageCaptionWrap: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  imageCaption: {
    fontSize: 12,
    color: colors.textDim,
    fontStyle: 'italic',
  },
  /* 表格 */
  tableWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    overflow: 'hidden',
    marginVertical: 4,
  },
  tableWrapWide: { borderRadius: radius.sm },
  tableRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tableHeaderRow: {
    backgroundColor: colors.glassStrong,
    borderTopWidth: 0,
  },
  tableRowStripe: {
    backgroundColor: colors.bgElevated,
  },
  tableCell: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  tableCellWide: {
    minWidth: 100,
  },
  tableCellFirst: { borderLeftWidth: 0 },
  tableHeaderText: { color: colors.text, fontSize: 12, fontWeight: '500', lineHeight: 18 },
  tableCellText: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
});
