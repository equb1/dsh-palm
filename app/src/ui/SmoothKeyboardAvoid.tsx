import React from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  LayoutAnimation,
  Platform,
  StyleSheet,
  UIManager,
  type KeyboardEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  try {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  } catch {
    /* 忽略不支持的情况 */
  }
}

interface SmoothKeyboardAvoidProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  offset?: number;
}

/**
 * 智能键盘协同避让容器：
 * 1. 优先监听 keyboardWillShow，在键盘刚升起的第一毫秒同时启动动画，输入框与键盘同频同速升起。
 * 2. 针对 Android 系统 adjustResize 导致的高读突变，调用 LayoutAnimation 实现页面内容平滑过渡，消除生硬跳跃。
 * 3. 采用高质量缓动曲线（Easing.bezier），消除生硬感。
 */
export function SmoothKeyboardAvoid({ children, style, offset = 0 }: SmoothKeyboardAvoidProps): React.ReactElement {
  const keyboardHeight = React.useRef(new Animated.Value(0)).current;
  const currentKeyboardHeight = React.useRef(0);
  const initialLayoutHeight = React.useRef(0);
  const currentLayoutHeight = React.useRef(0);

  const onLayout = (e: LayoutChangeEvent): void => {
    const { height } = e.nativeEvent.layout;
    if (initialLayoutHeight.current === 0) {
      initialLayoutHeight.current = height;
    }
    const prev = currentLayoutHeight.current;
    currentLayoutHeight.current = height;

    // 当系统 resize 改变高度时，使用 LayoutAnimation 赋予内容平滑缩放过渡动画
    if (prev > 0 && Math.abs(prev - height) > 50) {
      LayoutAnimation.configureNext({
        duration: 250,
        update: { type: LayoutAnimation.Types.easeInEaseOut },
      });
    }

    // 如果系统原生已经 resize（容器高度减少了键盘高度），则无需叠加 paddingBottom
    if (currentKeyboardHeight.current > 0 && initialLayoutHeight.current > 0) {
      const heightDiff = initialLayoutHeight.current - height;
      if (heightDiff >= currentKeyboardHeight.current * 0.7) {
        keyboardHeight.setValue(0);
      }
    }
  };

  React.useEffect(() => {
    const handleShow = (e: KeyboardEvent, isWill: boolean): void => {
      const rawHeight = e.endCoordinates.height;
      currentKeyboardHeight.current = rawHeight;
      const target = Math.max(0, rawHeight - offset);

      // 如果系统已经通过 resize 缩减了容器高度，不需要叠加 padding
      if (initialLayoutHeight.current > 0 && currentLayoutHeight.current > 0) {
        const heightDiff = initialLayoutHeight.current - currentLayoutHeight.current;
        if (heightDiff >= rawHeight * 0.7) {
          keyboardHeight.setValue(0);
          return;
        }
      }

      const duration = e.duration && e.duration > 0 ? e.duration : Platform.OS === 'ios' ? 250 : 220;
      if (isWill) {
        // 与键盘同时启动动画，完全同频同速升起
        Animated.timing(keyboardHeight, {
          toValue: target,
          duration,
          easing: Easing.bezier(0.2, 0.8, 0.25, 1),
          useNativeDriver: false,
        }).start();
      } else {
        // didShow 时平缓完成剩余部分
        Animated.timing(keyboardHeight, {
          toValue: target,
          duration: 120,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }).start();
      }
    };

    const handleHide = (e: KeyboardEvent | undefined, isWill: boolean): void => {
      currentKeyboardHeight.current = 0;
      const duration = e?.duration && e.duration > 0 ? e.duration : Platform.OS === 'ios' ? 250 : 200;

      if (isWill) {
        Animated.timing(keyboardHeight, {
          toValue: 0,
          duration,
          easing: Easing.bezier(0.2, 0.8, 0.25, 1),
          useNativeDriver: false,
        }).start();
      } else {
        Animated.timing(keyboardHeight, {
          toValue: 0,
          duration: 120,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }).start();
      }
    };

    const willShowSub = Keyboard.addListener('keyboardWillShow', (e) => handleShow(e, true));
    const didShowSub = Keyboard.addListener('keyboardDidShow', (e) => handleShow(e, false));
    const willHideSub = Keyboard.addListener('keyboardWillHide', (e) => handleHide(e, true));
    const didHideSub = Keyboard.addListener('keyboardDidHide', (e) => handleHide(e, false));

    return () => {
      willShowSub.remove();
      didShowSub.remove();
      willHideSub.remove();
      didHideSub.remove();
    };
  }, [keyboardHeight, offset]);

  return (
    <Animated.View
      onLayout={onLayout}
      style={[styles.container, style, { paddingBottom: keyboardHeight }]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
