import React from 'react';
import { Platform, StatusBar, StyleSheet, View } from 'react-native';

import { ChatScreen } from './src/ui/ChatScreen';
import { ConnectScreen } from './src/ui/ConnectScreen';
import { HomeScreen } from './src/ui/HomeScreen';
import { useStore } from './src/ui/useStore';
import { colors } from './src/ui/theme';

export default function App(): React.ReactElement {
  const state = useStore();

  const screen = !state.caps ? (
    <ConnectScreen />
  ) : state.detail ? (
    <ChatScreen session={state.detail} />
  ) : (
    <HomeScreen />
  );

  // web 上收成一列手机宽度，两边留黑，看起来才像手机
  if (Platform.OS === 'web') {
    return (
      <View style={styles.webOuter}>
        <StatusBar barStyle="light-content" />
        <View style={styles.webFrame}>{screen}</View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      {screen}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  webOuter: {
    flex: 1,
    backgroundColor: '#050608',
    alignItems: 'center',
    justifyContent: 'center',
  },
  webFrame: {
    width: 430,
    maxWidth: '100%',
    height: '100%',
    maxHeight: 932,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
});
