import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { store, useStore } from '../useStore';
import { Btn, IconButton } from '../parts';
import { SmoothKeyboardAvoid } from '../SmoothKeyboardAvoid';
import { radius, space, topInset, useThemedStyles, type Theme } from '../theme';

/**
 * U4 二级页：宿主。
 *
 * 从设置首页的宿主卡搬来：引擎类型、名称、类型、版本、当前锦囊、断开连接。
 */
export function HostScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const state = useStore();
  const styles = useThemedStyles(createStyles);
  const preset = state.caps?.presets.find((p) => p.id === state.draftPresetId) ?? state.caps?.presets[0];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回设置" onPress={onClose} />
        <Text style={styles.title}>宿主</Text>
        <View style={{ width: 36 }} />
      </View>

      <SmoothKeyboardAvoid style={styles.body}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>宿主</Text>
            <View style={styles.kv}>
              <Text style={styles.k}>引擎</Text>
              <Text style={styles.v}>
                {state.engineKind === 'light'
                  ? '轻引擎（本机）'
                  : state.engineKind === 'remote'
                    ? '远程宿主'
                    : '—'}
              </Text>
            </View>
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
            <Text style={styles.hint}>
              锦囊决定 agent 的工作方式。真 dsh 宿主暂不提供工具白名单，别把这里当安全边界。
            </Text>
            <View style={styles.actions}>
              <Btn
                label="断开当前连接"
                kind="ghost"
                onPress={() => store.disconnect()}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </ScrollView>
      </SmoothKeyboardAvoid>
    </View>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg, paddingTop: topInset },
    body: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
    },
    title: { flex: 1, color: c.text, fontSize: 17, fontWeight: '700' },
    scroll: { padding: space.lg, gap: 12, paddingBottom: space.xxl },
    card: {
      backgroundColor: c.glass,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: space.md,
      gap: space.sm,
    },
    cardTitle: { color: c.text, fontSize: 14, fontWeight: '600' },
    hint: { color: c.textDim, fontSize: 12, lineHeight: 17 },
    kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
    k: { color: c.textDim, fontSize: 13 },
    v: { color: c.text, fontSize: 13, fontWeight: '500' },
    actions: { flexDirection: 'row', gap: space.sm, marginTop: 4 },
  });
