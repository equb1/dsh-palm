import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ModelChoice, ModelOption } from '../protocol';
import { store, useStore } from './useStore';
import { colors, font, radius, semantic, typography } from './theme';

interface ModelGroup {
  provider: string;
  providerName: string;
  models: ModelOption[];
}

/**
 * 模型选择面板。
 *
 * 交互（保持不变）：
 * - 点模型直接切（用它的默认思考档）
 * - 有多个思考档的模型，先展开档位再点一次
 * - 当前模型打勾
 *
 * A6 视觉：按提供商分组、默认标记、搜索框、未配置提供商置灰。
 */
export function ModelSheet(): React.ReactElement {
  const state = useStore();
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');

  const current = state.detail?.model ?? state.defaultModel;
  const key = (m: { provider: string; id?: string; model?: string }): string =>
    m.provider + '/' + (m.id ?? m.model ?? '');

  const pick = (model: ModelOption, effort?: string): void => {
    void store.setModel(model.provider, model.id, effort ?? model.defaultEffort);
  };

  const configured = React.useMemo(
    () => new Set(state.providers.filter((p) => p.configured).map((p) => p.id)),
    [state.providers]
  );

  const groups = React.useMemo<ModelGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, ModelGroup>();
    for (const model of state.models) {
      if (q && !`${model.name} ${model.providerName} ${model.description ?? ''}`.toLowerCase().includes(q)) {
        continue;
      }
      const group = map.get(model.provider);
      if (group) group.models.push(model);
      else map.set(model.provider, { provider: model.provider, providerName: model.providerName, models: [model] });
    }
    return [...map.values()];
  }, [state.models, query]);

  const isCurrent = (model: ModelOption): boolean =>
    current?.provider === model.provider && current?.model === model.id;
  const isDefault = (model: ModelOption): boolean =>
    state.defaultModel?.provider === model.provider && state.defaultModel?.model === model.id;
  const isDisabled = (model: ModelOption): boolean =>
    state.providers.length > 0 && !configured.has(model.provider);

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

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
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
            ) : (
              <>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="搜索模型或提供商"
                  placeholderTextColor={colors.textFaint}
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
                      const active = isCurrent(model);
                      const isOpen = expanded === key(model);
                      const efforts = model.efforts ?? [];
                      const disabled = isDisabled(model);
                      return (
                        <View key={key(model)}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ selected: active, disabled }}
                            disabled={disabled}
                            onPress={() => {
                              if (efforts.length > 1) setExpanded(isOpen ? null : key(model));
                              else pick(model);
                            }}
                            style={({ pressed }) => [
                              styles.row,
                              disabled && styles.rowDisabled,
                              pressed && !disabled && styles.rowPressed,
                            ]}
                          >
                            <View style={styles.rowMain}>
                              <View style={styles.rowHead}>
                                <Text style={[styles.modelName, disabled && styles.textDisabled]}>{model.name}</Text>
                                {active ? <Text style={styles.badge}>当前</Text> : null}
                                {!active && isDefault(model) ? <Text style={styles.defaultBadge}>默认</Text> : null}
                                {disabled ? <Text style={styles.disabledTag}>未配置</Text> : null}
                              </View>
                              <Text style={[styles.modelMeta, disabled && styles.textDisabled]}>
                                {model.providerName}
                                {model.description ? ' · ' + model.description : ''}
                              </Text>
                            </View>
                            {efforts.length > 1 ? (
                              <Text style={[styles.chevron, disabled && styles.textDisabled]}>{isOpen ? '▴' : '▾'}</Text>
                            ) : null}
                          </Pressable>

                          {isOpen && !disabled ? (
                            <View style={styles.efforts}>
                              {efforts.map((effort) => {
                                const effortActive =
                                  active && (current?.reasoningEffort ?? model.defaultEffort) === effort.id;
                                return (
                                  <Pressable
                                    key={effort.id}
                                    accessibilityRole="button"
                                    onPress={() => {
                                      setExpanded(null);
                                      pick(model, effort.id);
                                    }}
                                    style={({ pressed }) => [
                                      styles.effort,
                                      effortActive && styles.effortActive,
                                      pressed && styles.rowPressed,
                                    ]}
                                  >
                                    <Text style={[styles.effortName, effortActive && styles.effortNameActive]}>
                                      {effort.name}
                                    </Text>
                                    {effort.description ? (
                                      <Text style={styles.effortDesc}>{effort.description}</Text>
                                    ) : null}
                                  </Pressable>
                                );
                              })}
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </>
            )}
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
  title: { ...typography.heading, color: colors.text },
  close: { paddingHorizontal: 8, paddingVertical: 4 },
  closeText: { color: colors.blue, fontSize: 14 },
  list: { maxHeight: 460 },
  listContent: { paddingHorizontal: 12, paddingBottom: 8, gap: 4 },
  empty: { color: colors.textFaint, fontSize: 13, padding: 12 },
  section: { gap: 8, paddingBottom: 8 },
  sectionTitle: {
    ...typography.caption,
    color: colors.textDim,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  search: {
    ...typography.bodySmall,
    color: colors.text,
    backgroundColor: semantic.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: semantic.border,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginHorizontal: 12,
    marginBottom: 4,
  },
  groupTitle: {
    ...typography.meta,
    color: colors.textFaint,
    fontWeight: '600',
    letterSpacing: 0.3,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  rowDisabled: { opacity: 0.45 },
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
  defaultBadge: {
    color: colors.textFaint,
    fontSize: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  disabledTag: {
    color: colors.warn,
    fontSize: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warn,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  textDisabled: { color: colors.textFaint },
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
