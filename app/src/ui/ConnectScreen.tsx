import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { store, useStore } from './useStore';
import { Btn } from './parts';
import { SmoothKeyboardAvoid } from './SmoothKeyboardAvoid';
import { colors, font, radius, space, topInset } from './theme';

export function ConnectScreen(): React.ReactElement {
  const state = useStore();

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

            <View style={styles.spacer} />

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

            <Pressable
              accessibilityRole="button"
              onPress={() => store.openSettings()}
              style={styles.settingsRow}
            >
              <Text style={styles.settingsText}>设置 · 本机引擎 / 凭据</Text>
            </Pressable>

            <View style={styles.hintBox}>
              <Text style={styles.hintTitle}>先把引擎跑起来</Text>
              <Text style={styles.hintCode}>npm run engine</Text>
              <Text style={styles.hint}>
                终端会打印一串 ws://192.168.x.x:8787/ws，填到上面。手机和电脑要在同一个 Wi-Fi。
              </Text>
            </View>

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
