import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { humanizeError } from '../lib/errors';
import type { ProviderModel, ProviderProtocol, ProviderRow } from '../protocol';
import { Btn, Pill } from './parts';
import { colors, font, radius, space } from './theme';
import { store, useStore } from './useStore';

/** 线协议 → 人话，和 dsh 官方模型页一致 */
const PROTOCOLS: Array<{ id: ProviderProtocol; label: string; hint: string }> = [
  { id: 'openai-completions', label: 'OpenAI 兼容', hint: '大多数网关 / 自建服务' },
  { id: 'openai-responses', label: 'OpenAI Responses', hint: 'OpenAI 新接口' },
  { id: 'anthropic-messages', label: 'Anthropic', hint: 'Claude 协议' },
];

type Tab = 'catalog' | 'custom';

interface Draft {
  mode: Tab;
  /** 路由 id，例如 openrouter */
  id: string;
  displayName: string;
  baseURL: string;
  api: ProviderProtocol;
  apiKey: string;
  models: ProviderModel[];
  picked: Record<string, boolean>;
  editing: boolean;
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const idx = message.indexOf('->');
  return humanizeError(idx >= 0 ? new Error(message.slice(idx + 2)) : err).slice(0, 240);
}

/**
 * 模型提供商。
 *
 * 和 dsh 官方「设置 › 模型 › 添加模型提供商」一个结构：
 * - 第三方模型提供商：从内置目录选（下拉），只填 Key；
 * - 自定义模型 API：自己填协议 + Base URL + Key，再拉模型勾选。
 */
export function ProvidersCard(): React.ReactElement {
  const state = useStore();
  const [tab, setTab] = React.useState<Tab>('catalog');
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState<'discover' | 'save' | 'remove' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    if (!state.caps) return;
    void store.refreshProviders();
    void store.refreshProviderCatalog();
  }, [state.caps]);

  const catalog = state.providerCatalog;
  const selected = draft ? catalog.find((c) => c.id === draft.id) : undefined;
  const light = state.engineKind === 'light';

  const openNew = (mode: Tab): void => {
    setError(null);
    setTab(mode);
    setDraft({
      mode,
      id: '',
      displayName: '',
      baseURL: '',
      api: 'openai-completions',
      apiKey: '',
      models: [],
      picked: {},
      editing: false,
    });
  };

  const openEdit = (p: ProviderRow): void => {
    setError(null);
    setTab(p.source);
    setDraft({
      mode: p.source,
      id: p.id,
      displayName: p.displayName === p.id ? '' : p.displayName,
      baseURL: p.baseURL,
      api: (p.api as ProviderProtocol) ?? 'openai-completions',
      apiKey: '',
      models: p.models,
      picked: Object.fromEntries(p.models.map((m) => [m.id, true])),
      editing: true,
    });
  };

  const patch = (next: Partial<Draft>): void => {
    setDraft((d) => (d ? { ...d, ...next } : d));
  };

  const discover = async (): Promise<void> => {
    if (!draft) return;
    setBusy('discover');
    setError(null);
    try {
      const models = await store.discoverProviderModels({
        baseURL: draft.baseURL.trim(),
        api: draft.api,
        ...(draft.apiKey.trim().length > 0 ? { apiKey: draft.apiKey.trim() } : {}),
      });
      // 服务商目录可能不再列出当前模型（账号目录现在只有 flash/pro），
      // 同域名下把它留在候选里并勾上，避免用户只是点了「获取模型」再保存就被换模型。
      const row = state.providers.find((item) => item.id === draft.id);
      const sameBase =
        row !== undefined &&
        row.baseURL.trim().replace(/\/+$/, '') === draft.baseURL.trim().replace(/\/+$/, '');
      const current = sameBase ? row.models[0] : undefined;
      const merged = current && !models.some((model) => model.id === current.id)
        ? [current, ...models]
        : models;
      patch({ models: merged, picked: Object.fromEntries(merged.map((m) => [m.id, true])) });
      if (merged.length === 0) setError('服务商没有返回模型，可以检查 Base URL 或换个协议');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const save = async (): Promise<void> => {
    if (!draft) return;
    if (light && draft.mode === 'catalog') {
      return setError('轻引擎只有一条自定义模型渠道；第三方目录请切完整引擎配置');
    }
    if (draft.id.trim().length === 0) return setError(draft.mode === 'catalog' ? '先选一个提供商' : '先填一个渠道 ID，例如 openrouter');
    if (!draft.editing && draft.apiKey.trim().length === 0) return setError('先填 API Key');

    setBusy('save');
    setError(null);
    try {
      if (draft.mode === 'catalog') {
        await store.saveProvider({
          mode: 'catalog',
          id: draft.id.trim(),
          apiKey: draft.apiKey.trim(),
          ...(draft.baseURL.trim().length > 0 ? { baseURL: draft.baseURL.trim() } : {}),
        });
      } else {
        const picked = draft.models.filter((m) => draft.picked[m.id]);
        if (draft.baseURL.trim().length === 0) return setError('先填 Base URL');
        if (picked.length === 0) return setError('至少勾选一个模型');
        await store.saveProvider({
          mode: 'custom',
          id: draft.id.trim(),
          ...(draft.displayName.trim().length > 0 ? { displayName: draft.displayName.trim() } : {}),
          baseURL: draft.baseURL.trim(),
          api: draft.api,
          models: picked,
          ...(draft.apiKey.trim().length > 0 ? { apiKey: draft.apiKey.trim() } : {}),
        });
      }
      setDraft(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (row: ProviderRow): Promise<void> => {
    setBusy('remove');
    setError(null);
    try {
      await store.removeProvider(row.id);
    } finally {
      setBusy(null);
    }
  };

  const filteredCatalog = catalog.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return c.id.toLowerCase().includes(q) || c.displayName.toLowerCase().includes(q);
  });

  return (
    <View style={styles.card}>
      <View style={styles.rowTop}>
        <Text style={styles.cardTitle}>模型提供商</Text>
        <Pill>
          <Text style={styles.status}>{state.providers.length} 个</Text>
        </Pill>
      </View>
      <Text style={styles.hint}>
        {light
          ? '轻引擎只有一条模型渠道：点「编辑」改 Base URL / Key，账号模式会自动复用登录 token；「获取模型」走 OpenAI 兼容的 /models。'
          : '除 DeepSeek 外的模型都从这里加：第三方提供商选目录，自定义 API 自己填协议和地址。'}
      </Text>

      {state.providers.map((p) => (
        <View key={p.id} style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.rowName}>
              {p.displayName}
              <Text style={styles.rowBadge}>{p.source === 'catalog' ? ' · 目录' : ' · 自定义'}</Text>
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {p.baseURL || '内置地址'}
              {p.models.length > 0 ? ` · ${p.models.length} 个模型` : ' · 适配器默认模型'}
              {p.configured ? '' : ' · 缺 Key'}
            </Text>
          </View>
          <View style={styles.rowActions}>
            <Pressable accessibilityRole="button" onPress={() => openEdit(p)}>
              <Text style={styles.rowAction}>编辑</Text>
            </Pressable>
            {light ? null : (
              <Pressable accessibilityRole="button" onPress={() => void remove(p)} disabled={busy !== null}>
                <Text style={[styles.rowAction, styles.danger]}>删除</Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}

      {draft ? (
        <View style={styles.form}>
          {light ? null : (
          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, draft.mode === 'catalog' && styles.tabActive]}
              onPress={() => patch({ mode: 'catalog' })}
              disabled={draft.editing}
            >
              <Text style={[styles.tabText, draft.mode === 'catalog' && styles.tabTextActive]}>
                第三方模型提供商
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, draft.mode === 'custom' && styles.tabActive]}
              onPress={() => patch({ mode: 'custom' })}
              disabled={draft.editing}
            >
              <Text style={[styles.tabText, draft.mode === 'custom' && styles.tabTextActive]}>
                自定义模型 API
              </Text>
            </Pressable>
          </View>
          )}

          {draft.mode === 'catalog' ? (
            <>
              <Text style={styles.tiny}>从内置目录里选择，填入它的 API 密钥即可使用。</Text>
              <Text style={styles.label}>提供商</Text>
              <View style={styles.selectRow}>
                <Text style={selected ? styles.selectText : styles.selectPlaceholder}>
                  {selected?.displayName ?? (draft.id || '还没选')}
                </Text>
                <Btn
                  label={pickerOpen ? '收起列表' : draft.id ? '更换' : '选择'}
                  kind="ghost"
                  onPress={() => {
                    if (draft.editing) return;
                    setQuery('');
                    setPickerOpen((v) => !v);
                  }}
                />
              </View>
              {selected?.defaultBaseURL ? (
                <Text style={styles.tiny}>默认地址：{selected.defaultBaseURL}</Text>
              ) : null}
            {pickerOpen && draft && draft.mode === 'catalog' ? (
              <View style={styles.pickerCard}>
                <View style={styles.rowTop}>
                  <Text style={styles.pickerTitle}>选择提供商</Text>
                  <Pressable accessibilityRole="button" onPress={() => setPickerOpen(false)}>
                    <Text style={styles.rowAction}>收起</Text>
                  </Pressable>
                </View>
                <TextInput
                  style={styles.input}
                  value={query}
                  onChangeText={setQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="搜索 openai / anthropic / openrouter…"
                  placeholderTextColor={colors.textFaint}
                />
                <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
                  {filteredCatalog.map((c) => (
                    <Pressable
                      key={c.id}
                      style={styles.pickerRow}
                      onPress={() => {
                        patch({ id: c.id, baseURL: c.defaultBaseURL ?? '' });
                        setPickerOpen(false);
                      }}
                    >
                      <Text style={styles.pickerName}>{c.displayName}</Text>
                      <Text style={styles.pickerMeta} numberOfLines={1}>
                        {c.defaultBaseURL ?? '使用环境变量 / 内置地址'}
                      </Text>
                    </Pressable>
                  ))}
                  {filteredCatalog.length === 0 ? <Text style={styles.tiny}>没找到，换个关键词。</Text> : null}
                </ScrollView>
              </View>
            ) : null}
            </>
          ) : (
            <>
              <Text style={styles.label}>渠道 ID</Text>
              <TextInput
                style={[styles.input, draft.editing && styles.inputDisabled]}
                value={draft.id}
                onChangeText={(t) => patch({ id: t })}
                editable={!draft.editing}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="openrouter"
                placeholderTextColor={colors.textFaint}
              />
              <Text style={styles.label}>显示名（可选）</Text>
              <TextInput
                style={styles.input}
                value={draft.displayName}
                onChangeText={(t) => patch({ displayName: t })}
                autoCapitalize="none"
                placeholder="留空就用渠道 ID"
                placeholderTextColor={colors.textFaint}
              />
              <Text style={styles.label}>协议</Text>
              <View style={styles.pills}>
                {PROTOCOLS.map((p) => {
                  const active = draft.api === p.id;
                  return (
                    <Pressable
                      key={p.id}
                      accessibilityRole="button"
                      onPress={() => patch({ api: p.id })}
                      style={[styles.pill, active && styles.pillActive]}
                    >
                      <Text style={[styles.pillText, active && styles.pillTextActive]}>{p.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.tiny}>{PROTOCOLS.find((p) => p.id === draft.api)?.hint}</Text>
            </>
          )}

          <Text style={styles.label}>API Key</Text>
          <TextInput
            style={styles.input}
            value={draft.apiKey}
            onChangeText={(t) => patch({ apiKey: t })}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder={draft.editing ? '留空保留原来的 Key' : 'sk-…'}
            placeholderTextColor={colors.textFaint}
          />

          <Text style={styles.label}>API 地址{draft.mode === 'catalog' ? '（可选）' : ''}</Text>
          <TextInput
            style={styles.input}
            value={draft.baseURL}
            onChangeText={(t) => patch({ baseURL: t })}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder={selected?.defaultBaseURL ?? 'https://openrouter.ai/api/v1'}
            placeholderTextColor={colors.textFaint}
          />

          {draft.mode === 'custom' ? (
            <>
              <View style={styles.actions}>
                <Btn
                  label={busy === 'discover' ? '获取中…' : '获取模型'}
                  kind="ghost"
                  onPress={() => void discover()}
                  disabled={busy !== null || draft.baseURL.trim().length === 0}
                  style={{ flex: 1 }}
                />
                <Btn label="取消" kind="ghost" onPress={() => setDraft(null)} style={{ flex: 1 }} />
              </View>

              {draft.models.length > 0 ? (
                <View style={styles.modelBox}>
                  <Text style={styles.tiny}>
                    勾选要启用的模型（{draft.models.filter((m) => draft.picked[m.id]).length}/{draft.models.length}）
                  </Text>
                  {draft.models.map((m) => {
                    const on = draft.picked[m.id] === true;
                    return (
                      <Pressable
                        key={m.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        onPress={() => patch({ picked: { ...draft.picked, [m.id]: !on } })}
                        style={styles.modelRow}
                      >
                        <Text style={[styles.check, on && styles.checkOn]}>{on ? '✓' : '○'}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.modelName} numberOfLines={1}>
                            {m.name ?? m.id}
                          </Text>
                          <Text style={styles.modelMeta} numberOfLines={1}>
                            {m.id}
                            {m.contextWindow ? ` · ${Math.round(m.contextWindow / 1024)}K` : ''}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.actions}>
              <Btn label="取消" kind="ghost" onPress={() => setDraft(null)} style={{ flex: 1 }} />
            </View>
          )}

          <Btn
            label={busy === 'save' ? '保存中…' : draft.editing ? '保存修改' : '保存提供商'}
            onPress={() => void save()}
            disabled={busy !== null}
          />
        </View>
      ) : light ? null : (
        <View style={styles.actions}>
          <Btn label="添加模型提供商" onPress={() => openNew('catalog')} style={{ flex: 1 }} />
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  status: { color: colors.textFaint, fontSize: 11 },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowMain: { flex: 1, gap: 2 },
  rowName: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  rowBadge: { color: colors.textFaint, fontSize: 10.5, fontWeight: '400' },
  rowMeta: { color: colors.textFaint, fontSize: 11 },
  rowActions: { flexDirection: 'row', gap: 14 },
  rowAction: { color: colors.blue, fontSize: 12.5 },
  danger: { color: colors.danger },

  form: { gap: 6, marginTop: 4 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.glassStrong,
    borderRadius: 999,
    padding: 3,
    marginBottom: 4,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 999 },
  tabActive: { backgroundColor: colors.bg },
  tabText: { color: colors.textDim, fontSize: 12 },
  tabTextActive: { color: colors.text, fontWeight: '600' },

  label: { color: colors.textDim, fontSize: 12, marginTop: 4 },
  input: {
    backgroundColor: colors.glassStrong,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: colors.text,
    fontSize: 13,
  },
  inputDisabled: { opacity: 0.55 },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.glassStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  selectText: { color: colors.text, fontSize: 13 },
  selectPlaceholder: { color: colors.textFaint, fontSize: 13 },
  chevron: { color: colors.textFaint, fontSize: 12 },

  pills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: colors.glassStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.blueSoft, borderColor: colors.blue },
  pillText: { color: colors.textDim, fontSize: 12 },
  pillTextActive: { color: colors.blue, fontWeight: '600' },
  tiny: { color: colors.textFaint, fontSize: 11 },

  modelBox: { gap: 2, marginTop: 4 },
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  check: { color: colors.textFaint, fontSize: 14, width: 16, textAlign: 'center' },
  checkOn: { color: colors.blue },
  modelName: { color: colors.text, fontSize: 13 },
  modelMeta: { color: colors.textFaint, fontSize: 10.5, fontFamily: font.mono },

  actions: { flexDirection: 'row', gap: space.sm, marginTop: 4 },
  error: { color: colors.danger, fontSize: 11.5, lineHeight: 16 },

  pickerCard: {
    marginTop: 4,
    padding: 10,
    gap: 6,
    borderRadius: radius.md,
    backgroundColor: colors.glassStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  pickerTitle: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  pickerList: { maxHeight: 260 },
  pickerRow: {
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickerName: { color: colors.text, fontSize: 13.5 },
  pickerMeta: { color: colors.textFaint, fontSize: 10.5, marginTop: 1 },
});
