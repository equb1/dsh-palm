import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheet } from './components/BottomSheet';

import type { ModelChoice, ModelOption } from '../protocol';
import { store, useStore } from './useStore';
import { radius, typography, useTheme, useThemedStyles, type Theme } from './theme';

interface ModelGroup {
  provider: string;
  providerName: string;
  models: ModelOption[];
}

/**
 * 模型选择面板：只做两件事——选模型、选推理等级。
 * 权限在工作区/权限入口，工作区在抽屉，这里不再重复。
 */
export function ModelSheet(): React.ReactElement {
  const state = useStore();
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [query, setQuery] = React.useState('');
  const current = state.detail?.model ?? state.defaultModel;
  const [selected, setSelected] = React.useState<ModelChoice | null>(current ?? null);

  React.useEffect(() => {
    if (state.modelSheetOpen) setSelected(current ?? null);
    // 打开面板时同步当前选择，面板内切换不改外部状态直到点确定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.modelSheetOpen]);

  const key = (m: { provider: string; id?: string; model?: string }): string =>
    m.provider + '/' + (m.id ?? m.model ?? '');

  const selectedModel = state.models.find(
    (m) => m.provider === selected?.provider && m.id === selected?.model
  );
  const efforts = selectedModel?.efforts ?? [];

  const pickModel = (model: ModelOption): void => {
    if ((model.efforts?.length ?? 0) <= 1) {
      void store.setModel(model.provider, model.id, model.defaultEffort);
      return;
    }
    setSelected({
      provider: model.provider,
      model: model.id,
      reasoningEffort: model.defaultEffort,
    });
  };

  const pickEffort = (effortId: string): void => {
    if (!selected) return;
    void store.setModel(selected.provider, selected.model, effortId);
  };

  const groups = React.useMemo<ModelGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, ModelGroup>();
    for (const model of state.models) {
      if (q && !`${model.name} ${model.providerName}`.toLowerCase().includes(q)) continue;
      const group = map.get(model.provider);
      if (group) group.models.push(model);
      else map.set(model.provider, { provider: model.provider, providerName: model.providerName, models: [model] });
    }
    return [...map.values()];
  }, [state.models, query]);

  const isSelected = (model: ModelOption): boolean =>
    selected?.provider === model.provider && selected?.model === model.id;

  return (
    <BottomSheet
      visible={state.modelSheetOpen}
      onClose={() => store.closeModelSheet()}
      sheetStyle={styles.sheet}
    >
          <View style={styles.head}>
            <Text style={styles.title}>模型</Text>
            <Pressable accessibilityRole="button" onPress={() => store.closeModelSheet()} style={styles.close}>
              <Text style={styles.closeText}>完成</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {state.models.length === 0 ? (
              <Text style={styles.empty}>宿主没有报告可用模型</Text>
            ) : (
              <>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="搜索模型"
                  placeholderTextColor={palette.textFaint}
                  autoCorrect={false}
                  autoCapitalize="none"
                  style={styles.search}
                  accessibilityLabel="搜索模型"
                />
                {groups.length === 0 ? <Text style={styles.empty}>没有匹配的模型</Text> : null}
                {groups.map((group) => (
                  <View key={group.provider}>
                    <Text style={styles.groupTitle}>{group.providerName}</Text>
                    {group.models.map((model) => {
                      const active = isSelected(model);
                      return (
                        <Pressable
                          key={key(model)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          onPress={() => pickModel(model)}
                          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                        >
                          <Text style={styles.modelName} numberOfLines={1}>
                            {model.name}
                          </Text>
                          {active ? <Text style={styles.check}>✓</Text> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}

                {efforts.length > 0 ? (
                  <View style={styles.effortSection}>
                    <Text style={styles.effortTitle}>推理等级</Text>
                    <View style={styles.effortRow}>
                      {efforts.map((effort) => {
                        const active =
                          (selected?.reasoningEffort ?? selectedModel?.defaultEffort) === effort.id;
                        return (
                          <Pressable
                            key={effort.id}
                            accessibilityRole="button"
                            accessibilityLabel={effort.name}
                            onPress={() => pickEffort(effort.id)}
                            style={({ pressed }) => [
                              styles.effort,
                              active && styles.effortActive,
                              pressed && { opacity: 0.75 },
                            ]}
                          >
                            <Text style={[styles.effortText, active && styles.effortTextActive]}>
                              {effort.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>
    </BottomSheet>
  );
}

const createStyles = ({ palette: c, semantic: s }: Theme) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: c.backdrop, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: c.bg,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      maxHeight: '72%',
      paddingBottom: 12,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingTop: 16,
      paddingBottom: 8,
    },
    title: { ...typography.heading, color: c.text },
    close: { paddingHorizontal: 8, paddingVertical: 4 },
    closeText: { color: c.blue, fontSize: 14 },
    list: { maxHeight: 520 },
    listContent: { paddingHorizontal: 12, paddingBottom: 8 },
    empty: { color: c.textFaint, fontSize: 13, padding: 12 },
    search: {
      ...typography.bodySmall,
      color: c.text,
      backgroundColor: c.glassStrong,
      borderRadius: radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginHorizontal: 6,
      marginBottom: 6,
    },
    groupTitle: {
      ...typography.meta,
      color: c.textFaint,
      fontWeight: '500',
      paddingHorizontal: 8,
      paddingTop: 8,
      paddingBottom: 2,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 46,
      paddingHorizontal: 10,
      borderRadius: radius.sm,
    },
    rowPressed: { backgroundColor: s.sidebarHover },
    modelName: { flex: 1, color: c.text, fontSize: 15, fontWeight: '500' },
    check: { color: c.blue, fontSize: 15, fontWeight: '700' },
    effortSection: {
      marginTop: 10,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingHorizontal: 6,
      gap: 8,
    },
    effortTitle: { color: c.textDim, fontSize: 13, fontWeight: '500' },
    effortRow: {
      flexDirection: 'row',
      gap: 4,
      padding: 3,
      borderRadius: radius.sm,
      backgroundColor: c.glassStrong,
    },
    effort: {
      flex: 1,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.xs,
    },
    effortActive: { backgroundColor: c.bg },
    effortText: { color: c.textDim, fontSize: 13 },
    effortTextActive: { color: c.text, fontWeight: '600' },
  });
