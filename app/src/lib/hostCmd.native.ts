import * as SecureStore from 'expo-secure-store';

/**
 * 本机引擎启动命令（原生端，存 SecureStore）。
 * 默认值在 Kotlin 的 HostService 里；这里只存"覆盖值"。
 */

const ENGINE = 'dsh-palm.host.engineCmd';
const BRIDGE = 'dsh-palm.host.bridgeCmd';

export interface HostCommands {
  engineCmd: string;
  bridgeCmd: string;
}

export async function loadHostCommands(): Promise<HostCommands> {
  try {
    const [engineCmd, bridgeCmd] = await Promise.all([
      SecureStore.getItemAsync(ENGINE),
      SecureStore.getItemAsync(BRIDGE),
    ]);
    return { engineCmd: engineCmd ?? '', bridgeCmd: bridgeCmd ?? '' };
  } catch {
    return { engineCmd: '', bridgeCmd: '' };
  }
}

export async function saveHostCommands(cmds: HostCommands): Promise<void> {
  try {
    await Promise.all([
      SecureStore.setItemAsync(ENGINE, cmds.engineCmd),
      SecureStore.setItemAsync(BRIDGE, cmds.bridgeCmd),
    ]);
  } catch {
    // 存不进去就用默认命令
  }
}
