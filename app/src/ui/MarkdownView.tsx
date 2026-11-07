import React from 'react';
import {
  Animated,
  Clipboard,
  findNodeHandle,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  font,
  radius,
  space,
  useTheme,
  useThemedStyles,
  type Palette,
  type Theme,
} from './theme';
import { highlight, type SyntaxKind } from './syntax';
import { TableModal } from './chat/TableModal';
import { BrandIcon } from './components';
import { captureAndShareView, captureAndSaveView } from '../lib/host';

type SyntaxStyles = Record<SyntaxKind, TextStyle>;

function syntaxStyles(c: Palette): SyntaxStyles {
  return {
    plain: {},
    comment: { color: c.syntax.comment, fontStyle: 'italic' },
    string: { color: c.syntax.string },
    keyword: { color: c.syntax.keyword },
    literal: { color: c.syntax.literal },
    number: { color: c.syntax.number },
    function: { color: c.syntax.function },
    operator: { color: c.syntax.operator },
    property: { color: c.syntax.property },
    tag: { color: c.syntax.tag },
  };
}

type MarkdownStyles = ReturnType<typeof createStyles>;

const MarkdownStylesContext = React.createContext<{
  styles: MarkdownStyles;
  syntax: SyntaxStyles;
} | null>(null);

function useMarkdownStyles(): { styles: MarkdownStyles; syntax: SyntaxStyles } {
  const value = React.useContext(MarkdownStylesContext);
  if (!value) throw new Error('MarkdownView must be rendered inside its styles provider');
  return value;
}

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
  const { styles } = useMarkdownStyles();
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

function InlineTokenSpans({
  text,
  baseStyle,
  trailingCursor,
}: {
  text: string;
  baseStyle?: object;
  trailingCursor?: boolean;
}): React.ReactElement {
  const { styles } = useMarkdownStyles();
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

function InlineText({
  text,
  baseStyle,
  trailingCursor,
}: {
  text: string;
  baseStyle?: object;
  trailingCursor?: boolean;
}): React.ReactElement {
  return (
    <Text style={baseStyle} selectable>
      <InlineTokenSpans text={text} trailingCursor={trailingCursor} />
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
  const { styles, syntax } = useMarkdownStyles();
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
        <Text style={styles.codeBlockText} selectable>
          {tokens.map((token, i) =>
            token.kind === 'plain' ? (
              token.text
            ) : (
              <Text key={i} style={syntax[token.kind]}>
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
  const { styles } = useMarkdownStyles();
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
  const { styles } = useMarkdownStyles();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const tableRef = React.useRef<React.ComponentRef<typeof View>>(null);
  const wide = header.length >= 4;
  const cellAlign = (col: number): TextStyleAlign => {
    return align[col] ?? 'left';
  };

  const toMarkdown = (): string => {
    const delim = align.map((a) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : ':---'));
    const lines = [
      `| ${header.join(' | ')} |`,
      `| ${delim.join(' | ')} |`,
      ...rows.map((row) => `| ${row.join(' | ')} |`),
    ];
    return lines.join('\n');
  };

  const handleCopy = () => {
    Clipboard.setString(toMarkdown());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveImage = () => {
    if (!tableRef.current) return;
    const node = findNodeHandle(tableRef.current);
    if (!node) return;
    void captureAndSaveView(node, '表格').then((ok) => {
      if (ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  };

  const handleShareImage = () => {
    if (!tableRef.current) return;
    const node = findNodeHandle(tableRef.current);
    if (!node) return;
    void captureAndShareView(node, '表格分享');
  };

  return (
    <View style={styles.tableCardContainer}>
      {/* 顶部固定操作栏（严格对齐 WorkBuddy：左侧「表格」，右侧 4 个固定操作图标：复制、存图、全屏、分享） */}
      <View style={styles.tableTopBar}>
        <Text style={styles.tableTopTitle}>表格</Text>
        <View style={styles.tableTopActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="复制表格内容"
            onPress={handleCopy}
            style={({ pressed }) => [styles.tableIconBtn, pressed && styles.tableIconBtnPressed]}
            hitSlop={6}
          >
            <BrandIcon name={copied ? 'check' : 'copy'} size={15} color={copied ? '#10B981' : '#64748B'} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="保存表格图片到相册"
            onPress={handleSaveImage}
            style={({ pressed }) => [styles.tableIconBtn, pressed && styles.tableIconBtnPressed]}
            hitSlop={6}
          >
            <BrandIcon name={saved ? 'check' : 'image'} size={15} color={saved ? '#10B981' : '#64748B'} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="全屏放大表格"
            onPress={() => setModalOpen(true)}
            style={({ pressed }) => [styles.tableIconBtn, pressed && styles.tableIconBtnPressed]}
            hitSlop={6}
          >
            <BrandIcon name="external" size={15} color="#64748B" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="分享表格长图"
            onPress={handleShareImage}
            style={({ pressed }) => [styles.tableIconBtn, pressed && styles.tableIconBtnPressed]}
            hitSlop={6}
          >
            <BrandIcon name="share" size={15} color="#64748B" />
          </Pressable>
        </View>
      </View>

      {/* 横向滚动表格正文：截图 Ref 仅挂载在包含所有列完整宽度的 tableGrid 上，不包含上方操作栏 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tableScrollContent}>
        <View ref={tableRef} collapsable={false} style={styles.tableGrid}>
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
      </ScrollView>

      <TableModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        header={header}
        align={align}
        rows={rows}
      />
    </View>
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
  /** U7 对话字号倍率（1 = 标准） */
  fontScale?: number;
  /** 选中重置标识：改变时强制卸载原生选择器，快速取消选中 */
  selectionResetKey?: number;
}

type ProseBlockItem = Extract<BlockItem, { type: 'h1' | 'h2' | 'h3' | 'quote' | 'ul' | 'ol' | 'p' }>;

type RenderSection =
  | { kind: 'prose'; items: Array<{ block: ProseBlockItem; trailingCursor?: boolean }> }
  | { kind: 'block'; block: BlockItem; trailingCursor?: boolean };

function groupBlocksForContinuousSelection(
  blocks: BlockItem[],
  streaming: boolean,
): RenderSection[] {
  const sections: RenderSection[] = [];
  let currentProse: Array<{ block: ProseBlockItem; trailingCursor?: boolean }> = [];

  const flushProse = (): void => {
    if (currentProse.length > 0) {
      sections.push({ kind: 'prose', items: [...currentProse] });
      currentProse = [];
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const isLast = i === blocks.length - 1;
    const isTrailing = streaming && isLast && block.type === 'p';

    if (
      block.type === 'p' ||
      block.type === 'h1' ||
      block.type === 'h2' ||
      block.type === 'h3' ||
      block.type === 'quote' ||
      block.type === 'ul' ||
      block.type === 'ol'
    ) {
      currentProse.push({ block, trailingCursor: isTrailing });
    } else {
      flushProse();
      sections.push({ kind: 'block', block, trailingCursor: isTrailing });
    }
  }
  flushProse();
  return sections;
}

function ContinuousProseText({
  items,
  selectionResetKey,
}: {
  items: Array<{ block: ProseBlockItem; trailingCursor?: boolean }>;
  selectionResetKey?: number;
}): React.ReactElement {
  const { styles } = useMarkdownStyles();

  return (
    <View style={styles.proseContainer}>
      <Text key={selectionResetKey ? `sel-${selectionResetKey}` : undefined} style={styles.proseRootText} selectable>
        {items.map((item, idx) => {
          const { block, trailingCursor } = item;
          const isNotFirst = idx > 0;
          const leadingNewlines = isNotFirst ? '\n\n' : '';

          switch (block.type) {
            case 'h1':
              return (
                <Text key={idx}>
                  {leadingNewlines}
                  <InlineTokenSpans text={block.text} baseStyle={styles.h1Text} />
                </Text>
              );
            case 'h2':
              return (
                <Text key={idx}>
                  {leadingNewlines}
                  <InlineTokenSpans text={block.text} baseStyle={styles.h2Text} />
                </Text>
              );
            case 'h3':
              return (
                <Text key={idx}>
                  {leadingNewlines}
                  <InlineTokenSpans text={block.text} baseStyle={styles.h3Text} />
                </Text>
              );
            case 'quote':
              return (
                <Text key={idx}>
                  {leadingNewlines}
                  <Text style={styles.quoteBar}>▌ </Text>
                  <InlineTokenSpans text={block.text} baseStyle={styles.quoteText} />
                </Text>
              );
            case 'ul':
              return (
                <Text key={idx}>
                  {leadingNewlines}
                  {block.items.map((li, lIdx) => (
                    <Text key={lIdx}>
                      {lIdx > 0 ? '\n' : ''}
                      <Text style={styles.bullet}>• </Text>
                      <InlineTokenSpans text={li} baseStyle={styles.paragraph} />
                    </Text>
                  ))}
                </Text>
              );
            case 'ol':
              return (
                <Text key={idx}>
                  {leadingNewlines}
                  {block.items.map((li, lIdx) => (
                    <Text key={lIdx}>
                      {lIdx > 0 ? '\n' : ''}
                      <Text style={styles.orderNumber}>{`${lIdx + 1}. `}</Text>
                      <InlineTokenSpans text={li} baseStyle={styles.paragraph} />
                    </Text>
                  ))}
                </Text>
              );
            case 'p':
            default:
              return (
                <Text key={idx}>
                  {leadingNewlines}
                  <InlineTokenSpans
                    text={block.text}
                    baseStyle={styles.paragraph}
                    trailingCursor={trailingCursor}
                  />
                </Text>
              );
          }
        })}
      </Text>
    </View>
  );
}

const MarkdownBlock = React.memo(function MarkdownBlock({
  block,
  trailingCursor,
  fontScale: _fontScale,
}: {
  block: BlockItem;
  trailingCursor?: boolean;
  fontScale?: number;
}): React.ReactElement {
  const { styles } = useMarkdownStyles();
  switch (block.type) {
    case 'h1':
      return (
        <View style={styles.h1Wrap}>
          <InlineText text={block.text} baseStyle={styles.h1Text} />
        </View>
      );
    case 'h2':
      return (
        <View style={styles.h2Wrap}>
          <InlineText text={block.text} baseStyle={styles.h2Text} />
        </View>
      );
    case 'h3':
      return (
        <View style={styles.h3Wrap}>
          <InlineText text={block.text} baseStyle={styles.h3Text} />
        </View>
      );
    case 'codeblock':
      return <CodeBlockView lang={block.lang} code={block.code} />;
    case 'image':
      return <ImageView alt={block.alt} url={block.url} />;
    case 'table':
      return <TableView header={block.header} align={block.align} rows={block.rows} />;
    case 'quote':
      return (
        <View style={styles.quoteWrap}>
          <InlineText text={block.text} baseStyle={styles.quoteText} />
        </View>
      );
    case 'ul':
      return (
        <View style={styles.listWrap}>
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
        <View style={styles.listWrap}>
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
      return <View style={styles.hr} />;
    case 'p':
    default:
      return (
        <View style={styles.pWrap}>
          <InlineText
            text={block.text}
            baseStyle={styles.paragraph}
            trailingCursor={trailingCursor}
          />
        </View>
      );
  }
});

function MarkdownViewImpl({
  text,
  style,
  streaming,
  isStreaming,
  fontScale = 1,
  selectionResetKey,
}: MarkdownViewProps): React.ReactElement {
  const theme = useTheme();
  const baseStyles = useThemedStyles(createStyles);
  const styles = React.useMemo(() => scaleStyles(baseStyles, fontScale), [baseStyles, fontScale]);
  const syntax = React.useMemo(() => syntaxStyles(theme.palette), [theme.palette]);
  const activeStreaming = Boolean(streaming || isStreaming);

  const blocks = React.useMemo(() => parseMarkdownBlocks(text), [text]);
  const sections = React.useMemo(
    () => groupBlocksForContinuousSelection(blocks, activeStreaming),
    [blocks, activeStreaming],
  );

  return (
    <MarkdownStylesContext.Provider value={{ styles, syntax }}>
      <View style={[styles.root, style]}>
        {sections.map((section, idx) => {
          if (section.kind === 'prose') {
            return (
              <ContinuousProseText
                key={`prose-${idx}`}
                items={section.items}
                selectionResetKey={selectionResetKey}
              />
            );
          }
          return (
            <MarkdownBlock
              key={`block-${idx}`}
              block={section.block}
              trailingCursor={section.trailingCursor}
              fontScale={fontScale}
            />
          );
        })}
      </View>
    </MarkdownStylesContext.Provider>
  );
}

export const MarkdownView = React.memo(MarkdownViewImpl);

const createStyles = ({ palette: c, semantic: s }: Theme) =>
  StyleSheet.create({
  root: { gap: space.sm },
  proseContainer: {
    marginVertical: 1,
  },
  proseRootText: {
    color: c.text,
  },
  quoteBar: {
    color: c.borderStrong,
    fontWeight: '700',
  },
  bold: { fontWeight: '700', color: c.text },
  italic: { fontStyle: 'italic', color: c.text },
  strike: { textDecorationLine: 'line-through', color: c.textFaint },
  inlineCode: {
    fontFamily: font.mono,
    fontSize: 13,
    color: c.text,
    backgroundColor: s.codeInline,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    borderRadius: 4,
    paddingHorizontal: 5,
  },
  link: {
    color: s.link,
    textDecorationLine: 'underline',
  },
  cursorText: {
    fontFamily: font.mono,
    color: c.blue,
    fontSize: 14,
    fontWeight: '700',
  },
  trailingCursorWrap: {
    paddingVertical: 2,
  },
  h1Wrap: { marginTop: 6, marginBottom: 2 },
  h1Text: { fontSize: 21, lineHeight: 30, fontWeight: '700', color: c.text },
  h2Wrap: { marginTop: 5, marginBottom: 2 },
  h2Text: { fontSize: 19, lineHeight: 28, fontWeight: '700', color: c.text },
  h3Wrap: { marginTop: 4, marginBottom: 1 },
  h3Text: { fontSize: 17, lineHeight: 24, fontWeight: '600', color: c.text },
  pWrap: { marginVertical: 1 },
  paragraph: {
    fontSize: 14,
    lineHeight: 22,
    color: c.text,
  },
  quoteWrap: {
    borderLeftWidth: 3,
    borderLeftColor: c.borderStrong,
    backgroundColor: c.bgElevated,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginVertical: 4,
  },
  quoteText: {
    fontSize: 14,
    lineHeight: 22,
    color: c.textDim,
    fontStyle: 'italic',
  },
  listWrap: { marginVertical: 2, gap: 4 },
  listItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  listContent: { flex: 1 },
  bullet: { color: c.blue, fontSize: 16, lineHeight: 24 },
  orderNumber: { color: c.textFaint, fontSize: 13, lineHeight: 24, minWidth: 18 },
  hr: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: c.borderStrong,
    marginVertical: 6,
  },
  /* 代码块 */
  codeBlockWrap: {
    backgroundColor: s.codeBlock,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    marginVertical: 4,
    overflow: 'hidden',
  },
  codeBlockHeader: {
    backgroundColor: c.glassStrong,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  codeBlockLang: {
    fontFamily: font.mono,
    fontSize: 11,
    color: c.textFaint,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  codeCopyBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: c.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  },
  codeCopyBtnCopied: {
    backgroundColor: c.okSoft,
  },
  codeCopyBtnPressed: {
    opacity: 0.7,
  },
  codeCopyText: {
    fontFamily: font.mono,
    fontSize: 11,
    color: c.textDim,
  },
  codeCopyTextCopied: {
    color: c.ok,
    fontWeight: '600',
  },
  codeScroll: { padding: 12 },
  codeBlockText: {
    fontFamily: font.mono,
    fontSize: 11.5,
    lineHeight: 17,
    color: c.codeText,
  },
  /* 图片 */
  imageCard: {
    marginVertical: 6,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.bgElevated,
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
    backgroundColor: c.bgElevated,
  },
  imageFallbackIcon: {
    fontSize: 28,
    marginBottom: 6,
    opacity: 0.6,
  },
  imageFallbackText: {
    fontSize: 13,
    color: c.textDim,
    fontWeight: '500',
  },
  imageFallbackSub: {
    fontSize: 11,
    color: c.textFaint,
    marginTop: 2,
    fontFamily: font.mono,
  },
  imageCaptionWrap: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: c.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  imageCaption: {
    fontSize: 12,
    color: c.textDim,
    fontStyle: 'italic',
  },
  /* 表格 */
  tableCardContainer: {
    marginVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  tableTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tableTopTitle: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
  },
  tableTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tableIconBtn: {
    padding: 4,
    borderRadius: radius.xs,
  },
  tableIconBtnPressed: {
    opacity: 0.5,
  },
  tableScrollContent: {
    paddingBottom: 2,
  },
  tableGrid: {
    minWidth: '100%',
    backgroundColor: '#FFFFFF',
  },
  tableHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: c.glassStrong,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  tableCountText: {
    color: c.textFaint,
    fontSize: 10.5,
    fontWeight: '500',
  },
  tableExpandBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.xs,
    backgroundColor: c.blueSoft,
  },
  tableExpandText: {
    color: c.blue,
    fontSize: 10.5,
    fontWeight: '600',
  },
  tableWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.borderStrong,
    borderRadius: radius.sm,
    overflow: 'hidden',
    marginVertical: 4,
  },
  tableWrapWide: { borderRadius: radius.sm },
  tableRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  tableHeaderRow: {
    backgroundColor: c.glassStrong,
    borderTopWidth: 0,
  },
  tableRowStripe: {
    backgroundColor: c.bgElevated,
  },
  tableCell: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: c.border,
  },
  tableCellWide: {
    minWidth: 100,
  },
  tableCellFirst: { borderLeftWidth: 0 },
  tableHeaderText: { color: c.text, fontSize: 12, fontWeight: '500', lineHeight: 18 },
  tableCellText: { color: c.textDim, fontSize: 12, lineHeight: 18 },
});

/**
 * U7 字号档：按当前主题重建一次基础样式，再按倍率复制 fontSize/lineHeight。
 * 结果通过 MarkdownStylesContext 下发，memo 子组件靠 context 更新重渲染；
 * 不再使用模块级可变 styles，避免主题和字号互相覆盖。
 */
function scaleStyles(base: MarkdownStyles, scale: number): MarkdownStyles {
  if (scale <= 1) return base;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(base) as Array<keyof MarkdownStyles>) {
    const flat = StyleSheet.flatten(base[key]) as TextStyle | undefined;
    out[key] =
      flat && (flat.fontSize !== undefined || flat.lineHeight !== undefined)
        ? {
            ...flat,
            ...(flat.fontSize !== undefined ? { fontSize: flat.fontSize * scale } : {}),
            ...(flat.lineHeight !== undefined ? { lineHeight: flat.lineHeight * scale } : {}),
          }
        : base[key];
  }
  return out as MarkdownStyles;
}
