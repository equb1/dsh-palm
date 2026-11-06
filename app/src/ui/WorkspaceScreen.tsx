import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { store, useStore } from './useStore';
import { Btn, IconButton } from './parts';
import { colors, radius, space, topInset } from './theme';

/**
 * U8 工作区页（只读概览 + 文件入口）。
 *
 * 轻引擎只有固定的 `/workspace`；完整引擎会报多个工作区。多工作区创建/置顶/分组
 * 还没接（M2），这里先把宿主报告的工作区、会话数、锦囊数列出来，并给文件面板入口。
 */
export function WorkspaceScreen(): React.ReactElement {
  const state = useStore();
  const rows = store.sessionRows();
  const workspaces = state.workspaces;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回" onPress={() => store.closeWorkspace()} />
        <Text style={styles.title}>工作区</Text>
        <IconButton glyph="▤" label="打开文件" onPress={() => store.openFiles()} size={32} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
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
  hint: { color: colors.textFaint, fontSize: 12.5, lineHeight: 18 },
  card: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: 4,
  },
  cardPressed: { backgroundColor: colors.glassStrong },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  runningPill: {
    backgroundColor: colors.blueSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  runningText: { color: colors.blue, fontSize: 10.5, fontWeight: '600' },
  rootPath: { color: colors.textDim, fontSize: 11.5, fontFamily: 'monospace' },
  meta: { color: colors.textFaint, fontSize: 12 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: 6 },
  footnote: { color: colors.textFaint, fontSize: 11.5, lineHeight: 17, paddingHorizontal: space.xs },
});
