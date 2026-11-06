import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { humanizeError } from '../../lib/errors';
import type { WebFrontendTarget } from '../../lib/webFrontend';
import { Btn, IconButton } from '../parts';
import { JustBashProbe } from '../JustBashProbe';
import { LightEngineScreen } from '../LightEngineScreen';
import { SmoothKeyboardAvoid } from '../SmoothKeyboardAvoid';
import { store, useStore } from '../useStore';
import { radius, space, topInset, useThemedStyles, type Theme } from '../theme';
import { WebSurface } from '../WebSurface';

/**
 * U4 二级页：实验室。
 *
 * 从设置首页的实验室卡搬来：打开完整界面 / just-bash 自检 / 轻引擎入口。
 * 三个实验入口的路由留在这一页；关闭它们回到这里，再按 header 的 ‹ 回设置首页。
 */
export function LabScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  const state = useStore();
  /** 实验室：L0（WebView 官方前端）/ L1（just-bash 前置）两个 spike */
  const [lab, setLab] = React.useState<'none' | 'web' | 'bash' | 'light'>('none');
  const [webTarget, setWebTarget] = React.useState<WebFrontendTarget | null>(null);
  const [openingWeb, setOpeningWeb] = React.useState(false);
  const [labNote, setLabNote] = React.useState<string | null>(null);

  const openWebSurface = async (withCurrentSession: boolean): Promise<void> => {
    setLabNote(null);
    setOpeningWeb(true);
    try {
      // 地址/token 由完整引擎的 web.session 下发；token 只在本机 loopback 可用
      const target = await store.getWebFrontendTarget({
        sessionId: withCurrentSession ? state.currentId : null,
      });
      setWebTarget(target);
      setLab('web');
    } catch (error) {
      setLabNote(`打不开官方前端：${humanizeError(error)}`);
    } finally {
      setOpeningWeb(false);
    }
  };

  if (lab === 'bash') {
    return <JustBashProbe onClose={() => setLab('none')} />;
  }
  if (lab === 'light') {
    return <LightEngineScreen onClose={() => setLab('none')} />;
  }
  if (lab === 'web' && webTarget) {
    return (
      <WebSurface
        target={webTarget}
        onClose={() => {
          setLab('none');
          setWebTarget(null);
        }}
        onReload={() =>
          store.getWebFrontendTarget({ sessionId: webTarget.sessionId ?? null })
        }
        onOpenSession={async (sessionId, engine) => {
          const result = await store.openSessionFromWebView(sessionId, engine);
          if (result.ok) {
            setLab('none');
            setWebTarget(null);
          }
          return result;
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回设置" onPress={onClose} />
        <Text style={styles.title}>实验室</Text>
        <View style={{ width: 36 }} />
      </View>

      <SmoothKeyboardAvoid style={styles.body}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>实验室 · M1</Text>
            <Text style={styles.hint}>
              L0 = 官方 web 界面（WebView，全部 web 插件原样）；L1 = just-bash 在 Hermes 上跑；
              轻引擎 = 进程内 agent loop（会话 / 流式 / 审批 / 提问 + 真实工作区）。
              WebView 里点会话会切回 App；「当前会话」会尽量定位到同一条完整会话。
            </Text>
            {Platform.OS === 'web' ? (
              <Text style={styles.hint}>web 上不跑 WebView / just-bash / 轻引擎，请在 Android 真机试。</Text>
            ) : (
              <>
                <View style={styles.actions}>
                  <Btn
                    label={openingWeb ? '获取地址…' : '打开完整界面'}
                    onPress={() => void openWebSurface(false)}
                    disabled={openingWeb}
                    style={{ flex: 1 }}
                  />
                  <Btn
                    label="just-bash 自检"
                    kind="ghost"
                    onPress={() => setLab('bash')}
                    disabled={openingWeb}
                    style={{ flex: 1 }}
                  />
                </View>
                <View style={styles.actions}>
                  <Btn
                    label="当前会话（WebView）"
                    kind="ghost"
                    onPress={() => void openWebSurface(true)}
                    disabled={openingWeb}
                    style={{ flex: 1 }}
                  />
                  <Btn
                    label="轻引擎（工作区 + 模型）"
                    onPress={() => setLab('light')}
                    disabled={openingWeb}
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            )}
            {labNote ? <Text style={styles.hint}>{labNote}</Text> : null}
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
    actions: { flexDirection: 'row', gap: space.sm, marginTop: 4 },
  });
