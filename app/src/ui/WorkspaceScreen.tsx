import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { store, useStore } from './useStore';
import { Btn, IconButton } from './parts';
import { radius, space, topInset, useTheme, useThemedStyles, type Theme } from './theme';

/**
 * U8 工作区页（只读概览 + 文件入口）。
 *
 * 轻引擎只有固定的 `/workspace`；完整引擎会报多个工作区。多工作区创建/置顶/分组
 * 还没接（M2），这里先把宿主报告的工作区、会话数、锦囊数列出来，并给文件面板入口。
 */
export function WorkspaceScreen(): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  const { palette } = useTheme();
  const state = useStore();
  const rows = store.sessionRows();
  const workspaces = state.workspaces;
  const [creating, setCreating] = React.useState(false);
  const [path, setPath] = React.useState('');

  const submit = async (): Promise<void> => {
    if (await store.createWorkspace(path)) {
      setPath('');
      setCreating(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton icon="back" label="返回" onPress={() => store.closeWorkspace()} />
        <Text style={styles.title}>工作区</Text>
        {state.engineKind !== 'light' ? (
          <IconButton
            icon="plus"
            label="新建工作区"
            onPress={() => setCreating((value) => !value)}
            size={32}
          />
        ) : null}
        <IconButton icon="folderOpen" label="打开文件" onPress={() => store.openFiles()} size={32} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {creating ? (
          <View style={styles.createCard}>
            <Text style={styles.createTitle}>新建工作区</Text>
            <TextInput
              value={path}
              onChangeText={setPath}
              placeholder="名称（如 notes）或绝对路径"
              placeholderTextColor={palette.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              accessibilityLabel="新工作区名称"
            />
            <View style={styles.actions}>
              <Btn label="取消" kind="ghost" onPress={() => setCreating(false)} style={{ flex: 1 }} />
              <Btn label="创建" onPress={() => void submit()} style={{ flex: 1 }} />
            </View>
          </View>
        ) : null}

        {workspaces.length === 0 ? (
          <Text style={styles.hint}>宿主没有报告工作区。</Text>
        ) : (
          workspaces.map((workspace) => {
            const sessions = rows.filter((row) => row.workspaceId === workspace.id);
            const running = sessions.filter(
              (row) => row.status === 'running' || row.status === 'waiting_approval',
            ).length;
            const presets = state.caps?.presets.filter((preset) =>
              workspace.presetIds.includes(preset.id),
            );
            return (
              <Pressable
                key={workspace.id}
                accessibilityRole="button"
                accessibilityLabel={`工作区 ${workspace.name}`}
                onPress={() => store.openFiles()}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              >
                <View style={styles.cardHead}>
                  <Text style={styles.name} numberOfLines={1}>
                    {workspace.name}
                  </Text>
                  {running > 0 ? (
                    <View style={styles.runningPill}>
                      <Text style={styles.runningText}>{running} 个运行中</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.rootPath} numberOfLines={1}>
                  {workspace.root}
                </Text>
                <Text style={styles.meta}>
                  {sessions.length} 个会话
                  {presets?.length ? ` · ${presets.length} 个锦囊` : ''}
                </Text>
                <View style={styles.actions}>
                  <Btn label="浏览文件" kind="ghost" onPress={() => store.openFiles()} style={{ flex: 1 }} />
                </View>
              </Pressable>
            );
          })
        )}

        <Text style={styles.footnote}>
          轻引擎只有固定的 `/workspace` 一个工作区；多工作区创建/置顶/分组在 M2。
        </Text>
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
  scroll: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  hint: { color: c.textFaint, fontSize: 12.5, lineHeight: 18 },
  createCard: {
    backgroundColor: c.glass,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    padding: space.md,
    gap: space.sm,
  },
  createTitle: { color: c.text, fontSize: 14, fontWeight: '600' },
  input: {
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.glassStrong,
    color: c.text,
    paddingHorizontal: space.sm,
    fontSize: 14,
  },
  card: {
    backgroundColor: c.glass,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    padding: space.md,
    gap: 4,
  },
  cardPressed: { backgroundColor: c.glassStrong },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: c.text, fontSize: 15, fontWeight: '600' },
  runningPill: {
    backgroundColor: c.blueSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  runningText: { color: c.blue, fontSize: 10.5, fontWeight: '600' },
  rootPath: { color: c.textDim, fontSize: 11.5, fontFamily: 'monospace' },
  meta: { color: c.textFaint, fontSize: 12 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: 6 },
  footnote: { color: c.textFaint, fontSize: 11.5, lineHeight: 17, paddingHorizontal: space.xs },
  });
