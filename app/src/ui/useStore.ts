import React, { useCallback, useContext, useRef, useSyncExternalStore } from 'react';

import { store, type AppState } from '../state/store';

/**
 * 非顶层页面冻结订阅。
 *
 * 页面栈会把上一页保留挂载（返回时滚动位置/输入态不丢）。如果它继续
 * 订阅 store，详情页流式输出时底下首页也会跟着重渲染。ScreenStack 给每个
 * 页面下发 active；非 active 页面拿到冻结快照，不参与外部状态更新。
 */
export const ScreenActiveContext = React.createContext(true);

const noopSubscribe = (): (() => void) => () => undefined;

export function useStore(): AppState {
  const active = useContext(ScreenActiveContext);
  const frozen = useRef<AppState>(store.getSnapshot());
  if (active) frozen.current = store.getSnapshot();
  const getFrozen = useCallback(() => frozen.current, []);
  const subscribe = active ? store.subscribe : noopSubscribe;
  const getSnapshot = active ? store.getSnapshot : getFrozen;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export { store };
