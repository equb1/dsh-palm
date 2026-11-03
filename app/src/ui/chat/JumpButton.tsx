import React from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme';

/** 回到底部：生成中边框做呼吸/跑马灯，结束后静态 */
export function JumpButton({ running, onPress }: { running: boolean; onPress: () => void }): React.ReactElement {
  const pulse = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!running) {
      pulse.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [running, pulse]);

  const borderColor = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.borderStrong, colors.blue],
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="回到底部"
      onPress={onPress}
      style={styles.wrap}
    >
      <Animated.View style={[styles.ring, { borderColor }]} />
      <Text style={styles.arrow}>↓</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: 21,
    borderWidth: 2,
  },
  arrow: { color: colors.textDim, fontSize: 16, lineHeight: 18 },
});
