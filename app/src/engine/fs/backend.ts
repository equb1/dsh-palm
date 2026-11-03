/**
 * IFileSystem 的「后端」抽象。
 *
 * just-bash 的 IFileSystem 是**虚拟路径**（/、/a/b），而真实文件系统有两套
 * 完全不同的宿主 API：
 *  - Node（测试 / 桌面）：`node:fs/promises`
 *  - 手机（Hermes）：`expo-file-system`
 *
 * 两者的语义差异（权限位、软链、utimes）在 `SandboxFs` 里补齐；后端只负责
 * 「相对路径 → 读写/枚举/删改」，并且**必须把错误原样抛出来**，由上层映射 errno。
 *
 * 约定：`rel` 是相对工作区根的路径（根是 `''`），不带前导斜杠，已经规范化；
 * 后端仍然要自己做一次越界检查（防御纵深）。
 */

export interface BackendEntry {
  type: 'file' | 'dir';
  size: number;
  /** 毫秒时间戳 */
  mtime: number;
}

export interface BackendDirEntry {
  name: string;
  type: 'file' | 'dir';
}

export interface FsBackend {
  /** 给日志和错误用的名字，例如 'node' / 'expo' */
  readonly kind: string;
  /** 工作区根的展示路径（真机上是 file:// URI 或绝对路径） */
  readonly rootLabel: string;

  readText(rel: string): Promise<string>;
  readBytes(rel: string): Promise<Uint8Array>;
  write(rel: string, data: string | Uint8Array, opts?: { append?: boolean }): Promise<void>;
  /** 不存在返回 null（不抛错） */
  stat(rel: string): Promise<BackendEntry | null>;
  list(rel: string): Promise<BackendDirEntry[]>;
  mkdir(rel: string, opts: { recursive: boolean }): Promise<void>;
  remove(rel: string, opts: { recursive: boolean; force: boolean }): Promise<void>;
  copy(src: string, dest: string, opts: { recursive: boolean }): Promise<void>;
  move(src: string, dest: string): Promise<void>;
  /** 根目录必须存在；由引擎启动时调用一次 */
  ensureRoot?(): Promise<void>;
}
