# 在新电脑上跑起来

> 从零到"能看界面 / 能连真引擎 / 能打安卓包"的清单。
> 2026-11-02 在一台干净目录里逐条实测过（Node 22.20 / Windows 11 / JDK 17 / Android SDK 36）。
> 同一天补了工作区/设备密钥外置、首装进度、桥看门狗、账号登录四件事，见
> [17-handoff.md](17-handoff.md) 的「这一轮做完的（1–5）」。

## 0. 三分钟版本（只看界面）

```bash
git clone -b develop https://cnb.cool/debaox3.0/test-new-technology/dsh-palm
cd dsh-palm
npm install                # 根依赖：tsx / ws / typescript
npm --prefix app install   # App 依赖：Expo / React Native
npm run engine             # mock 引擎，:8787
npm --prefix app run web   # 浏览器 http://localhost:8081
```

## 1. 环境要求

| 用途 | 需要 |
|---|---|
| 只看界面 / 改 UI | **Node 22.13+**（React Native 0.88 的要求；实测 22.20.0） |
| 连电脑上的真 dsh | Node 22.13+，加一个能跑的 dsh（见 4-B） |
| 打 Android APK | **JDK 17**、**Android SDK**（Platform 36 / Build-Tools 36.0.0 / NDK 27.1.12297006 / CMake 3.22.1）、**adb**，环境变量 `ANDROID_HOME` |

不用手写 `app/android/local.properties`，gradle 认 `ANDROID_HOME`。

## 2. 拿代码

仓库是公开的：<https://cnb.cool/debaox3.0/test-new-technology/dsh-palm>

```bash
git clone -b develop https://cnb.cool/debaox3.0/test-new-technology/dsh-palm
```

- **`develop` 是主开发分支**，新东西都在这里。
- `main` 已经快进到和 `develop` 同一个提交，所以不带 `-b` 克隆到的也是最新代码；但日常开发请用 `develop`。
- 仓库本身只有 ~3MB：150MB 的运行时镜像和调试截图都不进 git（见第 6 节）。

## 3. 装依赖

```bash
npm install
npm --prefix app install
```

⚠️ **先装 app 依赖再跑 typecheck**。根 `tsconfig.json` 把 `app/src/lib/**` 也纳入检查，
没装 app 依赖时会报 `TS2307: Cannot find module 'react-native' / 'expo-secure-store' / 'expo-image-picker'`（4 条）。

## 4. 三条跑法

### A. 只看界面（mock 引擎，不需要手机）

```bash
npm run engine            # 打印 HTTP http://localhost:8787/health
                          #      WS   ws://localhost:8787/ws
                          #      LAN  ws://192.168.x.x:8787/ws
npm --prefix app run web  # 浏览器打开 http://localhost:8081
```

想在手机上看：`npm --prefix app start`（即 `expo start`），手机装 **Expo Go** 扫码，
引擎地址填上面打印的 **LAN** 那条（手机和电脑同一个 Wi-Fi）。

### B. 连电脑上的真 dsh（不碰安卓，也有真能力）

```bash
npm i -g @deepseek-ai/dsh
dsh web --host 127.0.0.1 --port 8899 --no-open     # 打印带 token 的 URL

# 另开一个终端，在仓库根目录：
node --import tsx engine/src/real/main.ts http://127.0.0.1:8899 <token> 8788
```

桥会打印 `ws://localhost:8788/ws` 和**六位配对码**。App / Expo web 里连
`ws://<电脑IP>:8788/ws` + 配对码，就能用电脑上那份真 dsh（会话、预设、审批、提问都在）。

### C. 打 Android APK（手机自带运行时，不用电脑）

构建需要三样**不进 git** 的东西，一条命令补齐（可反复跑，镜像按 sha256 校验）：

```bash
bash scripts/setup-android.sh
```

它做三件事：

| # | 东西 | 去哪 |
|---|---|---|
| 1 | debug 签名证书 `debug.keystore` | `app/android/app/` |
| 2 | proot（Termux aarch64） | `app/android/app/src/main/jniLibs/arm64-v8a/` |
| 3 | 运行时镜像 `rootfs.bin` / `payload.bin` | `app/android/app/src/main/assets/` |

校验值（脚本内置，换镜像时两边一起改）：

```
rootfs.bin   29,936,675 字节  sha256 a91d5a93010193712d346d761372b7c9db6dfcf093893161c64ca107f05914f2
payload.bin 158,561,554 字节  sha256 39447c6fd0dfb287c61d852a13e2417409d3b8589159274e8e589256888e35b1
```

手机这边（每台设备一次）：设置 → 关于手机 → 连点「版本号」7 次 → 开发者选项。

**有线**：打开「USB 调试」，插数据线（要能传数据的线），手机上点「允许 USB 调试」，
`adb devices` 出现设备号才算通（`unauthorized` = 还没点允许）。

**无线**（Mac 只有雷雳口、又不想买线时用这个，Android 11+）：

```bash
# 1) 手机：开发者选项 → 无线调试 → 打开 → 「使用配对码配对设备」，弹窗保持打开
# 2) Mac：先配对（端口和码用弹窗里那对）
adb pair 192.168.x.x:<配对端口> <6位码>
# 3) 再连接（端口用无线调试主页显示的那个，和配对端口不同）
adb connect 192.168.x.x:<连接端口>
adb devices
```

配对成功会打印 `Successfully paired`；`adb devices` 里出现 `IP:端口  device` 才算连上。
手机重启后一般只需重新 `adb connect`，不用重新配对。路由器开了 AP 隔离会连不上。

构建安装（`gradlew` 在仓库里没有可执行位，用 `sh` 跑）：

```bash
cd app/android
sh gradlew :app:assembleDebug         # Windows: .\gradlew.bat :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n cool.cnb.dshpalm/.MainActivity
```

产物 `app/build/outputs/apk/debug/app-debug.apk` 约 **230MB**，里面能看到
`lib/arm64-v8a/libproot.so` 和 `assets/payload.bin` —— 少了任何一个，装上去引擎都起不来。

手机上第一次启动会解压镜像到 app 私有目录（实测 ~10 秒，**设置页和通知上能看到百分比**），
然后引擎 8–16 秒起来、桥 1 秒接上，App 自动配对连接。

数据落在 rootfs 外面，换镜像不会丢：

```
files/workspace   →  客体 /root/work     工作区（dsh 的默认工作区在 /root/work/deepseek-harness 下）
files/bridge      →  客体 /bridge        桥的设备密钥（devices.json）
files/logs        →  引擎日志 engine.log
files/runtime     →  rootfs + node + dsh 本体（换 VERSION 重解压的就是它）
```

升级到这一版时，老 rootfs 里的 `/root/Documents/deepseek-harness` 和
`/root/.dsh-palm-devices.json` 会在首次启动自动迁到上面两个目录，**不用重新配对**。

- 没有镜像也能编过，但 App 里启动引擎会报"运行时镜像没装好"；没有 proot 则是进程直接起不来。
- 换了镜像内容要改 `RuntimeInstaller.VERSION`，否则手机上不会重新解压。
- 首次构建慢（4 个 ABI 都要跑 CMake，约 4 分钟）；之后增量 30 秒左右。

## 5. 验证

```bash
npm run verify     # tsc --noEmit + 全部测试（数量以命令输出为准）
```

（第 12 条是账号：读状态 → 登录 → 退出，验证 `account.*` 的协议形状和事件。）

## 6. 大文件与制品

| 文件 | 大小 | 在哪 |
|---|---|---|
| `app/android/.../rootfs.bin` | 28.5 MB | Release `runtime-v1` 附件 |
| `app/android/.../payload.bin` | 151.2 MB | Release `runtime-v1` 附件 |
| `app/android/.../jniLibs/arm64-v8a/libproot.so` | 254 KB | `scripts/fetch-proot.sh` 现拉（Termux） |
| `app/android/.../jniLibs/arm64-v8a/libprootloader.so` | 18 KB | 同上 |
| 调试截图 | 几 MB | 不入库（`scratch/*.png` 已忽略） |

更新镜像时：重新生成 → 用 CNB 的 release 附件同名覆盖（`overwrite: true`）→ 更新本文档里的 sha256。

发布页：<https://cnb.cool/debaox3.0/test-new-technology/dsh-palm/-/releases>

## 7. 默认分支

CNB 的 OpenAPI 没有"改默认分支"的接口（分支只有查询和删除），所以这样处理：

- `main` 现在和 `develop` 指向**同一个提交**，`git clone` 不带 `-b` 拿到的也是最新代码；
- 旧 `main` 的历史完整保存在分支 **`main-legacy`**（`07f3d66`），没有丢；
- 想把默认分支真正改成 `develop`：仓库页 → 设置 → 仓库设置 → 默认分支，点一下即可。

## 8. 常见问题

| 症状 | 原因 / 解法 |
|---|---|
| `TS2307: Cannot find module 'react-native'` | 先 `npm --prefix app install` |
| gradle 提示找不到 SDK | 设 `ANDROID_HOME`（Windows：`$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"`） |
| `gradlew` 不是可执行/无法运行 | Windows 用 `.\gradlew.bat` |
| App 一直"重连中" | 本机模式地址是 `ws://127.0.0.1:8788/ws`；电脑模式换 `ws://<电脑IP>:8788/ws`，且两台设备同网 |
| 不知道配对码 | App「设置 → 本机引擎 → 看日志」，或 `adb shell run-as cool.cnb.dshpalm cat files/logs/engine.log` |
| App 里报"运行时镜像没装好" | 缺 `rootfs.bin` / `payload.bin`，见 4-C |
| 发消息一直"生成中" | 看引擎日志；常见是镜像缺 `xdg-user-dir` 或 Android 禁止硬链接（修复已内置，见 `docs/17-handoff.md`） |
| 绑 `-b /root/work` 后引擎起不来 | 客体里缺 `/root/work` 挂载点；本版 `ensureLayout()` 每次启动都会补，别用旧 APK 配新 rootfs |
| 把 APK 装到真机后引擎起不来 | 多半是没跑 `bash scripts/fetch-proot.sh`：`*.so` 被 `.gitignore` 排除，jniLibs 里必须自己补 |

### 加了原生依赖后，真机启动红屏 `RNCWebViewModule could not be found`

- 现象：JS 报 `Invariant Violation: TurboModuleRegistry.getEnforcing('RNCWebViewModule')`，
  但 `app/package.json` 里明明有 `react-native-webview`。
- 原因：`app/node_modules` 还是 pnpm 的 `.pnpm` 结构，Expo 自动链接读到的
  `autolinking.json` 指向旧路径，新模块没进 `PackageList.java`。
- 处理：

  ```bash
  rm -rf app/node_modules
  rm -rf app/android/build/generated/autolinking app/android/app/build/generated/autolinking
  npm --prefix app install
  cd app/android && sh gradlew :app:assembleDebug
  ```

- 验证：`app/android/app/build/generated/autolinking/src/main/java/com/facebook/react/PackageList.java`
  里能看到 `RNCWebViewPackage`，再装包就不会红屏。
