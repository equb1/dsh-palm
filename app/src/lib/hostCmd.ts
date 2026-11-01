/**
 * 本机引擎的启动命令（可覆盖默认值）。
 *
 * 默认值写死在 Kotlin 的 HostService 里（proot + node）。这里只是给"高级用户"和
 * 真机联调用的覆盖入口：比如换成 Termux 里的现成环境，或者先跑个假命令验证链路。
 *
 * 和 deviceKey 一样做平台拆分：Node 跑测试时走内存，原生端走 SecureStore。
 */

const ENGINE = 'dsh-palm.host.engineCmd';
const BRIDGE = 'dsh-palm.host.bridgeCmd';

const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function read(key: string): string {
  const store = storage();
  return store ? (store.getItem(key) ?? '') : (memory.get(key) ?? '');
}

function write(key: string, value: string): void {
  const store = storage();
  if (store) store.setItem(key, value);
  else memory.set(key, value);
}

export interface HostCommands {
  engineCmd: string;
  bridgeCmd: string;
}

export async function loadHostCommands(): Promise<HostCommands> {
  return { engineCmd: read(ENGINE), bridgeCmd: read(BRIDGE) };
}

export async function saveHostCommands(cmds: HostCommands): Promise<void> {
  write(ENGINE, cmds.engineCmd);
  write(BRIDGE, cmds.bridgeCmd);
}
