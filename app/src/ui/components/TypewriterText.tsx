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
  const [count, setCount] = React.useState(0);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    if (chars.length === 0) return;
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setCount(index);
      if (index >= chars.length) clearInterval(timer);
    }, speed);
    return () => clearInterval(timer);
  }, [active, chars, speed]);

  return (
    <Text style={style}>
      {chars.slice(0, count).join('')}
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
  const [count, setCount] = React.useState(0);
  const [erasing, setErasing] = React.useState(false);

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

  return (
    <Text style={style}>
      {Array.from(items[index] ?? '').slice(0, count).join('')}
      <Text style={{ color: palette.blue }}>|</Text>
    </Text>
  );
}
