import { useSyncExternalStore } from 'react';

import { store, type AppState } from '../state/store';

export function useStore(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export { store };
