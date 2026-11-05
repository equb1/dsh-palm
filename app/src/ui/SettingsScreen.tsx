import React from 'react';
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { store, useStore } from './useStore';
import { Btn, IconButton, Pill } from './parts';
import { SmoothKeyboardAvoid } from './SmoothKeyboardAvoid';
import { colors, font, radius, space, topInset } from './theme';
import {
  hostAvailable,
  hostBatteryWhitelisted,
  hostLogs,
  openHostBatterySettings,
  setHostSafeModeNext,
} from '../lib/host';
import { ProvidersCard } from './ProvidersCard';
import { JustBashProbe } from './JustBashProbe';
import { LightEngineScreen } from './LightEngineScreen';
import { WebSurface } from './WebSurface';
import { loadAccountPhone, saveAccountPhone } from '../lib/accountPhone';

const REF = 'DEEPSEEK_API_KEY';

/** 预热档位：触发式默认 / 智能预热（充电 + WiFi）/ 常备（高级） */
const PREWARM_TIERS = [
  { id: 'trigger' as const, label: '触发式' },
  { id: 'smart' as const, label: '智能预热' },
  { id: 'always' as const, label: '常备' },
];

/** 从宿主日志里捞本机引擎的 token（`dsh web: http://127.0.0.1:8787/?token=…`） */
async function resolveEngineToken(): Promise<string | null> {
  const lines = await hostLogs();
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /dsh web: http:\/\/127\.0\.0\.1:8787\/\?token=([A-Za-z0-9_-]+)/.exec(lines[i] ?? '');
    if (match?.[1]) return match[1];
  }
  return null;
}

/** 登录尝试的阶段 → 一句人能看懂的话 */
function attemptText(phase: string | undefined, errorCode: string | undefined): string | null {
  if (!phase) return null;
  switch (phase) {
    case 'initializing':
      return '正在准备登录…';
    case 'waiting-browser':
      return '在浏览器里完成授权，回到 App 会自动生效';
    case 'exchanging':
    case 'committing':
      return '正在保存登录凭据…';
    case 'failed':
    case 'expired':
      return errorCode === 'network'
        ? '连不上 DeepSeek，检查网络后重试'
        : errorCode === 'expired'
          ? '授权超时了，重新点一次登录'
          : '登录没完成，重新试一次';
    default:
      return null;
  }
}

/**
 * 模型与凭据。
 * 注意：Key 写给宿主，手机不保存——本机模式下宿主就是这台手机。
 */
export function SettingsScreen(): React.ReactElement {
  const state = useStore();
  const [key, setKey] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  /** API Key 是备选方式，默认收起；账号登录是主路径 */
  const [showKey, setShowKey] = React.useState(false);
  /** null = 问不到（非 Android / 老系统） */
  const [batteryOk, setBatteryOk] = React.useState<boolean | null>(null);
  /** 实验室：L0（WebView 官方前端）/ L1（just-bash 前置）两个 spike */
  const [lab, setLab] = React.useState<'none' | 'web' | 'bash' | 'light'>('none');
  const [webUrl, setWebUrl] = React.useState<string | null>(null);
  const [labNote, setLabNote] = React.useState<string | null>(null);
  const [phone, setPhone] = React.useState('');
  const [phoneSaved, setPhoneSaved] = React.useState(false);
  React.useEffect(() => {
    void loadAccountPhone().then(setPhone);
  }, []);
  const status = state.credentials[REF];
  const configured = status?.configured === true;
  const preset = state.caps?.presets.find((p) => p.id === state.draftPresetId) ?? state.caps?.presets[0];

  // 本机引擎状态：进设置页就每 2 秒拉一次
  const host = state.host;
  const engine = state.engine;
  const hostReady = host?.engine === 'ready' && host?.bridge === 'ready';
  const hostStarting = host?.engine === 'starting';
  const hostLabel = !hostAvailable
    ? '不支持'
    : hostReady
      ? '运行中'
      : host?.engine === 'failed' || host?.bridge === 'failed'
        ? '出错'
        : hostStarting
          ? host && (host.progress ?? 0) > 0
            ? `启动中 ${host.progress}%`
            : '启动中'
          : '已停止';
  const engineLabel =
    engine.mode === 'starting-proot'
      ? `完整引擎启动中 ${engine.progress > 0 ? engine.progress + '%' : ''}`.trim()
      : engine.mode === 'full'
        ? engine.link === 'proot'
          ? '完整引擎（本机）'
          : '远程宿主'
        : '轻引擎（默认）';

  React.useEffect(() => {
    if (!hostAvailable) return;
    void hostBatteryWhitelisted().then(setBatteryOk);
    void store.refreshHost();
    void store.loadHostCommands();
    // 首装解压只有 10 秒左右，启动时拉密一点才看得见进度
    const timer = setInterval(() => void store.refreshHost(), hostStarting ? 500 : 2000);
    return () => clearInterval(timer);
  }, [hostStarting]);

  // 账号：进设置页拉一次；有登录尝试时 1 秒一次（真引擎的授权页要等宿主生成）
  const account = state.account;
  const accountAttempt = account?.attempt;
  const signedIn = account?.status === 'credential-stored';
  const waiting = accountAttempt?.phase === 'waiting-browser' || accountAttempt?.phase === 'initializing';
  const accountNote = attemptText(accountAttempt?.phase, accountAttempt?.errorCode);

  React.useEffect(() => {
    if (!state.caps) return;
    void store.refreshAccount();
  }, [state.caps]);

  React.useEffect(() => {
    if (!accountAttempt || !waiting) return;
    const timer = setInterval(() => void store.refreshAccount(), 1000);
    return () => clearInterval(timer);
  }, [accountAttempt?.id, waiting]);

  const save = async (value: string): Promise<void> => {
    const ok = await store.saveCredential(REF, value);
    if (ok) {
      setKey('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const openWebSurface = async (): Promise<void> => {
    setLabNote(null);
    const token = await resolveEngineToken();
    if (!token) {
      setLabNote('还没抓到引擎 token：等「本机引擎」变成运行中再试。');
      return;
    }
    setWebUrl(`http://127.0.0.1:8787/?token=${token}`);
    setLab('web');
  };

  if (lab === 'bash') {
    return <JustBashProbe onClose={() => setLab('none')} />;
  }
  if (lab === 'light') {
    return <LightEngineScreen onClose={() => setLab('none')} />;
  }
  // HomeScreen 的「配置轻引擎」入口
  if (state.lightSetupOpen) {
    return (
      <LightEngineScreen
        onClose={() => {
          store.closeLightSetup();
          store.closeSettings();
        }}
      />
    );
  }
  if (lab === 'web' && webUrl) {
    return (
      <WebSurface
        url={webUrl}
        onClose={() => {
          setLab('none');
          setWebUrl(null);
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回" onPress={() => store.closeSettings()} />
        <Text style={styles.title}>模型与凭据</Text>
        <View style={{ width: 36 }} />
      </View>

      <SmoothKeyboardAvoid style={styles.bodyWrap}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            <View style={styles.rowTop}>
              <Text style={styles.cardTitle}>DeepSeek 账号</Text>
              <Pill>
                <Text style={[styles.status, signedIn && { color: colors.ok }]}>
                  {signedIn ? '已登录' : waiting ? '登录中' : '未登录'}
                </Text>
              </Pill>
            </View>
            <Text style={styles.hint}>
              推荐：用账号登录，和 dsh 官方一致，不用申请 Key。授权在系统浏览器里完成，令牌留在宿主上，App 不保存。
            </Text>

            <Text style={styles.label}>手机号（仅本机显示）</Text>
            <View style={styles.phoneRow}>
              <TextInput
                style={styles.phoneInput}
                value={phone}
                onChangeText={(v) => {
                  setPhone(v);
                  setPhoneSaved(false);
                }}
                placeholder="15912345670"
                placeholderTextColor={colors.textFaint}
                keyboardType="phone-pad"
                accessibilityLabel="账号手机号"
              />
              <Btn
                label={phoneSaved ? '已保存' : '保存'}
                kind="ghost"
                onPress={() => {
                  void saveAccountPhone(phone).then(() => setPhoneSaved(true));
                }}
              />
            </View>
            <Text style={styles.hint}>
              宿主没返回手机号时，用这里填的号码做脱敏显示（159****5670）；只存在本机，不上传。
            </Text>

            {accountNote ? <Text style={styles.hint}>{accountNote}</Text> : null}

            {!state.caps ? (
              <Text style={styles.hint}>还没连上宿主，连上后才能用账号登录。</Text>
            ) : (
              <View style={styles.actions}>
                {signedIn ? (
                  <>
                    <Btn
                      label="重新登录"
                      kind="ghost"
                      onPress={() => void store.reloginAccount()}
                      style={{ flex: 1 }}
                    />
                    <Btn
                      label="退出登录"
                      kind="ghost"
                      onPress={() => void store.signOutAccount()}
                      style={{ flex: 1 }}
                    />
                    <Btn
                      label="查看用量"
                      kind="ghost"
                      onPress={() => {
                        const url = account?.links.usageUrl;
                        if (url) void Linking.openURL(url).catch(() => undefined);
                      }}
                      style={{ flex: 1 }}
                    />
                  </>
                ) : waiting ? (
                  <>
                    <Btn
                      label="重新打开授权页"
                      onPress={() => store.openAccountAuthPage()}
                      style={{ flex: 1 }}
                    />
                    <Btn
                      label="取消"
                      kind="ghost"
                      onPress={() => void store.cancelAccountSignIn()}
                      style={{ flex: 1 }}
                    />
                  </>
                ) : (
                  <Btn
                    label="用 DeepSeek 账号登录"
                    onPress={() => void store.startAccountSignIn()}
                    style={{ flex: 1 }}
                  />
                )}
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Pressable
              style={styles.rowTop}
              accessibilityRole="button"
              accessibilityLabel="展开或收起 API Key"
              onPress={() => setShowKey((v) => !v)}
            >
              <Text style={styles.cardTitle}>DeepSeek API Key（备选）</Text>
              <View style={styles.rowRight}>
                <Pill>
                  <Text style={[styles.status, configured && { color: colors.ok }]}>
                    {configured ? '已配置' : '未配置'}
                  </Text>
                </Pill>
                <Text style={styles.chevron}>{showKey ? '▾' : '▸'}</Text>
              </View>
            </Pressable>

            {showKey ? (
              <>
                <Text style={styles.hint}>
                  Key 存在宿主上（连电脑时存在电脑，本机模式下存在这台手机），App 不会保存。
                </Text>
                <TextInput
                  style={styles.input}
                  value={key}
                  onChangeText={setKey}
                  placeholder={configured ? '已配置 · 粘贴新 Key 可覆盖' : 'sk-…'}
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  accessibilityLabel="API Key"
                />
                <View style={styles.actions}>
                  <Btn
                    label={saved ? '已保存' : configured ? '更换' : '保存'}
                    onPress={() => void save(key)}
                    disabled={key.trim().length === 0}
                    style={{ flex: 1 }}
                  />
                  <Btn
                    label="清除"
                    kind="ghost"
                    onPress={() => void save('')}
                    disabled={!configured}
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.hint}>
                  {configured
                    ? '已配置。换 Key 或清除都在这里；账号登录正常时用不到它。'
                    : '没有账号授权时，也可以直接填一个 DeepSeek API Key。'}
                </Text>
                <View style={styles.actions}>
                  <Btn
                    label={configured ? '更换 API Key' : '填写 API Key'}
                    onPress={() => setShowKey(true)}
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            )}
          </View>

          <ProvidersCard />

          <View style={styles.card}>
            <View style={styles.rowTop}>
              <Text style={styles.cardTitle}>本机引擎</Text>
              <Pill>
                <Text style={[styles.status, hostReady && { color: colors.ok }]}>{hostLabel}</Text>
              </Pill>
            </View>
            <Text style={styles.hint}>
              默认轻引擎。完整引擎只在手动切换或预热档位允许时启动；这里的「预热」只 startHost，不会连接。
            </Text>

            {hostAvailable ? (
              <>
                <View style={styles.kv}>
                  <Text style={styles.k}>当前引擎</Text>
                  <Text style={styles.v}>{engineLabel}</Text>
                </View>
                <View style={styles.kv}>
                  <Text style={styles.k}>预热档位</Text>
                  <Text style={styles.v}>
                    {PREWARM_TIERS.find((tier) => tier.id === state.prewarmTier)?.label}
                  </Text>
                </View>
                <Text style={styles.hint}>
                  触发式（默认）= 只在你点顶栏「完整」时启动；智能 = 充电且 WiFi 时后台预热；常备 = 开机就预热（更耗电）。
                </Text>
                <View style={styles.actions}>
                  {PREWARM_TIERS.map((tier) => (
                    <Btn
                      key={tier.id}
                      label={tier.label}
                      kind={state.prewarmTier === tier.id ? 'primary' : 'ghost'}
                      onPress={() => store.setPrewarmTier(tier.id)}
                      style={{ flex: 1 }}
                    />
                  ))}
                </View>

                <View style={styles.kv}>
                  <Text style={styles.k}>引擎</Text>
                  <Text style={styles.v}>{state.host?.engine ?? 'stopped'}</Text>
                </View>
                <View style={styles.kv}>
                  <Text style={styles.k}>桥</Text>
                  <Text style={styles.v}>
                    {(state.host?.bridge ?? 'stopped') + ' · :' + String(state.host?.port ?? 8788)}
                  </Text>
                </View>
                {host?.phase ? (
                  <Text style={styles.hint}>
                    {host.phase}
                    {(host.progress ?? 0) > 0 && (host.progress ?? 0) < 100 ? ` · ${host.progress}%` : ''}
                  </Text>
                ) : null}
                {state.host?.error ? <Text style={styles.error}>{state.host.error}</Text> : null}

                <View style={styles.actions}>
                  <Btn
                    label="预热完整引擎"
                    onPress={() => void store.warmLocalHost()}
                    disabled={engine.mode !== 'light' || engine.prootWarm}
                    style={{ flex: 1 }}
                  />
                  <Btn
                    label="停止 proot"
                    kind="ghost"
                    onPress={() => void store.reclaimProot('manual')}
                    disabled={!engine.prootWarm}
                    style={{ flex: 1 }}
                  />
                </View>
                <Btn
                  label={engine.mode === 'full' ? '切回轻引擎' : '切到完整引擎'}
                  onPress={() => void store.switchEngine(engine.mode === 'full' ? 'light' : 'full')}
                />

                <Text style={styles.hint}>启动命令（留空用默认：proot 里的 dsh + node 桥）</Text>
                <TextInput
                  style={styles.input}
                  value={state.hostEngineCmd}
                  onChangeText={(t) => store.setHostCommands(t, state.hostBridgeCmd)}
                  placeholder="引擎命令，例如 sh /data/local/tmp/engine.sh"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="引擎启动命令"
                />
                <TextInput
                  style={styles.input}
                  value={state.hostBridgeCmd}
                  onChangeText={(t) => store.setHostCommands(state.hostEngineCmd, t)}
                  placeholder="桥命令，可用 {token} 和 {port} 占位符"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="桥启动命令"
                />
                <View style={styles.kv}>
                  <Text style={styles.k}>后台保活</Text>
                  <Text style={[styles.v, batteryOk === false && { color: colors.warn }]}>
                    {batteryOk == null ? '未知' : batteryOk ? '已放行' : '受限制'}
                  </Text>
                </View>

                <View style={styles.actions}>
                  <Btn
                    label="刷新状态"
                    kind="ghost"
                    onPress={() => void store.refreshHost()}
                    style={{ flex: 1 }}
                  />
                  <Btn
                    label="看日志"
                    kind="ghost"
                    onPress={() => void store.refreshHostLogs()}
                    style={{ flex: 1 }}
                  />
                </View>
                <View style={styles.actions}>
                  <Btn
                    label="导出日志"
                    kind="ghost"
                    onPress={() => {
                      void (async () => {
                        const lines = await hostLogs();
                        await Share.share({
                          message: lines.slice(-300).join('\n') || '（暂无日志）',
                        }).catch(() => undefined);
                      })();
                    }}
                    style={{ flex: 1 }}
                  />
                  <Btn
                    label="保活设置"
                    kind="ghost"
                    onPress={() => void openHostBatterySettings()}
                    style={{ flex: 1 }}
                  />
                </View>
                <Btn
                  label="安全模式重启（重置 profiles）"
                  kind="ghost"
                  onPress={() => {
                    void (async () => {
                      await setHostSafeModeNext(true);
                      // 回收旧宿主，再重新切完整引擎（失败会自动回轻引擎）
                      await store.reclaimProot('manual');
                      await store.switchEngine('full');
                    })();
                  }}
                />

                {state.hostLogs.length > 0 ? (
                  <View style={styles.logBox}>
                    {state.hostLogs.slice(-14).map((line, i) => (
                      <Text key={i} style={styles.logLine} numberOfLines={2}>
                        {line}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={styles.hint}>当前是 Expo Go / web，起不了本机引擎；需要装原生构建的 APK。</Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>实验室 · M1</Text>
            <Text style={styles.hint}>
              L0 = 官方 web 界面（WebView，全部 web 插件原样）；L1 = just-bash 在 Hermes 上跑；
              轻引擎 = 进程内 agent loop（会话 / 流式 / 审批 / 提问 + 真实工作区）。
            </Text>
            {Platform.OS === 'web' ? (
              <Text style={styles.hint}>web 上不跑 WebView / just-bash / 轻引擎，请在 Android 真机试。</Text>
            ) : (
              <>
                <View style={styles.actions}>
                  <Btn label="打开完整界面" onPress={() => void openWebSurface()} style={{ flex: 1 }} />
                  <Btn label="just-bash 自检" kind="ghost" onPress={() => setLab('bash')} style={{ flex: 1 }} />
                </View>
                <View style={styles.actions}>
                  <Btn
                    label="轻引擎（工作区 + 模型）"
                    onPress={() => setLab('light')}
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            )}
            {labNote ? <Text style={styles.hint}>{labNote}</Text> : null}
          </View>

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

          <Text style={styles.footnote}>
            Key 和账号登录都写在宿主上。换手机只要重新配对，不用重配模型。
          </Text>

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
  logBox: {
    marginTop: 8,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  logLine: { color: colors.textDim, fontSize: 10.5, fontFamily: font.mono },

  root: { flex: 1, backgroundColor: colors.bg, paddingTop: topInset },
  bodyWrap: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '700' },
  scroll: { padding: space.lg, gap: 12, paddingBottom: space.xxl },
  card: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chevron: { color: colors.textFaint, fontSize: 12 },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  status: { color: colors.textFaint, fontSize: 11 },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  label: { color: colors.text, fontSize: 12, fontWeight: '500', marginTop: 2 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  phoneInput: {
    flex: 1,
    backgroundColor: colors.glassStrong,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 13,
  },
  input: {
    backgroundColor: colors.glassStrong,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 13,
  },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: 4 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  k: { color: colors.textDim, fontSize: 13 },
  v: { color: colors.text, fontSize: 13, fontWeight: '500' },
  footnote: { color: colors.textFaint, fontSize: 11.5, lineHeight: 17, paddingHorizontal: space.xs },
  error: { color: colors.danger, fontSize: 12, paddingHorizontal: space.xs },
});
