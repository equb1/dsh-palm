/**
 * 轻引擎的真机入口：expo-file-system 工作区 + SecureStore 配置。
 *
 * 工作区就是 `<filesDir>/workspace` —— 和 proot 完整引擎挂进 `/root/work`
 * 的那个目录是同一个，所以在两种引擎之间切换，文件是连续的。
 */
import * as SecureStore from 'expo-secure-store';

// docx 依赖的 nanoid 要 crypto.getRandomValues，just-bash 的 Buffer 也在这里补；
// 只影响原生包，Node 测试不 import 这个文件。
import './polyfills';

import type { LightEngineSetup } from '../engine/light/config';
import { imageConfigFrom, LIGHT_CONFIG_KEY, normalizeSetup } from '../engine/light/config';
import { LightHost } from '../engine/light/host';
import { createExpoFsApi, expoDataDir, expoWorkspaceDir } from '../engine/fs/expoFsApi';
import { ExpoBackend } from '../engine/fs/expoBackend';
import { createDataSandbox, createWorkspaceMount } from '../engine/fs/mount';
import { ShellRunner } from '../engine/shell/bash';

export type { LightEngineSetup } from '../engine/light/config';
export type { SelfCheckCase, WorkspaceSelfCheck } from './light';

/** 覆盖：空命令 / 目录 / 重定向 / 管道 / 递归 grep / 删除 */
const SELF_CHECK_CASES = [
  'pwd',
  'ls -la',
  'mkdir -p selftest && echo hello > selftest/a.txt && cat selftest/a.txt',
  'grep -r hello selftest',
  'find . -name "*.txt" | head -5',
  'printf "a\\nb\\n" | sed -n "2p"',
  'rm -rf selftest',
];

export async function createLightHost(setup: LightEngineSetup): Promise<LightHost> {
  const startedAt = Date.now();
  const normalized = normalizeSetup(setup);
  const image = imageConfigFrom(normalized);

  const workspaceBackend = new ExpoBackend({ api: createExpoFsApi(expoWorkspaceDir()) });
  const mount = await createWorkspaceMount({ backend: workspaceBackend });
  const shell = new ShellRunner({
    fs: mount.fs,
    beforeRun: () => mount.workspace.refreshIndex(),
  });
  const dataBackend = new ExpoBackend({ api: createExpoFsApi(expoDataDir()) });
  const dataFs = await createDataSandbox(dataBackend);
  console.log('[light] workspace=' + mount.workspace.rootLabel + ' model=' + normalized.model);
  console.log('[light] ready=' + (Date.now() - startedAt) + 'ms image=' + (image ? image.model : 'none'));

  return new LightHost({
    workspace: mount.workspace,
    shell,
    dataFs,
    model: {
      baseURL: normalized.baseURL,
      apiKey: normalized.apiKey,
      model: normalized.model,
      ...(normalized.providerName ? { providerName: normalized.providerName } : {}),
    },
    ...(image ? { image } : {}),
    hostName: '锦囊轻引擎（本机）',
    onWarn: (message) => console.warn('[light]', message),
    onLog: (message) => console.log('[light] ' + message),
  });
}

export async function loadLightConfig(): Promise<LightEngineSetup | null> {
  try {
    const raw = await SecureStore.getItemAsync(LIGHT_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LightEngineSetup>;
    const setup = normalizeSetup(parsed);
    return setup.baseURL && setup.model ? setup : null;
  } catch {
    return null;
  }
}

export async function saveLightConfig(setup: LightEngineSetup): Promise<void> {
  try {
    await SecureStore.setItemAsync(LIGHT_CONFIG_KEY, JSON.stringify(normalizeSetup(setup)));
  } catch (error) {
    console.warn('[light] 保存配置失败', error);
  }
}

/**
 * 工作区自检：在真机上跑 7 条命令，验证「IFileSystem 适配 + shell」这条链路：
 * 命令真的在工作区目录里建文件、读文件、递归 grep、再删掉。
 */
export async function runWorkspaceSelfCheck(): Promise<
  import('./light').WorkspaceSelfCheck
> {
  const backend = new ExpoBackend({ api: createExpoFsApi(expoWorkspaceDir()) });
  const mount = await createWorkspaceMount({ backend });
  const shell = new ShellRunner({
    fs: mount.fs,
    beforeRun: () => mount.workspace.refreshIndex(),
  });

  const started = Date.now();
  const results: import('./light').SelfCheckCase[] = [];
  console.log('[selfcheck] workspace=' + backend.rootLabel + ' kind=' + backend.kind);
  for (const command of SELF_CHECK_CASES) {
    const result = await shell.run(command, { timeoutMs: 15_000, maxOutputChars: 600 });
    const item: import('./light').SelfCheckCase = {
      command,
      ms: result.ms,
      exitCode: result.exitCode,
      out: result.stdout.trim().slice(0, 300),
      ...(result.stderr.trim() ? { error: result.stderr.trim().slice(0, 300) } : {}),
    };
    results.push(item);
    console.log('[selfcheck] ' + JSON.stringify(item));
  }
  console.log('[selfcheck] total=' + (Date.now() - started) + 'ms');
  return {
    root: backend.rootLabel,
    kind: backend.kind,
    totalMs: Date.now() - started,
    results,
  };
}
