import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { hostAvailable } from '../lib/host';
import { store, useStore } from './useStore';
import { Btn } from './parts';
import { SmoothKeyboardAvoid } from './SmoothKeyboardAvoid';
import { colors, font, radius, space, topInset } from './theme';

export function ConnectScreen(): React.ReactElement {
  const state = useStore();
  /** 本机模式下默认不展示地址/配对码，想连电脑再展开 */
  const [advanced, setAdvanced] = React.useState(false);
  const host = state.host;
  // 本机模式下这一页只做"启动中"的门面：机器自己会起来、自己会连，
  // 地址/配对码是给"连另一台电脑"用的，默认收起来
  const booting = hostAvailable && !advanced;
  const failed = hostAvailable && host?.engine === 'failed';
  const pct = host?.progress ?? 0;
  const bootText =
    host?.engine === 'failed'
      ? host.error ?? '本机引擎启动失败'
      : (host?.phase || '本机引擎启动中') + (pct > 0 && pct < 100 ? ` · ${pct}%` : '');

  return (
    <View style={styles.root}>
      <SmoothKeyboardAvoid style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollOuter} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <View style={styles.mark}>
              <Text style={styles.markText}>锦</Text>
            </View>
            <Text style={styles.title}>锦囊</Text>
            <Text style={styles.subtitle}>装进口袋的智能体</Text>

            {booting ? (
              <View style={styles.bootBox}>
                <Text style={[styles.bootText, failed && { color: colors.danger }]}>{bootText}</Text>
                <Text style={styles.bootHint}>
                  {failed
                    ? '引擎没起来。可以先重试，或者去设置里看日志。'
                    : '第一次启动要解压运行时（约 10 秒），之后是秒开。装好后会自动连上，不用点。'}
                </Text>
                {failed ? (
                  <Btn
                    label="重试"
                    onPress={() => void store.startLocalHost()}
                    style={{ marginTop: 6 }}
                  />
                ) : null}
              </View>
            ) : null}

            <View style={styles.spacer} />

            {!booting ? (
              <>
            <Text style={styles.label}>引擎地址</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={state.url}
                onChangeText={(t) => store.setUrl(t)}
                placeholder="ws://192.168.1.10:8787/ws"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel="引擎地址"
              />
            </View>

            <Text style={styles.label}>配对码</Text>
            {state.deviceKey ? (
              <View style={styles.pairedRow}>
                <Text style={styles.pairedText}>这台设备已配对，不用再输配对码</Text>
                <Pressable accessibilityRole="button" onPress={() => void store.forgetDevice()}>
                  <Text style={styles.pairedAction}>忘记这台设备</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.input}
                  value={state.pairCode}
                  onChangeText={(t) => store.setPairCode(t)}
                  placeholder="6 位数字，宿主启动时会打印"
                  placeholderTextColor={colors.textFaint}
                  keyboardType="number-pad"
                  maxLength={6}
                  accessibilityLabel="配对码"
                />
              </View>
            )}

            {Boolean(state.error) ? (
              <Pressable onPress={() => store.clearError()}>
                <Text style={styles.error}>{state.error}</Text>
              </Pressable>
            ) : null}

            <Btn
              label={state.conn === 'connecting' ? '连接中…' : '连接'}
              onPress={() => void store.connect()}
              disabled={state.conn === 'connecting'}
              style={styles.submit}
            />

              </>
            ) : null}

            {hostAvailable ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setAdvanced((v) => !v)}
                style={styles.settingsRow}
              >
                <Text style={styles.settingsText}>
                  {advanced ? '返回本机模式' : '连接另一台电脑'}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={() => store.openSettings()}
              style={styles.settingsRow}
            >
              <Text style={styles.settingsText}>设置 · 账号 / 引擎</Text>
            </Pressable>

            {!hostAvailable ? (
            <View style={styles.hintBox}>
              <Text style={styles.hintTitle}>先把引擎跑起来</Text>
              <Text style={styles.hintCode}>npm run engine</Text>
              <Text style={styles.hint}>
                终端会打印一串 ws://192.168.x.x:8787/ws，填到上面。手机和电脑要在同一个 Wi-Fi。
              </Text>
            </View>
            ) : null}

            <Text style={styles.footnote}>手机是完整宿主，不是遥控器。电脑是可选的另一台。</Text>
          </View>
        </ScrollView>
      </SmoothKeyboardAvoid>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: topInset },
  scrollOuter: { flexGrow: 1, justifyContent: 'center' },
  content: { paddingHorizontal: space.xl, paddingVertical: space.xxl },
  mark: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  markText: { color: colors.gold, fontSize: 26, fontWeight: '700' },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: space.lg,
    letterSpacing: 6,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 13,
    textAlign: 'center',
    marginTop: space.xs,
    letterSpacing: 1.5,
  },
  bootBox: {
    marginTop: space.lg,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 4,
  },
  bootText: { color: colors.text, fontSize: 13, textAlign: 'center', fontWeight: '600' },
  bootHint: { color: colors.textFaint, fontSize: 11, textAlign: 'center', lineHeight: 16 },
  spacer: { height: space.xl },
  pairedRow: { gap: 6, paddingVertical: 4 },
  pairedText: { color: colors.textDim, fontSize: 13 },
  pairedAction: { color: colors.blue, fontSize: 13 },

  label: { color: colors.textDim, fontSize: 12, marginBottom: 6, letterSpacing: 0.5 },
  inputWrap: {
    backgroundColor: colors.glass,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: space.md,
  },
  input: { color: colors.text, fontSize: 14, padding: 0 },
  submit: { marginTop: space.sm },
  settingsRow: { alignItems: 'center', paddingVertical: 10 },
  settingsText: { color: colors.textDim, fontSize: 12.5 },
  error: { color: colors.danger, fontSize: 12, textAlign: 'center', marginBottom: space.sm },
  hintBox: {
    marginTop: space.xxl,
    padding: space.md,
    backgroundColor: colors.glass,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 4,
  },
  hintTitle: { color: colors.text, fontSize: 12, fontWeight: '600' },
  hintCode: {
    fontFamily: font.mono,
    color: colors.blue,
    fontSize: 12,
    backgroundColor: colors.glassStrong,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginVertical: 2,
  },
  hint: { color: colors.textDim, fontSize: 11.5, lineHeight: 17 },
  footnote: {
    marginTop: space.lg,
    color: colors.textFaint,
    fontSize: 11,
    textAlign: 'center',
  },
});
