import React from 'react';
import { Animated, StyleSheet } from 'react-native';

import { motion } from '../theme';

/**
 * U7 动效：页面切换淡入。
 *
 * 只做 opacity（useNativeDriver），不改布局；`trigger` 变化时从 0 到 1，
 * 时长/曲线用 theme.motion 的官方 token。
 */
export function ScreenFade({
  children,
  trigger,
}: {
  children: React.ReactNode;
  trigger: string;
}): React.ReactElement {
  const opacity = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    opacity.setValue(0);
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: motion.duration.base,
      easing: motion.easing.standard,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [trigger, opacity]);

  return <Animated.View style={[styles.fill, { opacity }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
