import React from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { BrandIcon } from '../components/BrandIcon';
import { motion, radius, useTheme, useThemedStyles, type Theme } from '../theme';

/** 回到底部：出现/消失走弹簧；生成中箭头轻微上下浮动 + 蓝点提示。 */
export function JumpButton({
  visible,
  running,
  onPress,
}: {
  visible: boolean;
  running: boolean;
  onPress: () => void;
}): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const progress = React.useRef(new Animated.Value(visible ? 1 : 0)).current;
  const bob = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const animation = Animated.spring(progress, {
      toValue: visible ? 1 : 0,
      ...motion.spring.sheet,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [visible, progress]);

  React.useEffect(() => {
    if (!visible || !running) {
      bob.stopAnimation();
      bob.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [visible, running, bob]);

  const translateY = Animated.add(
    progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
    bob.interpolate({ inputRange: [0, 1], outputRange: [-2, 2] }),
  );

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.wrap,
        {
          opacity: progress,
          transform: [
            { translateY },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) },
          ],
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="回到底部"
        onPress={onPress}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <BrandIcon name="arrowDown" size={18} color={palette.textDim} strokeWidth={2} />
        {running ? <View style={styles.liveDot} /> : null}
      </Pressable>
    </Animated.View>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    wrap: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: c.headerSolid,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
      shadowColor: c.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    button: {
      flex: 1,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { opacity: 0.7 },
    liveDot: {
      position: 'absolute',
      top: 7,
      right: 7,
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.blue,
    },
  });
