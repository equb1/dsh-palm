import React from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { store, useStore } from '../useStore';
import { BrandIcon } from './BrandIcon';
import { motion, radius, space, topInset, useTheme, useThemedStyles, type Theme } from '../theme';

/**
 * WorkBuddy 风格顶部下滑通知横幅。
 * 当用户在其他页面或浏览其他会话时，后台会话完成/需要确认时从顶部滑入，
 * 点击直接跳转回该会话，向上划动可手动划走，5 秒自动收起。
 */
export function TopNoticeBanner(): React.ReactElement | null {
  const state = useStore();
  const notice = state.inAppNotice;
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);

  const translateY = React.useRef(new Animated.Value(-120)).current;
  const opacity = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!notice) return;

    translateY.setValue(-120);
    opacity.setValue(0);

    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        ...motion.spring.sheet,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      dismiss();
    }, 5000);

    return () => clearTimeout(timer);
  }, [notice?.id]);

  const dismiss = React.useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -120,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      store.dismissInAppNotice();
    });
  }, [opacity, translateY]);

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) => gesture.dy < -6,
        onPanResponderRelease: (_evt, gesture) => {
          if (gesture.dy < -15 || gesture.vy < -0.3) {
            dismiss();
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              ...motion.spring.sheet,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [dismiss, translateY],
  );

  if (!notice) return null;

  const isDone = notice.kind === 'done';
  const isApproval = notice.kind === 'approval';
  const iconColor = isDone ? palette.ok : isApproval ? palette.warn : palette.danger;
  const iconBg = isDone ? palette.okSoft : isApproval ? palette.warnSoft : palette.dangerSoft;

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          transform: [{ translateY }],
          opacity,
        },
      ]}
      {...panResponder.panHandlers}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${notice.title}，${notice.body}，点击前往`}
        onPress={() => store.handleInAppNoticeClick()}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
          <BrandIcon
            name={isDone ? 'check' : isApproval ? 'shield' : 'alert'}
            size={16}
            color={iconColor}
          />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {notice.title}
          </Text>
          <Text style={styles.body} numberOfLines={1}>
            {notice.body}
          </Text>
        </View>
        <View style={styles.actionWrap}>
          <Text style={styles.actionText}>查看</Text>
          <View style={styles.arrowWrap}>
            <BrandIcon name="back" size={10} color={palette.blue} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const createStyles = ({ palette: c }: Theme) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      top: topInset + 8,
      left: space.md,
      right: space.md,
      zIndex: 9999,
      elevation: 10,
      shadowColor: c.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radius.lg,
      backgroundColor: c.headerSolid,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.borderStrong,
    },
    cardPressed: {
      opacity: 0.85,
    },
    iconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    textWrap: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    title: {
      color: c.text,
      fontSize: 13,
      fontWeight: '600',
    },
    body: {
      color: c.textDim,
      fontSize: 11.5,
      lineHeight: 16,
    },
    actionWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: c.blueSoft,
    },
    actionText: {
      color: c.blue,
      fontSize: 11.5,
      fontWeight: '600',
    },
    arrowWrap: {
      transform: [{ rotate: '180deg' }],
    },
  });

