import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { store, useStore } from './useStore';
import { IconButton } from './parts';
import { colors, font, radius, space, topInset } from './theme';

interface Entry {
  id: number;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
  timedOut: boolean;
  truncated: boolean;
}

const QUICK = ['pwd', 'ls', 'ls docs', 'cat README.md'] as const;

/** U8 只读终端：可以 ls/cat/grep，写操作被沙箱拒绝；不经过审批，所以只给读 */
export function TerminalScreen(): React.ReactElement {
  const state = useStore();
  const [command, setCommand] = React.useState('');
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const seq = React.useRef(0);

  const run = async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!text || running) return;
    setRunning(true);
    setError(null);
    try {
      const result = await store.runShell(text);
      const entry: Entry = { id: ++seq.current, command: text, ...result };
      setEntries((prev) => [...prev, entry].slice(-30));
      setCommand('');
    } catch (err) {
      setError(
        `终端不可用：${err instanceof Error ? err.message : String(err)}。完整引擎暂不支持，切回轻引擎再试。`,
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回" onPress={() => store.closeTerminal()} />
        <Text style={styles.title}>终端</Text>
        <Text style={styles.badge}>只读</Text>
        <IconButton
          glyph="⌫"
          label="清空输出"
          size={32}
          onPress={() => {
            setEntries([]);
            setError(null);
          }}
        />
      </View>

      <ScrollView
        style={styles.output}
        contentContainerStyle={styles.outputContent}
        keyboardShouldPersistTaps="handled"
      >
        {entries.length === 0 ? (
          <Text style={styles.hint}>
            只读终端：可以 `pwd`、`ls`、`cat`、`grep`；写文件/删除会被沙箱拒绝。
            会话里的 bash 仍走审批，这里不经过审批，所以只给读。
          </Text>
        ) : null}
        {entries.map((entry) => (
          <View key={entry.id} style={styles.entry}>
            <Text style={styles.commandLine}>
              <Text style={styles.prompt}>$ </Text>
              {entry.command}
            </Text>
            {entry.stdout ? <Text style={styles.stdout}>{entry.stdout}</Text> : null}
            {entry.stderr ? <Text style={styles.stderr}>{entry.stderr}</Text> : null}
            <Text style={styles.meta}>
              exit {entry.exitCode} · {entry.ms}ms
              {entry.timedOut ? ' · 超时' : ''}
              {entry.truncated ? ' · 输出截断' : ''}
            </Text>
          </View>
        ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.quickRow}>
        {QUICK.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityLabel={`运行 ${item}`}
            onPress={() => void run(item)}
            style={styles.quickPill}
          >
            <Text style={styles.quickText}>{item}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.inputRow}>
        <Text style={styles.prompt}>$</Text>
        <TextInput
          style={styles.input}
          value={command}
          onChangeText={setCommand}
          placeholder="只读命令，例如 ls /workspace"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="终端命令"
          onSubmitEditing={() => void run(command)}
          editable={!running}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="运行命令"
          disabled={running || command.trim().length === 0}
          onPress={() => void run(command)}
          style={[styles.runBtn, (running || !command.trim()) && styles.runBtnDisabled]}
        >
          {running ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.runText}>运行</Text>
          )}
        </Pressable>
      </View>
      <Text style={styles.footnote}>
        工作区 {state.workspaces[0]?.root ?? '/workspace'} · 15s 超时 · 输出最多 20k
      </Text>
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
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  badge: {
    color: colors.textFaint,
    fontSize: 10.5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  output: { flex: 1 },
  outputContent: { padding: space.lg, gap: space.md, paddingBottom: space.lg },
  hint: { color: colors.textFaint, fontSize: 12.5, lineHeight: 19 },
  entry: { gap: 4 },
  commandLine: { color: colors.text, fontSize: 12.5, fontFamily: font.mono, lineHeight: 18 },
  prompt: { color: colors.blue, fontSize: 12.5, fontFamily: font.mono },
  stdout: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: font.mono,
    backgroundColor: colors.glass,
    borderRadius: radius.sm,
    padding: 8,
  },
  stderr: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: font.mono,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    padding: 8,
  },
  meta: { color: colors.textFaint, fontSize: 10, fontFamily: font.mono },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: space.lg,
    paddingBottom: 6,
  },
  quickPill: {
    backgroundColor: colors.glass,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  quickText: { color: colors.textDim, fontSize: 11, fontFamily: font.mono },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: space.lg,
    paddingHorizontal: 12,
    minHeight: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.glassStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  input: { flex: 1, color: colors.text, fontSize: 13, fontFamily: font.mono, paddingVertical: 8 },
  runBtn: {
    backgroundColor: colors.blue,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 56,
    alignItems: 'center',
  },
  runBtnDisabled: { opacity: 0.5 },
  runText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '600' },
  footnote: {
    color: colors.textFaint,
    fontSize: 10.5,
    paddingHorizontal: space.lg,
    paddingTop: 6,
    paddingBottom: space.lg,
  },
});
