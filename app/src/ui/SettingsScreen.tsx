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
} from '../lib/host';
import { ProvidersCard } from './ProvidersCard';
import { JustBashProbe } from './JustBashProbe';
import { LightEngineScreen } from './LightEngineScreen';
import { EngineScreen } from './EngineScreen';
import { WebSurface } from './WebSurface';
import { SettingsGroup, type SettingsRow } from './settings/SettingsTile';
import { loadAccountPhone, saveAccountPhone } from '../lib/accountPhone';

const REF = 'DEEPSEEK_API_KEY';

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
  /** U5：独立引擎页 */
  const [engineOpen, setEngineOpen] = React.useState(false);
  const [webUrl, setWebUrl] = React.useState<string | null>(null);
  const [labNote, setLabNote] = React.useState<string | null>(null);
  const [phone, setPhone] = React.useState('');
  const [phoneSaved, setPhoneSaved] = React.useState(false);
  /** U4：设置首页搜索与分组滚动定位 */
  const [query, setQuery] = React.useState('');
  const [notice, setNotice] = React.useState<string | null>(null);
  const scrollRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  const sectionY = React.useRef<Record<string, number>>({});
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

  const flash = (message: string): void => {
    setNotice(message);
    setTimeout(() => setNotice((current) => (current === message ? null : current)), 2600);
  };

  const scrollToSection = (id: string): void => {
    const y = sectionY.current[id];
    if (y == null) {
      flash('这个设置还在下面，先往下滑一点。');
      return;
    }
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  };

  const exportLogs = (): void => {
    void (async () => {
      const lines = await hostLogs();
      await Share.share({ message: lines.slice(-300).join('\n') || '（暂无日志）' }).catch(
        () => undefined,
      );
    })();
  };

  const lightModel = state.defaultModel?.model ?? '未配置';
  const providerCount = state.providers.length;
  const allGroups: Array<{ key: string; title: string; rows: SettingsRow[] }> = [
    {
      key: 'ai',
      title: 'AI',
      rows: [
        {
          id: 'account',
          title: 'DeepSeek 账号',
          value: signedIn ? '已登录' : waiting ? '登录中' : '未登录',
          icon: '人',
          tone: 'blue',
          warn: !signedIn,
          onPress: () => scrollToSection('account'),
        },
        {
          id: 'key',
          title: 'API Key（备选）',
          value: configured ? '已配置' : '未配置',
          icon: '钥',
          tone: 'blue',
          onPress: () => scrollToSection('key'),
        },
        {
          id: 'providers',
          title: '模型提供商',
          value: `${providerCount} 个`,
          icon: '模',
          tone: 'blue',
          hint: lightModel !== '未配置' ? `当前 ${lightModel}` : undefined,
          onPress: () => scrollToSection('providers'),
        },
      ],
    },
    {
      key: 'capability',
      title: '能力',
      rows: [
        {
          id: 'light-engine',
          title: '轻引擎渠道',
          value: lightModel,
          icon: '轻',
          tone: 'green',
          onPress: () => setLab('light'),
        },
        {
          id: 'full-engine',
          title: '完整引擎',
          value: hostAvailable ? hostLabel : '不支持',
          icon: '全',
          tone: 'green',
          warn: host?.engine === 'failed' || host?.bridge === 'failed',
          onPress: () => setEngineOpen(true),
        },
      ],
    },
    {
      key: 'appearance',
      title: '外观',
      rows: [
        {
          id: 'theme',
          title: '主题',
          value: '浅色',
          icon: '◐',
          tone: 'violet',
          onPress: () => flash('主题跟着官方浅色 token 走；深色主题在 U7 做。'),
        },
        {
          id: 'font',
          title: '对话字号',
          value: '标准',
          icon: 'A',
          tone: 'violet',
          onPress: () => flash('字号档在 U7 做；当前固定为官方标准字号。'),
        },
      ],
    },
    {
      key: 'general',
      title: '通用',
      rows: [
        {
          id: 'notify',
          title: '通知',
          value: '系统管理',
          icon: '铃',
          tone: 'amber',
          onPress: () => flash('通知权限由系统管理；会话完成/审批提醒已接原生通知。'),
        },
        {
          id: 'battery',
          title: '后台保活',
          value: batteryOk == null ? '未知' : batteryOk ? '已放行' : '受限制',
          icon: '电',
          tone: 'amber',
          warn: batteryOk === false,
          onPress: () => setEngineOpen(true),
        },
      ],
    },
    {
      key: 'host',
      title: '主机',
      rows: [
        {
          id: 'engine',
          title: '本机引擎',
          value: hostLabel,
          icon: '引',
          tone: 'slate',
          onPress: () => setEngineOpen(true),
        },
        {
          id: 'host-info',
          title: '宿主',
          value: state.caps?.host.name ?? '未连接',
          icon: '宿',
          tone: 'slate',
          onPress: () => scrollToSection('host'),
        },
        {
          id: 'lab',
          title: '实验室',
          value: '3 个入口',
          icon: '验',
          tone: 'slate',
          onPress: () => scrollToSection('lab'),
        },
      ],
    },
    {
      key: 'about',
      title: '帮助与关于',
      rows: [
        {
          id: 'version',
          title: '版本',
          value: state.caps?.host.engineVersion ?? '—',
          icon: 'v',
          tone: 'slate',
          onPress: () => flash(`引擎 ${state.caps?.host.engineVersion ?? '—'} · 轻引擎 0.1.0-light`),
        },
        {
          id: 'export',
          title: '导出宿主日志',
          icon: '⇪',
          tone: 'slate',
          hint: '最近 300 行，走系统分享',
          onPress: exportLogs,
        },
      ],
    },
  ];
  const q = query.trim().toLowerCase();
  const groups = allGroups
    .map((group) => ({
      ...group,
      rows: q
        ? group.rows.filter((row) =>
            `${row.title} ${row.value ?? ''} ${row.hint ?? ''}`.toLowerCase().includes(q),
          )
        : group.rows,
    }))
    .filter((group) => group.rows.length > 0);

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

  if (engineOpen) {
    return <EngineScreen onClose={() => setEngineOpen(false)} />;
  }
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
        <Text style={styles.title}>设置</Text>
        <View style={{ width: 36 }} />
      </View>

      <SmoothKeyboardAvoid style={styles.bodyWrap}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
          <View style={styles.searchBox}>
            <Text style={styles.searchGlyph}>⌕</Text>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="搜索设置"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="搜索设置"
            />
            {query.length > 0 ? (
              <Pressable accessibilityRole="button" onPress={() => setQuery('')} hitSlop={8}>
                <Text style={styles.searchClear}>×</Text>
              </Pressable>
            ) : null}
          </View>

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          {groups.map((group) => (
            <SettingsGroup key={group.key} title={group.title} rows={group.rows} />
          ))}
          {groups.length === 0 ? <Text style={styles.hint}>没找到匹配的设置项。</Text> : null}

          <Text style={styles.sectionLabel}>详细设置</Text>

          <View
            style={styles.card}
            onLayout={(event) => {
              sectionY.current.account = event.nativeEvent.layout.y;
            }}
          >
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

          <View
            style={styles.card}
            onLayout={(event) => {
              sectionY.current.key = event.nativeEvent.layout.y;
            }}
          >
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

          <View
            onLayout={(event) => {
              sectionY.current.providers = event.nativeEvent.layout.y;
            }}
          >
            <ProvidersCard />
          </View>

          <View
            style={styles.card}
            onLayout={(event) => {
              sectionY.current.lab = event.nativeEvent.layout.y;
            }}
          >
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

          <View
            style={styles.card}
            onLayout={(event) => {
              sectionY.current.host = event.nativeEvent.layout.y;
            }}
          >
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
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.glassStrong,
  },
  searchGlyph: { color: colors.textFaint, fontSize: 15 },
  searchInput: { flex: 1, color: colors.text, fontSize: 13, paddingVertical: 0 },
  searchClear: { color: colors.textFaint, fontSize: 16, paddingHorizontal: 2 },
  notice: { color: colors.textDim, fontSize: 12, lineHeight: 17, paddingHorizontal: space.xs },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: space.xs,
    marginTop: 4,
    letterSpacing: 0.2,
  },
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
