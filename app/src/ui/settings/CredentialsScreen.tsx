import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { store, useStore } from '../useStore';
import { Btn, IconButton, Pill } from '../parts';
import { SmoothKeyboardAvoid } from '../SmoothKeyboardAvoid';
import { colors, radius, space, topInset } from '../theme';

const REF = 'DEEPSEEK_API_KEY';

/**
 * U4 二级页：API Key（备选）。
 *
 * 从设置首页的 Key 卡搬来：展开/收起、输入、保存/更换/清除。
 * Key 写给宿主，手机不保存——本机模式下宿主就是这台手机。
 */
export function CredentialsScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const state = useStore();
  const [key, setKey] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  /** API Key 是备选方式，默认收起；账号登录是主路径 */
  const [showKey, setShowKey] = React.useState(false);

  const status = state.credentials[REF];
  const configured = status?.configured === true;

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
        <IconButton glyph="‹" label="返回设置" onPress={onClose} />
        <Text style={styles.title}>API Key（备选）</Text>
        <View style={{ width: 36 }} />
      </View>

      <SmoothKeyboardAvoid style={styles.body}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            <Pressable
              style={styles.rowTop}
              accessibilityRole="button"
              accessibilityLabel="展开或收起 API Key"
              onPress={() => setShowKey((v) => !v)}
            >
              <Text style={styles.cardTitle}>DeepSeek API Key（备选）</Text>
              <View style={styles.rowRight}>
                <Pill>
                  <Text style={[styles.status, configured && { color: colors.ok }]}>
                    {configured ? '已配置' : '未配置'}
                  </Text>
                </Pill>
                <Text style={styles.chevron}>{showKey ? '▾' : '▸'}</Text>
              </View>
            </Pressable>

            {showKey ? (
              <>
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
                    label={saved ? '已保存' : configured ? '更换' : '保存'}
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
              </>
            ) : (
              <>
                <Text style={styles.hint}>
                  {configured
                    ? '已配置。换 Key 或清除都在这里；账号登录正常时用不到它。'
                    : '没有账号授权时，也可以直接填一个 DeepSeek API Key。'}
                </Text>
                <View style={styles.actions}>
                  <Btn
                    label={configured ? '更换 API Key' : '填写 API Key'}
                    onPress={() => setShowKey(true)}
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            )}
          </View>

          {Boolean(state.error) ? (
            <Pressable onPress={() => store.clearError()}>
              <Text style={styles.error}>{state.error}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </SmoothKeyboardAvoid>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: topInset },
  body: { flex: 1 },
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
    padding: space.md,
    gap: space.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chevron: { color: colors.textFaint, fontSize: 12 },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  status: { color: colors.textFaint, fontSize: 11 },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  input: {
    backgroundColor: colors.glassStrong,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 13,
  },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: 4 },
  error: { color: colors.danger, fontSize: 12, paddingHorizontal: space.xs },
});
