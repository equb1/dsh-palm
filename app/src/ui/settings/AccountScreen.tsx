import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { store, useStore } from '../useStore';
import { Btn, IconButton, Pill } from '../parts';
import { SmoothKeyboardAvoid } from '../SmoothKeyboardAvoid';
import { radius, space, topInset, useTheme, useThemedStyles, type Theme } from '../theme';
import { loadAccountPhone, saveAccountPhone } from '../../lib/accountPhone';

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
    case 'cancelled':
      return '已取消授权；需要时重新点一次登录';
    default:
      return null;
  }
}

/**
 * U4 二级页：DeepSeek 账号。
 *
 * 从设置首页的账号卡搬来：手机号 / 登录状态 / 重新登录 / 退出 / 用量 /
 * 等待授权时的重开与取消。账号状态刷新与等待轮询只在这个页面跑。
 */
export function AccountScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const state = useStore();
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [phone, setPhone] = React.useState('');
  const [phoneSaved, setPhoneSaved] = React.useState(false);

  React.useEffect(() => {
    void loadAccountPhone().then(setPhone);
  }, []);

  const account = state.account;
  const accountAttempt = account?.attempt;
  const signedIn = account?.status === 'credential-stored';
  const waiting = accountAttempt?.phase === 'waiting-browser' || accountAttempt?.phase === 'initializing';
  const accountNote = attemptText(accountAttempt?.phase, accountAttempt?.errorCode);

  // 账号：进页面拉一次；有登录尝试时 1 秒一次（真引擎的授权页要等宿主生成）
  React.useEffect(() => {
    if (!state.caps) return;
    void store.refreshAccount();
  }, [state.caps]);

  React.useEffect(() => {
    if (!accountAttempt || !waiting) return;
    const timer = setInterval(() => void store.refreshAccount(), 1000);
    return () => clearInterval(timer);
  }, [accountAttempt?.id, waiting]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回设置" onPress={onClose} />
        <Text style={styles.title}>DeepSeek 账号</Text>
        <View style={{ width: 36 }} />
      </View>

      <SmoothKeyboardAvoid style={styles.body}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            <View style={styles.rowTop}>
              <Text style={styles.cardTitle}>DeepSeek 账号</Text>
              <Pill>
                <Text style={[styles.status, signedIn && { color: palette.ok }]}>
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
                placeholderTextColor={palette.textFaint}
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
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardTitle: { color: c.text, fontSize: 14, fontWeight: '600' },
    status: { color: c.textFaint, fontSize: 11 },
    hint: { color: c.textDim, fontSize: 12, lineHeight: 17 },
    label: { color: c.text, fontSize: 12, fontWeight: '500', marginTop: 2 },
    phoneRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    phoneInput: {
      flex: 1,
      backgroundColor: c.glassStrong,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: c.text,
      fontSize: 13,
    },
    actions: { flexDirection: 'row', gap: space.sm, marginTop: 4 },
    error: { color: c.danger, fontSize: 12, paddingHorizontal: space.xs },
  });
