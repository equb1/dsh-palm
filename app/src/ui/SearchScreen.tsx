import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { SessionSearchHit } from '../protocol';
import { store } from './useStore';
import { IconButton } from './parts';
import { font, radius, space, topInset, useTheme, useThemedStyles, type Theme } from './theme';

/** E3 / 整页搜索：轻引擎正文全文搜索，点结果直接打开会话 */
function relTime(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return `${Math.round(hour / 24)} 天前`;
}

export function SearchScreen(): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<SessionSearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const seq = React.useRef(0);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    const current = ++seq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      void store
        .searchSessions(q)
        .then((hits) => {
          if (seq.current !== current) return;
          setResults(hits);
          setError(null);
        })
        .catch((err: unknown) => {
          if (seq.current !== current) return;
          setResults([]);
          setError(
            `搜索失败：${err instanceof Error ? err.message : String(err)}。完整引擎暂不支持全文搜索。`,
          );
        })
        .finally(() => {
          if (seq.current === current) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回" onPress={() => store.closeSearch()} />
        <Text style={styles.title}>搜索会话</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.searchBox}>
        <Text style={styles.searchGlyph}>⌕</Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="搜索全部会话正文"
          placeholderTextColor={palette.textFaint}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="搜索全部会话正文"
        />
        {query.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => setQuery('')} hitSlop={8}>
            <Text style={styles.clear}>×</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {loading ? <Text style={styles.hint}>正在搜…</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading && !error && query.trim().length === 0 ? (
          <Text style={styles.hint}>输入关键词，搜标题、历史消息和思考正文。</Text>
        ) : null}
        {!loading && !error && query.trim().length > 0 && results.length === 0 ? (
          <Text style={styles.hint}>没有找到匹配的会话。</Text>
        ) : null}

        {results.map((hit) => (
          <Pressable
            key={hit.sessionId}
            accessibilityRole="button"
            accessibilityLabel={`打开会话 ${hit.title}`}
            onPress={() => {
              store.closeSearch();
              void store.openSession(hit.sessionId);
            }}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.rowTop}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {hit.title}
              </Text>
              <Text style={styles.rowTime}>{relTime(hit.updatedAt)}</Text>
            </View>
            <Text style={styles.snippet} numberOfLines={2}>
              {hit.snippet}
            </Text>
            <Text style={styles.matches}>{hit.matches} 处匹配</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg, paddingTop: topInset },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  title: { flex: 1, color: c.text, fontSize: 17, fontWeight: '700' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    marginHorizontal: space.lg,
    marginBottom: space.md,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: c.glassStrong,
  },
  searchGlyph: { color: c.textFaint, fontSize: 15 },
  input: { flex: 1, color: c.text, fontSize: 13, paddingVertical: 0 },
  clear: { color: c.textFaint, fontSize: 16, paddingHorizontal: 2 },
  scroll: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: 8 },
  hint: { color: c.textFaint, fontSize: 12.5, lineHeight: 18, paddingVertical: 4 },
  error: { color: c.danger, fontSize: 12, lineHeight: 17 },
  row: {
    backgroundColor: c.glass,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    padding: space.md,
    gap: 4,
  },
  rowPressed: { backgroundColor: c.glassStrong },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { flex: 1, color: c.text, fontSize: 14, fontWeight: '600' },
  rowTime: { color: c.textFaint, fontSize: 11 },
  snippet: { color: c.textDim, fontSize: 12.5, lineHeight: 18 },
  matches: { color: c.textFaint, fontSize: 10.5, fontFamily: font.mono },
  });
