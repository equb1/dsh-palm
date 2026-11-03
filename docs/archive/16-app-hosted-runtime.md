# 自带运行时（A 方案）：App 自己跑引擎

> 2026-11-02 更新：第四节的"还差的"已经过时；工作区（`/root/work`）和设备密钥（`/bridge`）
> 已经 bind 到 rootfs 外面，首装解压也有进度了。以 [17-handoff.md](17-handoff.md) 为准。

目标：手机上不装 Termux、不连电脑，点一下 App 就在本机跑起 dsh。

## 一、整体结构

```
APK
├── lib/arm64-v8a/libproot.so            ← proot（当 native lib 打包）
├── lib/arm64-v8a/libprootloader.so      ← proot 的 loader
├── assets/rootfs.bin                    ← Ubuntu 24.04 arm64 base（tar.gz）
├── assets/libtalloc.so.2.bin            ← proot 依赖
├── assets/libandroid-shmem.so.bin
└── assets/index.android.bundle          ← App 的 JS
        │
        ▼ 首次启动解压
/data/user/0/cool.cnb.dshpalm/files/runtime/
├── rootfs/                              ← 完整 Ubuntu 用户态
└── lib/libtalloc.so.2                   ← LD_LIBRARY_PATH 指这里
        │
        ▼ 启动
proot -0 -r rootfs -b /dev -b /proc -w /root /bin/sh -c "dsh web ..."
```

## 二、三个必须踩对的点

### 1. proot 必须作为 native lib 打包

Android 10+ 的 SELinux 不允许执行 app 私有数据目录里的文件。放在 `jniLibs/arm64-v8a/`
里的 `.so` 会被解压到 `nativeLibraryDir`，那里**可以执行**。

同时要在 `gradle.properties` 里设 `expo.useLegacyPackaging=true`，
否则 AGP 默认把 so 留在 APK 里（`extractNativeLibs=false`），`nativeLibraryDir` 是空的。

### 2. proot 是动态链接的

Termux 的 proot 依赖 `libtalloc.so.2` 和 `libandroid-shmem.so`。这两个不能放 jniLibs
（文件名必须 `lib*.so`，而 proot 找的是 `libtalloc.so.2`），所以：
- 打进 assets
- 运行时解到 `files/runtime/lib/`
- 起进程时设 `LD_LIBRARY_PATH` 指过去

`PROOT_LOADER` 环境变量也要指向 `libprootloader.so`。

### 3. 不能用系统的 tar 解压 rootfs

App 私有目录里 `link()` 被 SELinux 拒。toybox 的 tar 遇到硬链接失败会**直接中止**，
结果 rootfs 只解了一半（`/bin/sh` 有，`/usr/bin/sleep` 没有），而且不报大错。

所以自己写了个 `TarExtractor.kt`：
- 只处理 ustar + GNU 长文件名
- 硬链接退化成"复制文件内容"
- symlink 用 `Files.createSymbolicLink`
- 目录穿越防护

## 三、已经验证到的（华为 PLR110 / arm64 / Android 16）

```
[engine] proot warning: ...                     ← proot 起来了
[engine] dsh web: http://127.0.0.1:8787/?token=PROOTOK   ← token 抓到
[engine] IN_ROOTFS                              ← rootfs 里的 /bin/sh 执行成功
[bridge] 启动: ... *** 8788                     ← 桥拿到替换后的 token
```

## 四、还差的

1. **镜像里还没有 node 和 dsh**
   - 需要 node arm64（glibc 版，npmmirror 有）
   - 需要 dsh + 依赖（PC 上装好的是 1.1GB，要裁剪）
   - 注意：dsh 的依赖里如果有原生模块（如 better-sqlite3），PC 上装的是 win32-x64，
     得在 Linux/arm64 上重装或找 prebuild
2. **默认命令还指向冒烟脚本**，要换成 `proot -r rootfs /usr/bin/node /opt/dsh/bin.js`
3. **桥也要跑在 rootfs 里**（同一个 node），现在还是宿主的 `node`
4. **端到端验证**：App 连 127.0.0.1:8788 能对话

## 五、镜像怎么产出（建议）

在 CI 或 WSL 里：

```bash
# 1. 解 Ubuntu base，去掉硬链接
mkdir rootfs && sudo tar -xzf ubuntu-base.tar.gz -C rootfs

# 2. 塞 node + dsh
curl -O https://registry.npmmirror.com/-/binary/node/v22.20.0/node-v22.20.0-linux-arm64.tar.gz
tar -xzf node-*.tar.gz -C rootfs/opt --strip-components=1
cp -r dsh-dist rootfs/opt/dsh

# 3. 重打（--hard-dereference 把硬链接变成实体文件，彻底避免 SELinux 问题）
sudo tar --hard-dereference -czf rootfs.bin -C rootfs .
```

如果重打后还有硬链接，App 端的 `TarExtractor` 也能兜住（会复制内容）。

## 六、体积预算

| 部分 | 现状 | 目标 |
|---|---|---|
| Ubuntu base | 29 MB（压缩）/ 100 MB（解压） | 可以再裁（去掉 perl、文档、apt 缓存） |
| node arm64 | — | 30 MB 压缩 |
| dsh + 依赖 | — | 50–80 MB（要裁剪） |
| APK 总计 | 168 MB | ≤ 150 MB |

## 七、代码位置

- `app/android/app/src/main/java/cool/cnb/dshpalm/host/RuntimeInstaller.kt` — 镜像安装、proot 命令模板
- `.../TarExtractor.kt` — 自研 tar 解压器
- `.../HostRuntime.kt` — 进程管理、token 抓取、看门狗
- `.../HostService.kt` — 前台服务
- `app/src/lib/host.ts` — JS 侧入口
