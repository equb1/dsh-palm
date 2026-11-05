import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { WorkspaceEntry } from '../protocol';
import { openWorkspaceFile } from '../lib/fileActions';
import { store } from './useStore';
import { IconButton } from './parts';
import { colors, radius, space, topInset } from './theme';

/** U8 第一步：工作区文件浏览（只列目录 + 用系统查看器打开文件） */
function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function joinPath(base: string, name: string): string {
  return base === '/' ? `/${name}` : `${base}/${name}`;
}

export function FilesScreen(): React.ReactElement {
  const [path, setPath] = React.useState('/');
  const [entries, setEntries] = React.useState<WorkspaceEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async (target: string): Promise<void> => {
    setLoading(true);
    setNotice(null);
    try {
      const result = await store.listWorkspace(target);
      setPath(result.path);
      setEntries(result.entries);
    } catch (error) {
      setEntries([]);
      setNotice(
        `列文件失败：${error instanceof Error ? error.message : String(error)}。轻引擎才有工作区；完整引擎暂不支持。`,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load('/');
  }, [load]);

  const openFile = (entry: WorkspaceEntry): void => {
    const rel = joinPath(path, entry.name).replace(/^\/+/, '');
    void openWorkspaceFile(rel).then((result) => {
      if (!result.ok) setNotice(result.message ?? '打不开这个文件。');
    });
  };

  const segments = path.split('/').filter(Boolean);
  const crumbs: Array<{ label: string; path: string }> = [{ label: '工作区', path: '/' }];
  let accumulated = '';
  for (const segment of segments) {
    accumulated += `/${segment}`;
    crumbs.push({ label: segment, path: accumulated });
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回" onPress={() => store.closeFiles()} />
        <Text style={styles.title}>文件</Text>
        <IconButton glyph="↻" label="刷新" onPress={() => void load(path)} size={32} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <React.Fragment key={crumb.path}>
                {index > 0 ? <Text style={styles.crumbSep}>/</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`打开目录 ${crumb.label}`}
                  disabled={last}
                  onPress={() => void load(crumb.path)}
                >
                  <Text style={[styles.crumb, last && styles.crumbActive]}>{crumb.label}</Text>
                </Pressable>
              </React.Fragment>
            );
          })}
        </ScrollView>

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {loading ? <Text style={styles.hint}>正在读目录…</Text> : null}

        {!loading && entries.length === 0 && !notice ? (
          <Text style={styles.hint}>这个目录是空的。</Text>
        ) : null}

        <View style={styles.list}>
          {entries.map((entry) => {
            const isDir = entry.kind === 'dir';
            return (
              <Pressable
                key={entry.name}
                accessibilityRole="button"
                accessibilityLabel={`${isDir ? '目录' : '文件'} ${entry.name}`}
                onPress={() => (isDir ? void load(joinPath(path, entry.name)) : openFile(entry))}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={[styles.icon, isDir && styles.iconDir]}>
                  <Text style={[styles.iconGlyph, isDir && { color: colors.blue }]}>
                    {isDir ? '▸' : '▤'}
                  </Text>
                </View>
                <View style={styles.rowTexts}>
                  <Text style={styles.name} numberOfLines={1}>
                    {entry.name}
                  </Text>
                  <Text style={styles.meta}>
                    {isDir ? '目录' : formatSize(entry.size) || '文件'}
                  </Text>
                </View>
                <Text style={styles.chevron}>{isDir ? '›' : '↗'}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.footnote}>
          工作区是 `/workspace`；文件用系统查看器打开，PDF 等暂不解析。
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: topInset },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '700' },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  crumbs: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  crumb: { color: colors.blue, fontSize: 12.5, paddingHorizontal: 2 },
  crumbActive: { color: colors.textFaint },
  crumbSep: { color: colors.textFaint, fontSize: 12.5 },
  notice: { color: colors.warn, fontSize: 12, lineHeight: 17 },
  hint: { color: colors.textFaint, fontSize: 12.5, lineHeight: 18 },
  list: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: 4,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 54,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  rowPressed: { backgroundColor: colors.glassStrong },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDir: { backgroundColor: colors.blueSoft },
  iconGlyph: { color: colors.textFaint, fontSize: 14, fontWeight: '600' },
  rowTexts: { flex: 1, gap: 1 },
  name: { color: colors.text, fontSize: 14 },
  meta: { color: colors.textFaint, fontSize: 11 },
  chevron: { color: colors.textFaint, fontSize: 14 },
  footnote: { color: colors.textFaint, fontSize: 11.5, lineHeight: 17, paddingHorizontal: space.xs },
});
