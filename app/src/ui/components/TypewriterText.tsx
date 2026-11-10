import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { ScreenActiveContext } from '../useStore';
import { useTheme } from '../theme';

/** 首页标题：从空到全文打一遍，保留光标。 */
export function TypewriterText({
  text,
  speed = 45,
  style,
  caret = true,
}: {
  text: string;
  speed?: number;
  style?: StyleProp<TextStyle>;
  caret?: boolean;
}): React.ReactElement {
  const { palette } = useTheme();
  const active = React.useContext(ScreenActiveContext);
  const chars = React.useMemo(() => Array.from(text), [text]);
  // 非活动页直接显示全文；活动页才从头打一遍。
  // 不能用 ref 做“只跑一次”的锁：effect 被 StrictMode / 页面栈清理后重跑时，
  // 锁会把定时器永久挡掉，最后只剩光标。
  const [count, setCount] = React.useState(active ? 0 : chars.length);

  React.useEffect(() => {
    if (!active) {
      setCount(chars.length);
      return;
    }
    setCount(0);
    if (chars.length === 0) return;
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setCount(Math.min(index, chars.length));
      if (index >= chars.length) clearInterval(timer);
    }, speed);
    return () => clearInterval(timer);
  }, [active, chars, speed]);

  const shown = count >= chars.length ? text : chars.slice(0, count).join('');

  return (
    <Text style={style}>
      {shown}
      {caret && count < chars.length ? (
        <Text style={{ color: palette.blue }}>|</Text>
      ) : null}
    </Text>
  );
}

/** 首页副标题：输入 → 停留 → 退格 → 下一句。 */
export function RotatingHint({
  items,
  style,
}: {
  items: readonly string[];
  style?: StyleProp<TextStyle>;
}): React.ReactElement {
  const { palette } = useTheme();
  const active = React.useContext(ScreenActiveContext);
  const [index, setIndex] = React.useState(0);
  const current = Array.from(items[index] ?? '');
  const [count, setCount] = React.useState(active ? 0 : current.length);
  const [erasing, setErasing] = React.useState(false);

  // 非活动页显示当前句子全文，绝不留下空白/只有光标
  React.useEffect(() => {
    if (!active) {
      setCount(current.length);
      setErasing(false);
    }
    // current 每次渲染都是新数组，这里只跟随句子下标与活动态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index]);

  React.useEffect(() => {
    if (!active) return;
    const chars = Array.from(items[index] ?? '');
    if (!erasing && count < chars.length) {
      const timer = setTimeout(() => setCount((value) => value + 1), 42);
      return () => clearTimeout(timer);
    }
    if (!erasing) {
      const timer = setTimeout(() => setErasing(true), 2600);
      return () => clearTimeout(timer);
    }
    if (count > 0) {
      const timer = setTimeout(() => setCount((value) => value - 1), 18);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      setErasing(false);
      setIndex((value) => (value + 1) % Math.max(items.length, 1));
    }, 220);
    return () => clearTimeout(timer);
  }, [active, count, erasing, index, items]);

  const text = active
    ? Array.from(items[index] ?? '').slice(0, count).join('')
    : (items[index] ?? '');

  return (
    <Text style={style}>
      {text}
      {active ? <Text style={{ color: palette.blue }}>|</Text> : null}
    </Text>
  );
}
