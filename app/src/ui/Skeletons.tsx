import React from 'react';
import { StyleSheet, View } from 'react-native';

import { EmptyState, Skeleton } from './components';
import { space } from './theme';

/**
 * A7：聊天/首页/抽屉的加载骨架与空状态。
 * 先只做组件，不接线；等对应屏改造时直接替换。
 */

export function ChatSkeleton(): React.ReactElement {
  return (
    <View style={styles.chat} accessibilityLabel="聊天加载中">
      <Skeleton width="72%" height={14} />
      <Skeleton width="88%" height={14} />
      <Skeleton width="54%" height={14} />
      <View style={styles.blockGap} />
      <Skeleton width="30%" height={11} />
      <Skeleton width="82%" height={12} />
      <Skeleton width="64%" height={12} />
    </View>
  );
}

export function HomeSkeleton(): React.ReactElement {
  return (
    <View style={styles.home} accessibilityLabel="首页加载中">
      <Skeleton width={180} height={28} cornerRadius={14} />
      <Skeleton width="62%" height={12} />
      <View style={styles.cards}>
        <Skeleton height={76} cornerRadius={20} />
        <Skeleton height={76} cornerRadius={20} />
        <Skeleton height={76} cornerRadius={20} />
      </View>
    </View>
  );
}

export function SessionDrawerSkeleton(): React.ReactElement {
  return (
    <View style={styles.drawer} accessibilityLabel="会话列表加载中">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} height={54} cornerRadius={14} />
      ))}
    </View>
  );
}

export function EmptySessions(): React.ReactElement {
  return (
    <EmptyState
      glyph="🗂"
      title="还没有会话"
      description="发第一条消息，或从下面的锦囊里选一个开始。"
    />
  );
}

export function EmptyChat(): React.ReactElement {
  return (
    <EmptyState glyph="✳" title="想聊点什么？" description="问个问题，或贴一段文字、一张图片。" />
  );
}

const styles = StyleSheet.create({
  chat: { padding: space.lg, gap: 10 },
  blockGap: { height: space.md },
  home: { padding: space.xl, gap: space.md },
  cards: { gap: 10, marginTop: space.sm },
  drawer: { padding: space.lg, gap: space.sm },
});
