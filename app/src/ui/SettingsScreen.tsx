import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { store, useStore } from './useStore';
import { Btn, IconButton, Pill } from './parts';
import { colors, radius, space, topInset } from './theme';

const REF = 'DEEPSEEK_API_KEY';

/**
 * 模型与凭据。
 * 注意：Key 写给宿主，手机不保存——本机模式下宿主就是这台手机。
 */
export function SettingsScreen(): React.ReactElement {
  const state = useStore();
  const [key, setKey] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const status = state.credentials[REF];
  const configured = status?.configured === true;
  const preset = state.caps?.presets.find((p) => p.id === state.draftPresetId) ?? state.caps?.presets[0];

  const save = async (value: string): Promise<void> => {
    const ok = await store.saveCredential(REF, value);
    if (ok) {
      setKey('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回" onPress={() => store.closeSettings()} />
        <Text style={styles.title}>模型与凭据</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.bodyWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? topInset + 48 : 0}
      >

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <View style={styles.rowTop}>
            <Text style={styles.cardTitle}>DeepSeek API Key</Text>
            <Pill>
              <Text style={[styles.status, configured && { color: colors.ok }]}>
                {configured ? '已配置' : '未配置'}
              </Text>
            </Pill>
          </View>
          <Text style={styles.hint}>
            Key 存在宿主上（连电脑时存在电脑，本机模式下存在这台手机），App 不会保存。
          </Text>

          <TextInput
            style={styles.input}
            value={key}
            onChangeText={setKey}
            placeholder={configured ? '已配置 · 粘贴新 Key 可覆盖' : 'sk-…'}
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            accessibilityLabel="API Key"
          />

          <View style={styles.actions}>
            <Btn
              label={saved ? '已保存' : '保存'}
              onPress={() => void save(key)}
              disabled={key.trim().length === 0}
              style={{ flex: 1 }}
            />
            <Btn
              label="清除"
              kind="ghost"
              onPress={() => void save('')}
              disabled={!configured}
              style={{ flex: 1 }}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>宿主</Text>
          <View style={styles.kv}>
            <Text style={styles.k}>名称</Text>
            <Text style={styles.v}>{state.caps?.host.name ?? '—'}</Text>
          </View>
          <View style={styles.kv}>
            <Text style={styles.k}>类型</Text>
            <Text style={styles.v}>{state.caps?.host.kind ?? '—'}</Text>
          </View>
          <View style={styles.kv}>
            <Text style={styles.k}>版本</Text>
            <Text style={styles.v}>{state.caps?.host.engineVersion ?? '—'}</Text>
          </View>
          <View style={styles.kv}>
            <Text style={styles.k}>当前锦囊</Text>
            <Text style={styles.v}>{preset?.name ?? '—'}</Text>
          </View>
        </View>

        <Text style={styles.footnote}>
          账号登录（OAuth）还没接。它也在宿主的流端点里，不在 HTTP 接口上。
        </Text>

        {state.error ? (
          <Pressable onPress={() => store.clearError()}>
            <Text style={styles.error}>{state.error}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: topInset },
  bodyWrap: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '700' },
  scroll: { padding: space.lg, gap: 12, paddingBottom: space.xxl },
  card: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: colors.text, fontSize: 14.5, fontWeight: '600' },
  status: { color: colors.textFaint, fontSize: 11 },
  hint: { color: colors.textFaint, fontSize: 11.5, lineHeight: 17 },
  input: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 13.5,
  },
  actions: { flexDirection: 'row', gap: 8 },
  kv: { flexDirection: 'row', justifyContent: 'space-between' },
  k: { color: colors.textFaint, fontSize: 12.5 },
  v: { color: colors.textDim, fontSize: 12.5 },
  footnote: { color: colors.textFaint, fontSize: 11, lineHeight: 17, marginTop: 4 },
  error: { color: colors.danger, fontSize: 12, marginTop: 8 },
});
