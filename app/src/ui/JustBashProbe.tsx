/**
 * 实验室：just-bash 在 Hermes 上的真实表现。
 *
 * 这是 M1 的第一个未知数（R2）：1.2MB 的 browser bundle 在手机 JS 引擎里能不能跑、
 * 跑常用命令要多久。结果同时打到 logcat（`adb logcat -s ReactNativeJS`）方便取数。
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import '../lib/polyfills';
import { Btn, IconButton } from './parts';
import { colors, font, radius, space, topInset } from './theme';

interface ProbeResult {
  command: string;
  ms: number;
  exitCode: number;
  out: string;
  error?: string;
}

/** 覆盖：空命令 / 管道 / 控制流 / 重定向+文件 / 吞吐 / sed / 目录 */
const CASES: string[] = [
  'echo hello',
  'printf "a\\nb\\nc\\n" | grep b',
  'for i in 1 2 3; do echo "n=$i"; done',
  'mkdir -p /tmp/d && echo hi > /tmp/d/f.txt && cat /tmp/d/f.txt',
  "seq 1 100000 | awk '{s+=$1} END {print s}'",
  "seq 1 50000 | sed -n '1,3p'",
  'ls /',
];

export function JustBashProbe({ onClose }: { onClose: () => void }): React.ReactElement {
  const [results, setResults] = React.useState<ProbeResult[]>([]);
  const [running, setRunning] = React.useState(false);
  const [status, setStatus] = React.useState('点「运行」开始');

  const run = async (): Promise<void> => {
    if (running) return;
    setRunning(true);
    setResults([]);
    setStatus('加载 just-bash…');
    try {
      const { Bash } = await import('just-bash/browser');
      setStatus('创建 Bash 实例…');
      const bash = new Bash();
      const list: ProbeResult[] = [];
      for (const command of CASES) {
        const started = Date.now();
        try {
          const result = await bash.exec(command);
          list.push({
            command,
            ms: Date.now() - started,
            exitCode: result.exitCode,
            out: (result.stdout ?? '').slice(0, 200).trimEnd(),
            error: result.stderr ? result.stderr.slice(0, 200).trimEnd() : undefined,
          });
        } catch (error) {
          list.push({
            command,
            ms: Date.now() - started,
            exitCode: -1,
            out: '',
            error: error instanceof Error ? error.message : String(error),
          });
        }
        setResults([...list]);
      }
      console.log('[justbash] ' + JSON.stringify(list));
      setStatus(`完成 ${list.length} 条`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('[justbash] FAILED ' + message);
      setStatus('失败：' + message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton glyph="‹" label="返回" onPress={onClose} />
        <Text style={styles.title}>just-bash 自检（实验室）</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.hint}>在 Hermes 里加载 just-bash 浏览器包，跑 7 条命令并计时。</Text>
          <View style={styles.actions}>
            <Btn label={running ? '运行中…' : '运行'} onPress={() => void run()} disabled={running} style={{ flex: 1 }} />
            <Btn label="清空" kind="ghost" onPress={() => setResults([])} disabled={running} style={{ flex: 1 }} />
          </View>
          <Text style={styles.status}>{status}</Text>
        </View>

        {results.map((item, index) => (
          <View key={index} style={styles.card}>
            <Text style={styles.command}>{item.command}</Text>
            <View style={styles.kv}>
              <Text style={styles.k}>耗时</Text>
              <Text style={[styles.v, item.ms > 1000 && { color: colors.warn }]}>{item.ms} ms</Text>
            </View>
            <View style={styles.kv}>
              <Text style={styles.k}>退出码</Text>
              <Text style={[styles.v, item.exitCode !== 0 && { color: colors.danger }]}>{item.exitCode}</Text>
            </View>
            {item.out ? <Text style={styles.out}>{item.out}</Text> : null}
            {item.error ? <Text style={styles.error}>{item.error}</Text> : null}
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
  scroll: { padding: space.lg, gap: 12, paddingBottom: space.xxl },
  card: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
  },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  status: { color: colors.textDim, fontSize: 12 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: 4 },
  command: { color: colors.text, fontSize: 12.5, fontFamily: font.mono },
  kv: { flexDirection: 'row', justifyContent: 'space-between' },
  k: { color: colors.textDim, fontSize: 12 },
  v: { color: colors.text, fontSize: 12, fontWeight: '600' },
  out: {
    color: colors.textDim,
    fontSize: 11.5,
    fontFamily: font.mono,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  error: { color: colors.danger, fontSize: 11.5, fontFamily: font.mono },
});
