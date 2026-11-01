import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { store, useStore } from './useStore';
import { Btn, IconButton, Pill } from './parts';
import { SmoothKeyboardAvoid } from './SmoothKeyboardAvoid';
import { colors, font, radius, space, topInset } from './theme';
import { hostAvailable } from '../lib/host';

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

  // 本机引擎状态：进设置页就每 2 秒拉一次
  const host = state.host;
  const hostReady = host?.engine === 'ready' && host?.bridge === 'ready';
  const hostLabel = !hostAvailable
    ? '不支持'
    : hostReady
      ? '运行中'
      : host?.engine === 'failed' || host?.bridge === 'failed'
        ? '出错'
        : host?.engine === 'starting'
          ? '启动中'
          : '已停止';

  React.useEffect(() => {
    if (!hostAvailable) return;
    void store.refreshHost();
    void store.loadHostCommands();
    const timer = setInterval(() => void store.refreshHost(), 2000);
    return () => clearInterval(timer);
  }, []);

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

      <SmoothKeyboardAvoid style={styles.bodyWrap}>
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
            <View style={styles.rowTop}>
              <Text style={styles.cardTitle}>本机引擎</Text>
              <Pill>
                <Text style={[styles.status, hostReady && { color: colors.ok }]}>{hostLabel}</Text>
              </Pill>
            </View>
            <Text style={styles.hint}>
              在这台手机上直接起引擎（原生服务）。启动后 App 连 ws://127.0.0.1:8788/ws 就是本机模式。
            </Text>

            {hostAvailable ? (
              <>
                <View style={styles.kv}>
                  <Text style={styles.k}>引擎</Text>
                  <Text style={styles.v}>{state.host?.engine ?? 'stopped'}</Text>
                </View>
                <View style={styles.kv}>
                  <Text style={styles.k}>桥</Text>
                  <Text style={styles.v}>
                    {(state.host?.bridge ?? 'stopped') + ' · :' + String(state.host?.port ?? 8788)}
                  </Text>
                </View>
                {state.host?.error ? <Text style={styles.error}>{state.host.error}</Text> : null}

                <View style={styles.actions}>
                  <Btn label="启动" onPress={() => void store.startLocalHost()} style={{ flex: 1 }} />
                  <Btn
                    label="停止"
                    kind="ghost"
                    onPress={() => void store.stopLocalHost()}
                    style={{ flex: 1 }}
                  />
                </View>

                <Text style={styles.hint}>启动命令（留空用默认：proot 里的 dsh + node 桥）</Text>
                <TextInput
                  style={styles.input}
                  value={state.hostEngineCmd}
                  onChangeText={(t) => store.setHostCommands(t, state.hostBridgeCmd)}
                  placeholder="引擎命令，例如 sh /data/local/tmp/engine.sh"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="引擎启动命令"
                />
                <TextInput
                  style={styles.input}
                  value={state.hostBridgeCmd}
                  onChangeText={(t) => store.setHostCommands(state.hostEngineCmd, t)}
                  placeholder="桥命令，可用 {token} 和 {port} 占位符"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="桥启动命令"
                />
                <View style={styles.actions}>
                  <Btn
                    label="刷新状态"
                    kind="ghost"
                    onPress={() => void store.refreshHost()}
                    style={{ flex: 1 }}
                  />
                  <Btn
                    label="看日志"
                    kind="ghost"
                    onPress={() => void store.refreshHostLogs()}
                    style={{ flex: 1 }}
                  />
                </View>

                {state.hostLogs.length > 0 ? (
                  <View style={styles.logBox}>
                    {state.hostLogs.slice(-14).map((line, i) => (
                      <Text key={i} style={styles.logLine} numberOfLines={2}>
                        {line}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={styles.hint}>当前是 Expo Go / web，起不了本机引擎；需要装原生构建的 APK。</Text>
            )}
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
  logBox: {
    marginTop: 8,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  logLine: { color: colors.textDim, fontSize: 10.5, fontFamily: font.mono },

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
    padding: space.md,
    gap: space.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  k: { color: colors.textDim, fontSize: 13 },
  v: { color: colors.text, fontSize: 13, fontWeight: '500' },
  footnote: { color: colors.textFaint, fontSize: 11.5, lineHeight: 17, paddingHorizontal: space.xs },
  error: { color: colors.danger, fontSize: 12, paddingHorizontal: space.xs },
});
