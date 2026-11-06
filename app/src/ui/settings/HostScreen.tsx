import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { store, useStore } from '../useStore';
import { Btn, IconButton } from '../parts';
import { SmoothKeyboardAvoid } from '../SmoothKeyboardAvoid';
import { radius, space, topInset, useTheme, useThemedStyles, type Theme } from '../theme';
import { discoverLanHosts, requestLanPermission, type DiscoveredHost } from '../../lib/host';

/**
 * U4 二级页：宿主。
 *
 * 从设置首页的宿主卡搬来：引擎类型、名称、类型、版本、当前锦囊、断开连接。
 */
export function HostScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const state = useStore();
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const preset = state.caps?.presets.find((p) => p.id === state.draftPresetId) ?? state.caps?.presets[0];
  const [scanning, setScanning] = React.useState(false);
  const [lanHosts, setLanHosts] = React.useState<DiscoveredHost[]>([]);
  const [scanNote, setScanNote] = React.useState<string | null>(null);

  const scan = async (): Promise<void> => {
    if (scanning) return;
    setScanning(true);
    setScanNote(null);
    try {
      await requestLanPermission();
      const hosts = await discoverLanHosts(4_000);
      setLanHosts(hosts);
      if (hosts.length === 0) setScanNote('没有发现宿主；确认同一 Wi-Fi，或回连接页手动填地址。');
    } finally {
      setScanning(false);
    }
  };

  const useHost = (host: DiscoveredHost): void => {
    store.setUrl(`ws://${host.host}:${host.port}/ws`);
    setScanNote(`已填入 ${host.name}；断开后到连接页输入配对码。`);
  };

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

          <View style={styles.card}>
            <View style={styles.scanHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>局域网扫描</Text>
                <Text style={styles.scanHint}>发现同一 Wi-Fi 下广播 _dsh-palm._tcp 的宿主</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="扫描局域网"
                onPress={() => void scan()}
                style={({ pressed }) => [styles.scanBtn, pressed && styles.scanBtnPressed]}
              >
                {scanning ? (
                  <ActivityIndicator size="small" color={palette.blue} />
                ) : (
                  <Text style={styles.scanBtnText}>扫描</Text>
                )}
              </Pressable>
            </View>
            {lanHosts.map((host) => (
              <Pressable
                key={`${host.id}:${host.host}:${host.port}`}
                accessibilityRole="button"
                accessibilityLabel={`使用宿主 ${host.name}`}
                onPress={() => useHost(host)}
                style={({ pressed }) => [styles.lanRow, pressed && styles.lanRowPressed]}
              >
                <Text style={styles.lanName} numberOfLines={1}>{host.name}</Text>
                <Text style={styles.lanMeta} numberOfLines={1}>
                  {host.host}:{host.port}
                  {host.fingerprint ? ` · ${host.fingerprint.slice(0, 8)}` : ''}
                </Text>
              </Pressable>
            ))}
            {scanNote ? <Text style={styles.scanNote}>{scanNote}</Text> : null}
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
    scanHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    scanHint: { color: c.textFaint, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
    scanBtn: {
      minWidth: 64,
      minHeight: 34,
      borderRadius: radius.md,
      backgroundColor: c.blueSoft,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    scanBtnPressed: { opacity: 0.75 },
    scanBtnText: { color: c.blue, fontSize: 12.5, fontWeight: '600' },
    lanRow: {
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingHorizontal: space.sm,
      paddingVertical: 9,
      gap: 2,
    },
    lanRowPressed: { backgroundColor: c.glassStrong },
    lanName: { color: c.text, fontSize: 13.5, fontWeight: '600' },
    lanMeta: { color: c.textFaint, fontSize: 11.5, fontFamily: 'monospace' },
    scanNote: { color: c.textDim, fontSize: 11.5, lineHeight: 16 },
  });
