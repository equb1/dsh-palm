import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  discoverLanHosts,
  hostAvailable,
  requestLanPermission,
  type DiscoveredHost,
} from '../lib/host';
import { store, useStore } from './useStore';
import { Btn } from './parts';
import { SmoothKeyboardAvoid } from './SmoothKeyboardAvoid';
import { font, radius, space, topInset, useTheme, useThemedStyles, type Theme } from './theme';

export function ConnectScreen(): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const state = useStore();
  const host = state.host;
  const engine = state.engine;
  // 本机模式：完整引擎启动中才挡一下；平时直接显示"连另一台电脑"的表单
  const booting = hostAvailable && engine.mode === 'starting-proot';
  const [scanning, setScanning] = React.useState(false);
  const [lanHosts, setLanHosts] = React.useState<DiscoveredHost[]>([]);
  const [scanNote, setScanNote] = React.useState<string | null>(null);
  const pct = engine.progress;
  const bootText =
    engine.error ||
    ((engine.host ?? host)?.phase || '完整引擎启动中') + (pct > 0 && pct < 100 ? ` · ${pct}%` : '');

  const scanLan = async (): Promise<void> => {
    if (scanning) return;
    setScanning(true);
    setScanNote(null);
    try {
      await requestLanPermission();
      const list = await discoverLanHosts(4000);
      setLanHosts(list);
      if (list.length === 0) setScanNote('没发现宿主；确认同一 Wi-Fi，或直接手填地址。');
    } finally {
      setScanning(false);
    }
  };

  const pickHost = (item: DiscoveredHost): void => {
    store.setUrl(`ws://${item.host}:${item.port}/ws`);
    setScanNote(`已填入 ${item.name}；输入配对码后点连接。`);
  };

  return (
    <View style={styles.root}>
      <SmoothKeyboardAvoid style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollOuter} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <View style={styles.mark}>
              <Text style={styles.markText}>蟹</Text>
            </View>
            <Text style={styles.title}>Crabstack</Text>
            <Text style={styles.subtitle}>装进口袋的智能体工作台</Text>

            {booting ? (
              <View style={styles.bootBox}>
                <Text style={styles.bootText}>{bootText}</Text>
                <Text style={styles.bootHint}>
                  完整引擎第一次启动要解压运行时（约 10 秒），之后是秒开。启动完成后可回到首页点顶栏「完整」接入。
                </Text>
              </View>
            ) : null}

            <View style={styles.spacer} />

            {!booting ? (
              <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="扫描局域网宿主"
              onPress={() => void scanLan()}
              style={({ pressed }) => [styles.scanBtn, pressed && styles.scanBtnPressed]}
            >
              <Text style={styles.scanText}>{scanning ? '正在扫描局域网…' : '扫描局域网宿主'}</Text>
            </Pressable>
            {lanHosts.length > 0 ? (
              <View style={styles.hostList}>
                {lanHosts.map((item) => (
                  <Pressable
                    key={`${item.id}:${item.host}:${item.port}`}
                    accessibilityRole="button"
                    accessibilityLabel={`连接宿主 ${item.name}`}
                    onPress={() => pickHost(item)}
                    style={({ pressed }) => [styles.hostRow, pressed && styles.hostRowPressed]}
                  >
                    <Text style={styles.hostName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.hostMeta} numberOfLines={1}>
                      {item.host}:{item.port}
                      {item.fingerprint ? ` · ${item.fingerprint.slice(0, 8)}` : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {scanNote ? <Text style={styles.scanNote}>{scanNote}</Text> : null}
            {state.remoteHost ? (
              <View style={styles.lastHost}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hostName} numberOfLines={1}>
                    {state.remoteHost.name}
                  </Text>
                  <Text style={styles.hostMeta} numberOfLines={1}>
                    {state.conn === 'connected' && state.engineKind === 'remote'
                      ? '当前已连接'
                      : `上次同步 ${new Date(state.remoteHost.lastSeenAt).toLocaleTimeString()}`}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="重连上次的宿主"
                  onPress={() => void store.connect(state.remoteHost?.url)}
                  style={({ pressed }) => [styles.reconnect, pressed && styles.scanBtnPressed]}
                >
                  <Text style={styles.reconnectText}>重连</Text>
                </Pressable>
              </View>
            ) : null}

            <Text style={styles.label}>电脑引擎地址 (WebSocket)</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={state.url}
                onChangeText={(t) => store.setUrl(t)}
                placeholder="ws://192.168.1.3:8788/ws"
                placeholderTextColor={palette.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel="引擎地址"
              />
            </View>

            {Boolean(state.error) ? (
              <View style={styles.errorCard}>
                <View style={styles.errorHeader}>
                  <Text style={styles.errorTitle}>连接遇到问题</Text>
                  <Pressable onPress={() => store.clearError()} hitSlop={8}>
                    <Text style={styles.errorDismiss}>✕</Text>
                  </Pressable>
                </View>
                <Text style={styles.errorBody}>{state.error}</Text>
                <Text style={styles.errorHint}>
                  💡 检查指南：请确认电脑端已启动引擎（npm run engine），且手机和电脑连接在同一个 Wi-Fi 网络下。
                </Text>
              </View>
            ) : null}

            <Btn
              label={state.conn === 'connecting' ? '正在连接电脑宿主…' : '连接电脑宿主'}
              onPress={() => void store.connect()}
              disabled={state.conn === 'connecting'}
              style={styles.submit}
            />

              </>
            ) : null}

            {hostAvailable ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void store.switchEngine(engine.mode === 'full' ? 'light' : 'full')}
                style={styles.settingsRow}
              >
                <Text style={styles.settingsText}>
                  {engine.mode === 'full' ? '切回轻引擎（省电）' : '切换到完整引擎'}
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

            {hostAvailable && state.connectModalOpen ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => store.closeConnectModal()}
                style={styles.settingsRow}
              >
                <Text style={[styles.settingsText, { color: palette.blue }]}>返回首页</Text>
              </Pressable>
            ) : null}

            {!hostAvailable ? (
            <View style={styles.hintBox}>
              <Text style={styles.hintTitle}>先把引擎跑起来</Text>
              <Text style={styles.hintCode}>npm run engine</Text>
              <Text style={styles.hint}>
                终端会打印一串 ws://192.168.x.x:8788/ws，填到上面。手机和电脑要在同一个 Wi-Fi。
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

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg, paddingTop: topInset },
  scrollOuter: { flexGrow: 1, justifyContent: 'center' },
  content: { paddingHorizontal: space.xl, paddingVertical: space.xxl },
  mark: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: c.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  markText: { color: c.gold, fontSize: 26, fontWeight: '700' },
  title: {
    color: c.text,
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: space.lg,
    letterSpacing: 6,
  },
  subtitle: {
    color: c.textDim,
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
    backgroundColor: c.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    gap: 4,
  },
  bootText: { color: c.text, fontSize: 13, textAlign: 'center', fontWeight: '600' },
  bootHint: { color: c.textFaint, fontSize: 11, textAlign: 'center', lineHeight: 16 },
  spacer: { height: space.xl },
  scanBtn: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.glass,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: space.md,
  },
  scanBtnPressed: { backgroundColor: c.glassStrong },
  scanText: { color: c.blue, fontSize: 13, fontWeight: '600' },
  hostList: { gap: 8, marginBottom: space.md },
  hostRow: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.glass,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  hostRowPressed: { backgroundColor: c.glassStrong },
  hostName: { color: c.text, fontSize: 13.5, fontWeight: '600' },
  hostMeta: { color: c.textFaint, fontSize: 11.5, fontFamily: font.mono },
  scanNote: { color: c.textDim, fontSize: 11.5, marginBottom: space.sm },
  lastHost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.glass,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: space.md,
  },
  reconnect: {
    borderRadius: radius.sm,
    backgroundColor: c.blueSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  reconnectText: { color: c.blue, fontSize: 12, fontWeight: '600' },
  errorCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    padding: space.md,
    marginBottom: space.md,
    gap: 6,
  },
  errorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorTitle: {
    color: c.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  errorDismiss: {
    color: c.textDim,
    fontSize: 14,
    paddingHorizontal: 4,
  },
  errorBody: {
    color: c.text,
    fontSize: 12.5,
    lineHeight: 18,
  },
  errorHint: {
    color: c.textDim,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 2,
  },

  label: { color: c.textDim, fontSize: 12, marginBottom: 6, letterSpacing: 0.5 },
  inputWrap: {
    backgroundColor: c.glass,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: space.md,
  },
  input: { color: c.text, fontSize: 14, padding: 0 },
  submit: { marginTop: space.sm },
  settingsRow: { alignItems: 'center', paddingVertical: 10 },
  settingsText: { color: c.textDim, fontSize: 12.5 },
  error: { color: c.danger, fontSize: 12, textAlign: 'center', marginBottom: space.sm },
  hintBox: {
    marginTop: space.xxl,
    padding: space.md,
    backgroundColor: c.glass,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    gap: 4,
  },
  hintTitle: { color: c.text, fontSize: 12, fontWeight: '600' },
  hintCode: {
    fontFamily: font.mono,
    color: c.blue,
    fontSize: 12,
    backgroundColor: c.glassStrong,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginVertical: 2,
  },
  hint: { color: c.textDim, fontSize: 11.5, lineHeight: 17 },
  footnote: {
    marginTop: space.lg,
    color: c.textFaint,
    fontSize: 11,
    textAlign: 'center',
  },
});
