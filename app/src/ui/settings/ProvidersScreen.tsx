import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { store, useStore } from '../useStore';
import { IconButton } from '../parts';
import { ProvidersCard } from '../ProvidersCard';
import { SmoothKeyboardAvoid } from '../SmoothKeyboardAvoid';
import { colors, space, topInset } from '../theme';

/**
 * U4 二级页：模型提供商。
 *
 * 卡片自己管理状态（目录 / 自定义 API / 编辑表单），这里只提供独立页骨架。
 */
export function ProvidersScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const state = useStore();

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回设置" onPress={onClose} />
        <Text style={styles.title}>模型提供商</Text>
        <View style={{ width: 36 }} />
      </View>

      <SmoothKeyboardAvoid style={styles.body}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ProvidersCard />
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
  error: { color: colors.danger, fontSize: 12, paddingHorizontal: space.xs },
});
