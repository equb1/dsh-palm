import { AppState, Linking } from 'react-native';

export async function openUrl(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export function isAppActive(): boolean {
  return AppState.currentState === 'active';
}
