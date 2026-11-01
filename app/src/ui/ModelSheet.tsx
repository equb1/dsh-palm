import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ModelChoice, ModelOption } from '../protocol';
import { store, useStore } from './useStore';
import { colors, font, radius } from './theme';

/**
 * 模型选择面板。
 *
 * 交互：
 * - 点模型直接切（用它的默认思考档）
 * - 有多个思考档的模型，先展开档位再点一次
 * - 当前模型打勾
 */
export function ModelSheet(): React.ReactElement {
  const state = useStore();
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const current = state.detail?.model ?? state.defaultModel;
  const key = (m: { provider: string; id?: string; model?: string }): string =>
    m.provider + '/' + (m.id ?? m.model ?? '');

  const pick = (model: ModelOption, effort?: string): void => {
    void store.setModel(model.provider, model.id, effort ?? model.defaultEffort);
  };

  return (
    <Modal visible={state.modelSheetOpen} transparent animationType="slide" onRequestClose={() => store.closeModelSheet()}>
      <Pressable style={styles.backdrop} onPress={() => store.closeModelSheet()}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.head}>
            <Text style={styles.title}>会话设置</Text>
            <Pressable accessibilityRole="button" onPress={() => store.closeModelSheet()} style={styles.close}>
              <Text style={styles.closeText}>完成</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {state.permissions.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>权限</Text>
                <View style={styles.permRow}>
                  {state.permissions.map((option) => {
                    const active = (state.detail?.permission ?? state.defaultPermission) === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="button"
                        onPress={() => void store.setPermission(option.value)}
                        style={({ pressed }) => [styles.perm, active && styles.permActive, pressed && styles.rowPressed]}
                      >
                        <Text style={[styles.permText, active && styles.permTextActive]}>{option.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.sectionHint}>
                  只读只能看；工作区可写只改当前目录；完全放行不再弹审批
                </Text>
              </View>
            ) : null}

            {state.workspaces.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>工作区</Text>
                {state.workspaces.map((ws) => (
                  <Pressable
                    key={ws.id}
                    accessibilityRole="button"
                    onPress={() => {
                      store.closeModelSheet();
                      void store.createSession(state.detail?.presetId ?? 'standard', ws.id);
                    }}
                    style={({ pressed }) => [styles.wsRow, pressed && styles.rowPressed]}
                  >
                    <Text style={styles.wsName}>{ws.name}</Text>
                    <Text style={styles.wsPath} numberOfLines={1}>
                      {ws.root}
                    </Text>
                  </Pressable>
                ))}
                <Text style={styles.sectionHint}>点一个工作区，就在那里新建会话</Text>
              </View>
            ) : null}
            <Text style={styles.sectionTitle}>模型</Text>
            {state.models.length === 0 ? (
              <Text style={styles.empty}>宿主没有报告可用模型</Text>
            ) : null}

            {state.models.map((model) => {
              const isCurrent = current?.provider === model.provider && current?.model === model.id;
              const isOpen = expanded === key(model);
              const efforts = model.efforts ?? [];
              return (
                <View key={key(model)}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      if (efforts.length > 1) setExpanded(isOpen ? null : key(model));
                      else pick(model);
                    }}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  >
                    <View style={styles.rowMain}>
                      <View style={styles.rowHead}>
                        <Text style={styles.modelName}>{model.name}</Text>
                        {isCurrent ? <Text style={styles.badge}>当前</Text> : null}
                      </View>
                      <Text style={styles.modelMeta}>
                        {model.providerName}
                        {model.description ? ' · ' + model.description : ''}
                      </Text>
                    </View>
                    {efforts.length > 1 ? (
                      <Text style={styles.chevron}>{isOpen ? '▴' : '▾'}</Text>
                    ) : null}
                  </Pressable>

                  {isOpen ? (
                    <View style={styles.efforts}>
                      {efforts.map((effort) => {
                        const active = isCurrent && (current?.reasoningEffort ?? model.defaultEffort) === effort.id;
                        return (
                          <Pressable
                            key={effort.id}
                            accessibilityRole="button"
                            onPress={() => {
                              setExpanded(null);
                              pick(model, effort.id);
                            }}
                            style={({ pressed }) => [styles.effort, active && styles.effortActive, pressed && styles.rowPressed]}
                          >
                            <Text style={[styles.effortName, active && styles.effortNameActive]}>{effort.name}</Text>
                            {effort.description ? <Text style={styles.effortDesc}>{effort.description}</Text> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          <Text style={styles.foot}>模型选择写进会话本身，换设备打开还是它</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    maxHeight: '78%',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  close: { paddingHorizontal: 8, paddingVertical: 4 },
  closeText: { color: colors.blue, fontSize: 14 },
  list: { maxHeight: 460 },
  listContent: { paddingHorizontal: 12, paddingBottom: 8, gap: 4 },
  empty: { color: colors.textFaint, fontSize: 13, padding: 12 },
  section: { gap: 8, paddingBottom: 8 },
  sectionTitle: { color: colors.textDim, fontSize: 12, paddingHorizontal: 12, paddingTop: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  rowPressed: { backgroundColor: colors.glassPressed },
  rowMain: { flex: 1, gap: 3 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modelName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  badge: {
    color: colors.blue,
    fontSize: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.blue,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  modelMeta: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  chevron: { color: colors.textFaint, fontSize: 12 },
  permRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12 },
  perm: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  permActive: { borderColor: colors.blue, backgroundColor: 'rgba(90,150,255,0.12)' },
  permText: { color: colors.textDim, fontSize: 12.5 },
  permTextActive: { color: colors.text, fontWeight: '600' },
  wsRow: { paddingHorizontal: 12, paddingVertical: 10, gap: 2, borderRadius: radius.md },
  wsName: { color: colors.text, fontSize: 14 },
  wsPath: { color: colors.textFaint, fontSize: 11.5, fontFamily: font.mono },
  sectionHint: { color: colors.textFaint, fontSize: 10.5, lineHeight: 15, paddingHorizontal: 12 },
  efforts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: 12, paddingRight: 12, paddingBottom: 10 },
  effort: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 2,
    maxWidth: 160,
  },
  effortActive: { borderColor: colors.blue, backgroundColor: 'rgba(90,150,255,0.12)' },
  effortName: { color: colors.textDim, fontSize: 12.5 },
  effortNameActive: { color: colors.text, fontWeight: '600' },
  effortDesc: { color: colors.textFaint, fontSize: 10.5, lineHeight: 14 },
  foot: {
    color: colors.textFaint,
    fontSize: 11,
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: 6,
    fontFamily: font.mono,
  },
});
