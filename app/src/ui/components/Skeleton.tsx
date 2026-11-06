import React from 'react';
import { Animated, StyleSheet, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { motion, radius as radiusToken, useThemedStyles, type Theme } from '../theme';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  cornerRadius?: number;
  style?: StyleProp<ViewStyle>;
}

/** 占位骨架：呼吸式透明度，列表/详情加载时先占位再换内容 */
export function Skeleton({
  width = '100%',
  height = 12,
  cornerRadius = radiusToken.sm,
  style,
}: SkeletonProps): React.ReactElement {
  const styles = useThemedStyles(createStyles);
  const opacity = React.useRef(new Animated.Value(0.45)).current;

  React.useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.8,
          duration: motion.duration.breathing,
          easing: motion.easing.emphasis,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: motion.duration.breathing,
          easing: motion.easing.emphasis,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[styles.base, { width, height, borderRadius: cornerRadius, opacity }, style]}
    />
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    base: { backgroundColor: c.skeleton },
  });
