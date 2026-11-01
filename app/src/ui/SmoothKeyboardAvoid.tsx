import React from 'react';
import {
  Animated,
  Keyboard,
  Platform,
  StyleSheet,
  type KeyboardEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface SmoothKeyboardAvoidProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  offset?: number;
}

/**
 * 智能键盘协同避让容器：
 * 1. 优先监听 keyboardWillShow，在键盘刚升起的第一毫秒同时启动动画，输入框与键盘同频同速升起。
 * 2. 避免 keyboardDidShow 延迟导致的“键盘先出来、输入框过一会才出现”的问题；若仅收到 didShow，直接零延迟就位。
 * 3. 在 Android 上与系统 adjustResize 智能互补，若系统已缩小窗口则不重复叠加，杜绝抖动与脱节。
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
    currentLayoutHeight.current = height;

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

      if (isWill) {
        // 与键盘同时启动动画，完全同频同速升起
        const duration = e.duration && e.duration > 0 ? e.duration : Platform.OS === 'ios' ? 250 : 200;
        Animated.timing(keyboardHeight, {
          toValue: target,
          duration,
          useNativeDriver: false,
        }).start();
      } else {
        // didShow 到达时，键盘已经完全出来了，立即零延迟就位，杜绝慢半拍爬升
        keyboardHeight.setValue(target);
      }
    };

    const handleHide = (e: KeyboardEvent | undefined, isWill: boolean): void => {
      currentKeyboardHeight.current = 0;

      if (isWill) {
        const duration = e?.duration && e.duration > 0 ? e.duration : Platform.OS === 'ios' ? 250 : 200;
        Animated.timing(keyboardHeight, {
          toValue: 0,
          duration,
          useNativeDriver: false,
        }).start();
      } else {
        keyboardHeight.setValue(0);
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
