import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { WorkspaceEntry } from '../protocol';
import { openWorkspaceFile, shareWorkspaceFile } from '../lib/fileActions';
import { store } from './useStore';
import { Btn, IconButton } from './parts';
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
  /** 每行的操作菜单 / 重命名草稿（U8 文件操作） */
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<{ entry: WorkspaceEntry; name: string } | null>(null);
  /** U8：按文件名过滤当前目录 */
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [filter, setFilter] = React.useState('');

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

  const entryPath = (name: string): string => joinPath(path, name);

  const saveRename = async (): Promise<void> => {
    if (!renaming) return;
    const next = renaming.name.trim();
    if (!next || next.includes('/') || next === renaming.entry.name) {
      setRenaming(null);
      return;
    }
    try {
      await store.renameWorkspace(entryPath(renaming.entry.name), joinPath(path, next));
      setRenaming(null);
      await load(path);
    } catch (error) {
      setNotice(`重命名失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const confirmDelete = (entry: WorkspaceEntry): void => {
    setMenuFor(null);
    Alert.alert(
      '删除',
      `删除「${entry.name}」？${entry.kind === 'dir' ? '目录会连同里面的内容一起删除。' : ''}不会进回收站。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await store.deleteWorkspace(entryPath(entry.name));
                if (path !== '/' && entries.length <= 1) {
                  await load('/');
                } else {
                  await load(path);
                }
              } catch (error) {
                setNotice(`删除失败：${error instanceof Error ? error.message : String(error)}`);
              }
            })();
          },
        },
      ],
    );
  };

  const shareFile = (entry: WorkspaceEntry): void => {
    setMenuFor(null);
    void shareWorkspaceFile(entryPath(entry.name).replace(/^\/+/, '')).then((result) => {
      if (!result.ok) setNotice(result.message ?? '分享失败。');
    });
  };

  const segments = path.split('/').filter(Boolean);
  const crumbs: Array<{ label: string; path: string }> = [{ label: '工作区', path: '/' }];
  let accumulated = '';
  for (const segment of segments) {
    accumulated += `/${segment}`;
    crumbs.push({ label: segment, path: accumulated });
  }
  const keyword = filter.trim().toLowerCase();
  const visibleEntries = keyword
    ? entries.filter((entry) => entry.name.toLowerCase().includes(keyword))
    : entries;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回" onPress={() => store.closeFiles()} />
        <Text style={styles.title}>文件</Text>
        <IconButton
          glyph="⌕"
          label={searchOpen ? '关闭文件搜索' : '搜索文件'}
          onPress={() => {
            setSearchOpen((open) => !open);
            setFilter('');
          }}
          size={32}
        />
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

        {searchOpen ? (
          <View style={styles.searchBox}>
            <Text style={styles.searchGlyph}>⌕</Text>
            <TextInput
              style={styles.searchInput}
              value={filter}
              onChangeText={setFilter}
              placeholder="按文件名过滤"
              placeholderTextColor={colors.textFaint}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="按文件名过滤"
            />
            {filter.length > 0 ? (
              <Pressable accessibilityRole="button" onPress={() => setFilter('')} hitSlop={8}>
                <Text style={styles.searchClear}>×</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {loading ? <Text style={styles.hint}>正在读目录…</Text> : null}

        {!loading && visibleEntries.length === 0 && !notice ? (
          <Text style={styles.hint}>
            {keyword ? '没有匹配的文件。' : '这个目录是空的。'}
          </Text>
        ) : null}

        {renaming ? (
          <View style={styles.renameCard}>
            <Text style={styles.renameLabel}>重命名「{renaming.entry.name}」</Text>
            <TextInput
              style={styles.renameInput}
              value={renaming.name}
              onChangeText={(name) => setRenaming({ ...renaming, name })}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="新文件名"
            />
            <View style={styles.renameActions}>
              <Btn label="取消" kind="ghost" onPress={() => setRenaming(null)} style={{ flex: 1 }} />
              <Btn label="保存" onPress={() => void saveRename()} style={{ flex: 1 }} />
            </View>
          </View>
        ) : null}

        <View style={styles.list}>
          {visibleEntries.map((entry) => {
            const isDir = entry.kind === 'dir';
            const menuOpen = menuFor === entry.name;
            return (
              <React.Fragment key={entry.name}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${isDir ? '目录' : '文件'} ${entry.name}`}
                  onPress={() => (isDir ? void load(joinPath(path, entry.name)) : openFile(entry))}
                  onLongPress={() => setMenuFor(menuOpen ? null : entry.name)}
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
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${entry.name} 操作`}
                    hitSlop={10}
                    onPress={() => setMenuFor(menuOpen ? null : entry.name)}
                    style={styles.moreButton}
                  >
                    <Text style={styles.moreText}>⋯</Text>
                  </Pressable>
                  <Text style={styles.chevron}>{isDir ? '›' : '↗'}</Text>
                </Pressable>
                {menuOpen ? (
                  <View style={styles.actionsMenu}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setRenaming({ entry, name: entry.name });
                        setMenuFor(null);
                      }}
                    >
                      <Text style={styles.menuItem}>重命名</Text>
                    </Pressable>
                    {isDir ? null : (
                      <Pressable accessibilityRole="button" onPress={() => shareFile(entry)}>
                        <Text style={styles.menuItem}>分享</Text>
                      </Pressable>
                    )}
                    <Pressable accessibilityRole="button" onPress={() => confirmDelete(entry)}>
                      <Text style={[styles.menuItem, { color: colors.danger }]}>删除</Text>
                    </Pressable>
                  </View>
                ) : null}
              </React.Fragment>
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
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.glassStrong,
  },
  searchGlyph: { color: colors.textFaint, fontSize: 15 },
  searchInput: { flex: 1, color: colors.text, fontSize: 13, paddingVertical: 0 },
  searchClear: { color: colors.textFaint, fontSize: 16, paddingHorizontal: 2 },
  notice: { color: colors.warn, fontSize: 12, lineHeight: 17 },
  hint: { color: colors.textFaint, fontSize: 12.5, lineHeight: 18 },
  renameCard: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    padding: space.md,
    gap: space.sm,
  },
  renameLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  renameInput: {
    backgroundColor: colors.glassStrong,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: colors.text,
    fontSize: 13,
  },
  renameActions: { flexDirection: 'row', gap: space.sm },
  moreButton: { paddingHorizontal: 4, paddingVertical: 4 },
  moreText: { color: colors.textFaint, fontSize: 16, lineHeight: 18 },
  actionsMenu: {
    marginLeft: 44,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 2,
  },
  menuItem: { color: colors.blue, fontSize: 13, lineHeight: 20, paddingVertical: 4 },
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
