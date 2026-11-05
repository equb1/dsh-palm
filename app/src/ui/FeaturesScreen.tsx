import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { store, useStore } from './useStore';
import { IconButton } from './parts';
import { colors, radius, space, topInset } from './theme';

/**
 * U6：全部功能页（卡片网格）。
 *
 * 对齐 dsh-go 的「全部功能」：当前对话 / 设置 / 引擎 / 实验室 / 文件 / 终端 /
 * 工作区 / 插件 / 社区。已经能用的直接跳；没有后端的卡片明确写「未接入」，
 * 点按只提示，不假装成功。
 */
type Tone = 'blue' | 'green' | 'violet' | 'amber' | 'slate';

const TONES: Record<Tone, { bg: string; fg: string }> = {
  blue: { bg: colors.blueSoft, fg: colors.blue },
  green: { bg: colors.okSoft, fg: colors.ok },
  violet: { bg: 'rgba(124,58,237,0.10)', fg: '#7C3AED' },
  amber: { bg: colors.warnSoft, fg: colors.warn },
  slate: { bg: colors.glassStrong, fg: colors.textDim },
};

interface FeatureItem {
  id: string;
  title: string;
  hint: string;
  icon: string;
  tone: Tone;
  disabled?: boolean;
  onPress: () => void;
}

export function FeaturesScreen(): React.ReactElement {
  const state = useStore();
  const { width } = useWindowDimensions();
  const [notice, setNotice] = React.useState<string | null>(null);
  const cardWidth = (width - space.lg * 2 - 10) / 2;

  const flash = (message: string): void => {
    setNotice(message);
    setTimeout(() => setNotice((current) => (current === message ? null : current)), 2600);
  };

  const newSession = (): void => {
    const presetId = state.draftPresetId ?? state.caps?.presets[0]?.id ?? 'standard';
    store.closeFeatures();
    void store.createSession(presetId);
  };

  const groups: Array<{ title: string; items: FeatureItem[] }> = [
    {
      title: '对话',
      items: [
        {
          id: 'new',
          title: '新对话',
          hint: '用当前锦囊开一条新会话',
          icon: '＋',
          tone: 'blue',
          onPress: newSession,
        },
        {
          id: 'sessions',
          title: '会话',
          hint: '回首页看最近会话',
          icon: '☰',
          tone: 'slate',
          onPress: () => store.closeFeatures(),
        },
        {
          id: 'settings',
          title: '设置',
          hint: '账号 / 模型 / 引擎',
          icon: '⚙',
          tone: 'slate',
          onPress: () => void store.openSettings(),
        },
        {
          id: 'engine',
          title: '本机引擎',
          hint: '设置 › 能力 里进引擎页',
          icon: '引',
          tone: 'green',
          onPress: () => void store.openSettings(),
        },
        {
          id: 'light',
          title: '轻引擎渠道',
          hint: 'Base URL / 模型 / Key',
          icon: '轻',
          tone: 'green',
          onPress: () => store.openLightSetup(),
        },
        {
          id: 'lab',
          title: '实验室',
          hint: '设置 › 主机 里的 M1 入口',
          icon: '验',
          tone: 'green',
          onPress: () => void store.openSettings(),
        },
      ],
    },
    {
      title: '内容与外延',
      items: [
        {
          id: 'files',
          title: '文件',
          hint: '浏览 /workspace，打开文件',
          icon: '▤',
          tone: 'violet',
          onPress: () => store.openFiles(),
        },
        {
          id: 'terminal',
          title: '终端',
          hint: '只读命令 / 输出回看',
          icon: '>_',
          tone: 'violet',
          onPress: () => store.openTerminal(),
        },
        {
          id: 'workspace',
          title: '工作区',
          hint: '概览 / 会话数 / 文件入口',
          icon: '▢',
          tone: 'violet',
          onPress: () => store.openWorkspace(),
        },
        {
          id: 'plugins',
          title: '插件',
          hint: '兼容矩阵已有，App 入口未接',
          icon: '◈',
          tone: 'amber',
          disabled: true,
          onPress: () => flash('插件入口还没接；兼容矩阵在 docs/archive/24。'),
        },
        {
          id: 'community',
          title: '社区',
          hint: '未接入',
          icon: '◎',
          tone: 'amber',
          disabled: true,
          onPress: () => flash('社区还没接。'),
        },
        {
          id: 'about',
          title: '帮助与关于',
          hint: '版本 / 导出日志',
          icon: 'i',
          tone: 'slate',
          onPress: () => void store.openSettings(),
        },
      ],
    },
  ];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回" onPress={() => store.closeFeatures()} />
        <Text style={styles.title}>全部功能</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {groups.map((group) => (
          <View key={group.title} style={styles.group}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            <View style={styles.grid}>
              {group.items.map((item) => {
                const tone = TONES[item.tone];
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title}${item.disabled ? '，未接入' : ''}`}
                    onPress={item.onPress}
                    style={({ pressed }) => [
                      styles.card,
                      { width: cardWidth },
                      pressed && styles.cardPressed,
                      item.disabled && styles.cardDisabled,
                    ]}
                  >
                    <View style={[styles.icon, { backgroundColor: tone.bg }]}>
                      <Text style={[styles.iconGlyph, { color: tone.fg }]}>{item.icon}</Text>
                    </View>
                    <View style={styles.cardTexts}>
                      <Text style={styles.cardTitle}>{item.title}</Text>
                      <Text style={styles.cardHint} numberOfLines={2}>
                        {item.hint}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: topInset },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '700' },
  scroll: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  notice: { color: colors.textDim, fontSize: 12, lineHeight: 17, paddingHorizontal: space.xs },
  group: { gap: 8 },
  groupTitle: {
    color: colors.textFaint,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: space.xs,
    letterSpacing: 0.2,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    minHeight: 116,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.glass,
    padding: 12,
    gap: 8,
  },
  cardPressed: { backgroundColor: colors.glassStrong },
  cardDisabled: { opacity: 0.72 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: { fontSize: 16, fontWeight: '600' },
  cardTexts: { gap: 2 },
  cardTitle: { color: colors.text, fontSize: 14.5, fontWeight: '600' },
  cardHint: { color: colors.textFaint, fontSize: 11.5, lineHeight: 16 },
});
