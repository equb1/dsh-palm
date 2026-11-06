import React from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';

import { motion } from '../theme';
import { ScreenActiveContext } from '../useStore';

/**
 * 轻量页面栈（U7 动效重做）。
 *
 * 旧实现是 ScreenFade：只有一个容器，切页时旧页瞬间卸载、新页先画一帧再
 * opacity.setValue(0)，视觉上就是“闪一下/雪花”。这里改成真正的栈：
 *  - 前进：新页从右侧滑入，旧页左移 24% + 轻微压暗，保留挂载；
 *  - 返回：当前页向右滑出，目标页从 -24% 回到 0，滚回原来的滚动位置；
 *  - 只动 translateX/opacity，全部 useNativeDriver。
 *
 * 非当前页用 ScreenActiveContext 冻结 useStore 订阅，避免详情页流式输出时
 * 底下首页/设置页跟着重渲染。
 */

interface PageEntry {
  key: string;
  depth: number;
  node: React.ReactNode;
}

interface Transition {
  targetIndex: number;
  fromIndex: number;
  direction: 'forward' | 'back';
}

export function ScreenStack({
  screenKey,
  depth,
  children,
}: {
  screenKey: string;
  depth: number;
  children: React.ReactNode;
}): React.ReactElement {
  const { width } = useWindowDimensions();
  const [stack, setStack] = React.useState<PageEntry[]>([
    { key: screenKey, depth, node: children },
  ]);
  const [transition, setTransition] = React.useState<Transition | null>(null);
  const stackRef = React.useRef(stack);
  stackRef.current = stack;
  const transitionRef = React.useRef<Transition | null>(transition);
  transitionRef.current = transition;
  const childRef = React.useRef(children);
  childRef.current = children;
  const progress = React.useRef(new Animated.Value(1)).current;
  const animationRef = React.useRef<Animated.CompositeAnimation | null>(null);
  const widthRef = React.useRef(width);
  widthRef.current = width;

  React.useLayoutEffect(() => {
    const current = stackRef.current;
    const index = current.findIndex((page) => page.key === screenKey);
    if (index === current.length - 1) return;

    // 上一次转场还没完就再次切页：先收口，避免两个 outgoing 叠在一起。
    animationRef.current?.stop();
    let base = current;
    const active = transitionRef.current;
    if (active) {
      base = active.direction === 'back' ? current.slice(0, active.targetIndex + 1) : current;
      setTransition(null);
    }

    let nextStack: PageEntry[];
    let targetIndex: number;
    let fromIndex: number;
    let direction: 'forward' | 'back';

    const existing = base.findIndex((page) => page.key === screenKey);
    if (existing >= 0 && existing < base.length - 1) {
      const outgoing = base[base.length - 1]!;
      nextStack = [...base.slice(0, existing + 1), outgoing];
      targetIndex = existing;
      fromIndex = nextStack.length - 1;
      direction = 'back';
    } else if (existing >= 0) {
      // 已经是顶层，不需要转场
      setStack(base);
      return;
    } else {
      nextStack = [...base, { key: screenKey, depth, node: childRef.current }];
      targetIndex = nextStack.length - 1;
      fromIndex = Math.max(0, targetIndex - 1);
      direction = 'forward';
    }

    setStack(nextStack);
    const nextTransition: Transition = { targetIndex, fromIndex, direction };
    setTransition(nextTransition);
    progress.setValue(0);

    const animation = Animated.spring(progress, {
      toValue: 1,
      ...motion.spring.page,
      useNativeDriver: true,
    });
    animationRef.current = animation;
    const frame = requestAnimationFrame(() => {
      animation.start(({ finished }) => {
        if (!finished) return;
        animationRef.current = null;
        setTransition(null);
        if (direction === 'back') {
          setStack(nextStack.slice(0, targetIndex + 1));
        }
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      animation.stop();
    };
  }, [screenKey, depth, progress]);

  const activeIndex = transition ? transition.targetIndex : stack.length - 1;

  return (
    <View style={styles.fill}>
      {stack.map((page, index) => {
        const isActive = index === activeIndex;
        const isTarget = transition ? index === transition.targetIndex : index === stack.length - 1;
        const isOutgoing = transition ? index === transition.fromIndex : false;
        const visiblePage = isActive || (transition !== null && (isTarget || isOutgoing));
        const node = isActive ? children : page.node;

        let translateX: Animated.AnimatedInterpolation<number> | number = 0;
        if (transition) {
          if (isTarget) {
            translateX =
              transition.direction === 'forward'
                ? progress.interpolate({ inputRange: [0, 1], outputRange: [widthRef.current, 0] })
                : progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-widthRef.current * 0.24, 0],
                  });
          } else if (isOutgoing) {
            translateX =
              transition.direction === 'forward'
                ? progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -widthRef.current * 0.24],
                  })
                : progress.interpolate({ inputRange: [0, 1], outputRange: [0, widthRef.current] });
          } else if (index < transition.targetIndex) {
            translateX = -widthRef.current * 0.24;
          } else {
            translateX = widthRef.current;
          }
        } else if (index < stack.length - 1) {
          translateX = -widthRef.current * 0.24;
        }

        return (
          <ScreenActiveContext.Provider key={page.key} value={isActive}>
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                styles.page,
                !visiblePage && styles.hidden,
                { transform: [{ translateX }], zIndex: index + 1 },
              ]}
            >
              <View
                style={styles.fill}
                pointerEvents={isActive ? 'auto' : 'none'}
                accessibilityElementsHidden={!isActive}
                importantForAccessibility={isActive ? 'auto' : 'no-hide-descendants'}
                accessible={isActive}
              >
                {node}
              </View>
              {transition && isOutgoing && transition.direction === 'forward' ? (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    styles.shade,
                    {
                      opacity: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 0.18],
                      }),
                    },
                  ]}
                />
              ) : null}
            </Animated.View>
          </ScreenActiveContext.Provider>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { backgroundColor: 'transparent' },
  hidden: { display: 'none' },
  shade: { backgroundColor: '#000000' },
});
