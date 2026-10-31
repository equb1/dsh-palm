import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { store, useStore } from './useStore';
import { Btn, Mono } from './parts';
import { colors, font, radius, space, topInset } from './theme';

export function ConnectScreen(): React.ReactElement {
  const state = useStore();

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollOuter} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
        <View style={styles.mark}>
          <Text style={styles.markText}>锦</Text>
        </View>
        <Text style={styles.title}>锦囊</Text>
        <Text style={styles.subtitle}>装进口袋的智能体</Text>

        <View style={styles.spacer} />

        <Text style={styles.label}>引擎地址</Text>
        <TextInput
          style={styles.input}
          value={state.url}
          onChangeText={(t) => store.setUrl(t)}
          placeholder="ws://192.168.1.10:8787/ws"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel="引擎地址"
        />

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
          <Mono>npm run engine</Mono>
          <Text style={styles.hint}>
            终端会打印一串 ws://192.168.x.x:8787/ws，把它填到上面。手机和电脑要在同一个 Wi-Fi。
          </Text>
        </View>

        <Text style={styles.footnote}>
          手机是完整宿主，不是遥控器。引擎在本机跑，电脑是可选的另一台。
        </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: topInset },
  scrollOuter: { flexGrow: 1, justifyContent: 'center' },
  content: { padding: space.xl },
  mark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  markText: { color: colors.gold, fontSize: 30, fontWeight: '700' },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: space.lg,
    letterSpacing: 4,
  },
  subtitle: { color: colors.dim, fontSize: 14, textAlign: 'center', marginTop: space.sm, letterSpacing: 1 },
  spacer: { height: space.xxl },
  label: { color: colors.faint, fontSize: 12, marginBottom: space.sm, letterSpacing: 1 },
  input: {
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    color: colors.text,
    fontFamily: font.mono,
    fontSize: 14,
  },
  error: { color: colors.danger, fontSize: 12, marginTop: space.sm },
  submit: { marginTop: space.md },
  hintBox: {
    marginTop: space.xl,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
    gap: 6,
  },
  hintTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  hint: { color: colors.faint, fontSize: 12, lineHeight: 18 },
  footnote: { color: colors.faint, fontSize: 11, textAlign: 'center', marginTop: space.xl, lineHeight: 17 },
});
