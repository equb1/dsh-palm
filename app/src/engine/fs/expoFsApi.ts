/**
 * 真机上的 expo-file-system 绑定。
 *
 * 只被 `.native.ts` 之类的原生入口引用（Node/测试不 import 这个文件），
 * 逻辑在 `expoBackend.ts`；这里负责把 expo 的 File/Directory 包成
 * `ExpoFsApi`。
 *
 * 注意 copy/move 的 destination：expo 要的是原生 File/Directory 实例，
 * 而调用方传进来的是我们的包装对象，所以包装对象带一个 `raw` 指针，
 * 这里再解包回去。
 */
import { Directory, File, Paths } from 'expo-file-system';

import type { ExpoDirRef, ExpoFileRef, ExpoFsApi } from './expoBackend';

function unwrap(target: unknown): unknown {
  return (target as { raw?: unknown } | null)?.raw ?? target;
}

function wrapFile(file: File): ExpoFileRef {
  return {
    raw: file,
    get exists() {
      return file.exists;
    },
    get size() {
      return file.size;
    },
    get lastModified() {
      return file.lastModified;
    },
    readText: () => file.text(),
    readBytes: () => file.bytes(),
    write: (content, options) => file.write(content, options),
    info: () => file.info(),
    delete: () => file.delete(),
    copy: (destination, options) => file.copy(unwrap(destination) as File, options),
    move: (destination, options) => file.move(unwrap(destination) as File, options),
  };
}

function wrapDir(dir: Directory): ExpoDirRef {
  return {
    raw: dir,
    get exists() {
      return dir.exists;
    },
    get size() {
      return dir.size;
    },
    get uri() {
      return dir.uri;
    },
    info: () => dir.info(),
    list: () =>
      dir.list().map((entry) => ({
        name: entry.name,
        isDirectory: entry instanceof Directory,
      })),
    create: (options) => dir.create(options),
    delete: () => dir.delete(),
    copy: (destination, options) => dir.copy(unwrap(destination) as Directory, options),
    move: (destination, options) => dir.move(unwrap(destination) as Directory, options),
  };
}

export function createExpoFsApi(root: Directory): ExpoFsApi {
  return {
    rootLabel: root.uri,
    file: (segments) => wrapFile(new File(root, ...segments)),
    dir: (segments) => (segments.length === 0 ? wrapDir(root) : wrapDir(new Directory(root, ...segments))),
  };
}

/** 工作区：和 proot 完整引擎挂载的 `<filesDir>/workspace` 是同一个目录 */
export function expoWorkspaceDir(): Directory {
  return new Directory(Paths.document, 'workspace');
}

/** 轻引擎自己的状态（会话/配置），放在工作区之外 */
export function expoDataDir(): Directory {
  return new Directory(Paths.document, '.dsh-light');
}
