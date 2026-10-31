import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { store, useStore } from './useStore';
import { Btn } from './parts';
import { colors, font, radius, space, topInset } from './theme';

export function ConnectScreen(): React.ReactElement {
  const state = useStore();

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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

          <Text style={styles.label}>配对码<Text style={styles.optional}>（连电脑才需要，mock 引擎留空）</Text></Text>
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

          {state.error ? (
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
    </KeyboardAvoidingView>
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
  subtitle: { color: colors.textFaint, fontSize: 13, textAlign: 'center', marginTop: 6, letterSpacing: 0.5 },
  spacer: { height: space.xxl },
  label: { color: colors.textFaint, fontSize: 11.5, marginBottom: space.sm, letterSpacing: 0.5 },
  optional: { color: colors.textFaint, fontSize: 10.5 },
  inputWrap: {
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
  },
  input: {
    paddingVertical: 13,
    color: colors.text,
    fontFamily: font.mono,
    fontSize: 13.5,
  },
  error: { color: colors.danger, fontSize: 12, marginTop: 10 },
  submit: { marginTop: 14 },
  hintBox: {
    marginTop: space.xl,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 6,
  },
  hintTitle: { color: colors.text, fontSize: 12.5, fontWeight: '600' },
  hintCode: { color: colors.textDim, fontFamily: font.mono, fontSize: 12 },
  hint: { color: colors.textFaint, fontSize: 11.5, lineHeight: 18 },
  footnote: { color: colors.textFaint, fontSize: 10.5, textAlign: 'center', marginTop: space.xl, lineHeight: 17 },
});
