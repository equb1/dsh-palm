import React from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { motion, useTheme } from '../theme';

/**
 * 底部弹层：遮罩原地淡入，面板单独从底部弹簧滑出。
 *
 * 旧实现用 `<Modal animationType="slide">`，遮罩和面板一起被推上来，观感
 * 廉价，而且面板首次挂载和动画同帧。这里把两者拆开，仍然只跑原生动画。
 */
export function BottomSheet({
  visible,
  onClose,
  children,
  sheetStyle,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  sheetStyle?: StyleProp<ViewStyle>;
}): React.ReactElement | null {
  const { height } = useWindowDimensions();
  const { palette } = useTheme();
  const [render, setRender] = React.useState(visible);
  const renderRef = React.useRef(render);
  renderRef.current = render;
  const progress = React.useRef(new Animated.Value(visible ? 1 : 0)).current;
  const animationRef = React.useRef<Animated.CompositeAnimation | null>(null);

  React.useEffect(() => {
    if (visible) {
      setRender(true);
      progress.setValue(0);
      const frame = requestAnimationFrame(() => {
        animationRef.current?.stop();
        animationRef.current = Animated.spring(progress, {
          toValue: 1,
          ...motion.spring.sheet,
          useNativeDriver: true,
        });
        animationRef.current.start();
      });
      return () => cancelAnimationFrame(frame);
    }
    if (!renderRef.current) return;
    animationRef.current?.stop();
    animationRef.current = Animated.spring(progress, {
      toValue: 0,
      ...motion.spring.sheet,
      useNativeDriver: true,
    });
    animationRef.current.start(({ finished }) => {
      if (finished) setRender(false);
    });
    return () => animationRef.current?.stop();
  }, [visible, progress]);

  if (!render) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: palette.backdrop, opacity: progress },
          ]}
        >
          <Pressable
            style={{ flex: 1 }}
            accessibilityLabel="关闭弹层"
            onPress={onClose}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            sheetStyle,
            {
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [Math.max(420, height * 0.7), 0],
                  }),
                },
              ],
            },
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
