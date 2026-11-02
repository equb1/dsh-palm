/**
 * M1 实验室 · 轻引擎。
 *
 * 两件事放在一个页面里，因为它们回答的是同一个问题：「不用 proot，
 * 手机自己能不能干活」。
 *
 *  1. 工作区自检：just-bash 通过 IFileSystem 适配器操作真实目录；
 *  2. 轻引擎：进程内的 agent loop，连上之后主界面完全一样。
 */
import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  loadLightConfig,
  runWorkspaceSelfCheck,
  saveLightConfig,
  type LightEngineSetup,
  type WorkspaceSelfCheck,
} from '../lib/light';
import { DEEPSEEK_DEFAULT, normalizeSetup, setupProblem } from '../engine/light/config';
import { Btn, Card, IconButton, Mono, Pill } from './parts';
import { colors, font, radius, space, topInset } from './theme';
import { useStore, store } from './useStore';
import { SmoothKeyboardAvoid } from './SmoothKeyboardAvoid';

export function LightEngineScreen({ onClose }: { onClose: () => void }): React.ReactElement {
  const state = useStore();
  const [baseURL, setBaseURL] = React.useState(DEEPSEEK_DEFAULT.baseURL);
  const [model, setModel] = React.useState(DEEPSEEK_DEFAULT.model);
  const [apiKey, setApiKey] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);
  const [imageBaseURL, setImageBaseURL] = React.useState('');
  const [imageModel, setImageModel] = React.useState('');
  const [imageApiKey, setImageApiKey] = React.useState('');
  const [imageSize, setImageSize] = React.useState('1024x1024');
  const [note, setNote] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [check, setCheck] = React.useState<WorkspaceSelfCheck | null>(null);
  const [connecting, setConnecting] = React.useState(false);

  React.useEffect(() => {
    void loadLightConfig().then((config) => {
      if (!config) return;
      setBaseURL(config.baseURL);
      setModel(config.model);
      setApiKey(config.apiKey);
      if (config.imageBaseURL) setImageBaseURL(config.imageBaseURL);
      if (config.imageModel) setImageModel(config.imageModel);
      if (config.imageApiKey) setImageApiKey(config.imageApiKey);
      if (config.imageSize) setImageSize(config.imageSize);
    });
  }, []);

  const setup: LightEngineSetup = normalizeSetup({
    baseURL,
    model,
    apiKey,
    providerName: DEEPSEEK_DEFAULT.providerName,
    imageBaseURL,
    imageModel,
    imageApiKey,
    imageSize,
  });

  const runCheck = async (): Promise<void> => {
    if (checking) return;
    setChecking(true);
    setNote(null);
    try {
      const result = await runWorkspaceSelfCheck();
      setCheck(result);
      const failed = result.results.filter((item) => item.exitCode !== 0).length;
      setNote(
        failed === 0
          ? `${result.results.length} 条命令全部成功，共 ${result.totalMs}ms`
          : `${failed} 条命令失败，看下面的退出码`,
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  };

  const connect = async (): Promise<void> => {
    const problem = setupProblem(setup);
    if (problem) {
      setNote(problem);
      return;
    }
    setConnecting(true);
    setNote('正在创建工作区并连接…');
    await store.connectLight(setup);
    setConnecting(false);
    const snapshot = store.getSnapshot();
    if (snapshot.conn === 'connected' && snapshot.engineKind === 'light') {
      await saveLightConfig(setup);
      setNote('已连上轻引擎，回到主界面开始聊。');
      onClose();
    } else {
      setNote(snapshot.error ?? '连接失败');
    }
  };

  const fillDefault = (): void => {
    setBaseURL(DEEPSEEK_DEFAULT.baseURL);
    setModel(DEEPSEEK_DEFAULT.model);
  };

  const connected = state.conn === 'connected' && state.engineKind === 'light';

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回" onPress={onClose} />
        <Text style={styles.title}>M1 实验室 · 轻引擎</Text>
        <Pill style={{ marginLeft: 'auto' }}>
          <Text style={[styles.status, connected && { color: colors.ok }]}>
            {connected ? '已连接' : state.conn === 'connecting' ? '连接中' : '未连接'}
          </Text>
        </Pill>
      </View>

      <SmoothKeyboardAvoid style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Card>
            <View style={styles.rowTop}>
              <Text style={styles.cardTitle}>1 · 工作区自检</Text>
              <Pill>
                <Text style={styles.badge}>IFileSystem</Text>
              </Pill>
            </View>
            <Text style={styles.hint}>
              just-bash 通过 expo-file-system 适配器操作真实目录：建文件、读文件、递归 grep、再删掉。
              这就是 docs/25 里「下一步」那条 IFileSystem 适配。
            </Text>
            {check ? (
              <>
                <Mono style={styles.rootLabel}>{check.root}</Mono>
                <Text style={styles.hint}>
                  {check.kind} 后端 · {check.results.length} 条命令 · {check.totalMs}ms
                </Text>
              </>
            ) : null}
            <View style={styles.actions}>
              <Btn
                label={checking ? '运行中…' : '运行自检'}
                onPress={() => void runCheck()}
                disabled={checking}
                style={{ flex: 1 }}
              />
            </View>
            {check?.results.map((item, index) => (
              <View key={index} style={styles.result}>
                <Text style={styles.command}>{item.command}</Text>
                <View style={styles.kv}>
                  <Text style={styles.k}>{item.exitCode === 0 ? '成功' : '失败'}</Text>
                  <Text style={[styles.v, item.exitCode !== 0 && { color: colors.danger }]}>
                    {item.ms}ms · exit {item.exitCode}
                  </Text>
                </View>
                {item.out ? <Text style={styles.out}>{item.out}</Text> : null}
                {item.error ? <Text style={styles.errorText}>{item.error}</Text> : null}
              </View>
            ))}
          </Card>

          <Card>
            <View style={styles.rowTop}>
              <Text style={styles.cardTitle}>2 · 模型</Text>
              <Pill>
                <Text style={styles.badge}>OpenAI 兼容</Text>
              </Pill>
            </View>
            <Text style={styles.hint}>
              轻引擎自带 agent loop：会话 / 流式 / 审批 / 提问，工具是 bash + 读写文件 + 提问。
              Key 只存本机 SecureStore，不经过宿主。
            </Text>

            <Text style={styles.label}>Base URL</Text>
            <TextInput
              style={styles.input}
              value={baseURL}
              onChangeText={setBaseURL}
              placeholder="https://api.deepseek.com/v1"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="模型 Base URL"
            />

            <Text style={styles.label}>模型</Text>
            <TextInput
              style={styles.input}
              value={model}
              onChangeText={setModel}
              placeholder="deepseek-chat"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="模型名"
            />

            <Text style={styles.label}>API Key</Text>
            <View style={styles.keyRow}>
              <TextInput
                style={[styles.input, styles.keyInput]}
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="sk-…"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showKey}
                accessibilityLabel="API Key"
              />
              <Btn label={showKey ? '隐藏' : '显示'} kind="ghost" onPress={() => setShowKey((v) => !v)} />
            </View>

            <Text style={styles.hint}>
              手机端默认限额：单条命令 30s 超时、输出截断 24k 字符、循环/命令数有上限。
            </Text>
          </Card>

          <Card>
            <View style={styles.rowTop}>
              <Text style={styles.cardTitle}>3 · 生图（可选）</Text>
              <Pill>
                <Text style={styles.badge}>images/generations</Text>
              </Pill>
            </View>
            <Text style={styles.hint}>
              官方 DeepSeek 账号没有图像模型，要另配一个 OpenAI 兼容的生图渠道；不配的话
              generate_image 会直接说"没配置"，不会假装画了。三项要么全填，要么全空。
            </Text>

            <Text style={styles.label}>生图 Base URL</Text>
            <TextInput
              style={styles.input}
              value={imageBaseURL}
              onChangeText={setImageBaseURL}
              placeholder="https://api.openai.com/v1（可留空）"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="生图 Base URL"
            />

            <Text style={styles.label}>生图模型</Text>
            <TextInput
              style={styles.input}
              value={imageModel}
              onChangeText={setImageModel}
              placeholder="gpt-image-1 / flux-schnell …（可留空）"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="生图模型"
            />

            <Text style={styles.label}>生图 API Key</Text>
            <TextInput
              style={styles.input}
              value={imageApiKey}
              onChangeText={setImageApiKey}
              placeholder="sk-…（可留空）"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              accessibilityLabel="生图 API Key"
            />

            <Text style={styles.label}>尺寸</Text>
            <TextInput
              style={styles.input}
              value={imageSize}
              onChangeText={setImageSize}
              placeholder="1024x1024"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="生图尺寸"
            />
          </Card>

          <View style={styles.actions}>
            <Btn label="填入 DeepSeek 默认" kind="ghost" onPress={fillDefault} style={{ flex: 1 }} />
            <Btn
              label={connecting ? '连接中…' : '连接轻引擎'}
              onPress={() => void connect()}
              disabled={connecting || Platform.OS === 'web'}
              style={{ flex: 1.2 }}
            />
          </View>
          {Platform.OS === 'web' ? (
            <Text style={styles.hint}>web 上没有真实工作区，请在 Android 真机上试。</Text>
          ) : null}

          {note ? <Text style={styles.note}>{note}</Text> : null}

          <Text style={styles.footer}>
            连接后主界面不变：会话、流式、审批、提问都走同一份协议。工具：bash / read_file /
            write_file / list_dir / create_docx / create_xlsx / read_docx / read_xlsx /
            generate_image / ask_user_question。
          </Text>
        </ScrollView>
      </SmoothKeyboardAvoid>
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
  status: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  scroll: { padding: space.lg, gap: 12, paddingBottom: space.xxl },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  label: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  input: {
    minHeight: 42,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 14,
  },
  keyRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  keyInput: { flex: 1 },
  rootLabel: { color: colors.textDim, fontFamily: font.mono, fontSize: 11 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: 4 },
  result: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    padding: space.sm,
    gap: 4,
  },
  command: { color: colors.text, fontFamily: font.mono, fontSize: 11.5 },
  kv: { flexDirection: 'row', justifyContent: 'space-between' },
  k: { color: colors.textDim, fontSize: 11 },
  v: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  out: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
    backgroundColor: colors.glass,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  errorText: { color: colors.danger, fontFamily: font.mono, fontSize: 11 },
  note: { color: colors.textDim, fontSize: 12, paddingHorizontal: 2 },
  footer: { color: colors.textFaint, fontSize: 11.5, lineHeight: 17, paddingHorizontal: 2 },
});
