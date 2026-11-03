/**
 * 工作区挂载。
 *
 * 为什么不直接把 SandboxFs 交给 Bash：Bash 会在传给它的文件系统里
 * 铺一套默认布局（/bin、/usr/bin、/dev、/proc 的占位文件）。如果直接把
 * 真实工作区交出去，`ls` 会看到一堆假命令文件，用户目录被污染。
 *
 * 所以：根用 InMemoryFs（默认布局落在内存里），真实工作区挂到 `/workspace`。
 * 这是 just-bash 官方推荐的 MountableFs 用法。
 */
import { InMemoryFs, MountableFs } from '../shell/runtime';

import type { FsBackend } from './backend';
import { SandboxFs, type SandboxFsOptions } from './sandbox';

export const WORKSPACE_MOUNT = '/workspace';

export interface WorkspaceMountOptions {
  backend: FsBackend;
  mountPoint?: string;
  /** 只读挂载（例如以后把电脑上的知识库挂进来） */
  readOnly?: boolean;
  maxFileReadSize?: number;
}

export interface WorkspaceMount {
  /** 交给 Bash 的文件系统（/ + /workspace） */
  fs: MountableFs;
  /** 工作区的真实沙箱（索引、调试用） */
  workspace: SandboxFs;
  mountPoint: string;
}

export async function createWorkspaceMount(options: WorkspaceMountOptions): Promise<WorkspaceMount> {
  const mountPoint = options.mountPoint ?? WORKSPACE_MOUNT;
  const sandboxOptions: SandboxFsOptions = {
    backend: options.backend,
    readOnly: options.readOnly === true,
    ...(options.maxFileReadSize ? { maxFileReadSize: options.maxFileReadSize } : {}),
  };
  const workspace = new SandboxFs(sandboxOptions);
  await workspace.ensureRoot();

  const fs = new MountableFs({
    base: new InMemoryFs(),
    mounts: [{ mountPoint, filesystem: workspace }],
  });

  return { fs, workspace, mountPoint };
}

/** 会话/配置这类内部状态用独立的沙箱，不挂进 shell（模型看不到） */
export async function createDataSandbox(backend: FsBackend): Promise<SandboxFs> {
  const fs = new SandboxFs({ backend });
  await fs.ensureRoot();
  return fs;
}
