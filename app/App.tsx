import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';

import { ChatScreen } from './src/ui/ChatScreen';
import { ConnectScreen } from './src/ui/ConnectScreen';
import { SessionsScreen } from './src/ui/SessionsScreen';
import { useStore } from './src/ui/useStore';
import { colors } from './src/ui/theme';

export default function App(): React.ReactElement {
  const state = useStore();

  const screen = !state.caps ? (
    <ConnectScreen />
  ) : state.detail ? (
    <ChatScreen session={state.detail} />
  ) : (
    <SessionsScreen />
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      {screen}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
