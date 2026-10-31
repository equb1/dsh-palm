import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useStore } from './useStore';
import { colors, radius, space } from './theme';

/**
 * 「+」抽屉：所有预设都收在这里（参考 Gemini 把能力放进 + 的做法）。
 * 首页和会话页共用一份。
 */
export function PresetSheet({
  visible,
  currentId,
  onPick,
  onClose,
}: {
  visible: boolean;
  currentId: string | null;
  onPick: (presetId: string) => void;
  onClose: () => void;
}): React.ReactElement | null {
  const state = useStore();
  const presets = state.caps?.presets ?? [];
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="关闭" />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>收一个锦囊</Text>
        <Text style={styles.subtitle}>每个锦囊 = 一套工具 + 一套网络权限</Text>

        <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 4 }}>
          {presets.map((p) => {
            const active = p.id === currentId;
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={p.name}
                onPress={() => {
                  onPick(p.id);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.row,
                  active && styles.rowActive,
                  pressed && { backgroundColor: colors.glassPressed },
                ]}
              >
                <View style={styles.glyph}>
                  <Text style={styles.glyphText}>{p.glyph}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.name}>{p.name}</Text>
                  <Text style={styles.tagline} numberOfLines={1}>
                    {p.tagline}
                  </Text>
                </View>
                <View style={styles.right}>
                  {active ? (
                    <Text style={styles.activeTag}>当前</Text>
                  ) : (
                    <Text style={styles.meta}>{p.contract.net === 'deny' ? '禁网' : '联网'}</Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.divider} />

        <View style={styles.disabledRow}>
          <Text style={styles.disabledGlyph}>↥</Text>
          <Text style={styles.disabledText}>上传文件</Text>
          <Text style={styles.soon}>即将支持</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: '#15181E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.lg,
    paddingTop: 10,
    paddingBottom: space.xxl,
    gap: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: 10,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  subtitle: { color: colors.textFaint, fontSize: 11.5, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: radius.md,
  },
  rowActive: { backgroundColor: colors.glass },
  glyph: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphText: { color: colors.gold, fontSize: 15, fontWeight: '700' },
  name: { color: colors.text, fontSize: 14.5, fontWeight: '600' },
  tagline: { color: colors.textFaint, fontSize: 11.5 },
  right: { minWidth: 34, alignItems: 'flex-end' },
  activeTag: { color: colors.gold, fontSize: 11, fontWeight: '600' },
  meta: { color: colors.textFaint, fontSize: 10.5 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 8 },
  disabledRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8 },
  disabledGlyph: { color: colors.textFaint, fontSize: 15 },
  disabledText: { color: colors.textFaint, fontSize: 13.5, flex: 1 },
  soon: { color: colors.textFaint, fontSize: 10.5 },
});
