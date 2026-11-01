# 在新电脑上跑起来

> 从零到"能看界面 / 能连真引擎 / 能打安卓包"的清单。
> 2026-11-02 在一台干净目录里逐条实测过（Node 22.20 / Windows 11 / JDK 17 / Android SDK 36）。

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

先把两个运行时镜像放到 `app/android/app/src/main/assets/`：

```bash
# 仓库公开，直接下载，不用登录
curl -L -o app/android/app/src/main/assets/rootfs.bin  https://cnb.cool/debaox3.0/test-new-technology/dsh-palm/-/releases/download/runtime-v1/rootfs.bin
curl -L -o app/android/app/src/main/assets/payload.bin https://cnb.cool/debaox3.0/test-new-technology/dsh-palm/-/releases/download/runtime-v1/payload.bin
```

校验（可选但建议）：

```
rootfs.bin   29,936,675 字节  sha256 a91d5a93010193712d346d761372b7c9db6dfcf093893161c64ca107f05914f2
payload.bin 158,561,554 字节  sha256 39447c6fd0dfb287c61d852a13e2417409d3b8589159274e8e589256888e35b1
```

构建安装：

```bash
cd app/android
./gradlew :app:assembleDebug          # Windows: .\gradlew.bat :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

手机上第一次启动会解压镜像到 app 私有目录（实测 ~10 秒），然后引擎 8–16 秒起来、
桥 1 秒接上，App 自动配对连接。

- 没放这两个 `.bin` 也能编过，但 App 里启动引擎会报"运行时镜像没装好"。
- 换了镜像内容要改 `RuntimeInstaller.VERSION`，否则手机上不会重新解压。

## 5. 验证

```bash
npm run verify     # tsc --noEmit + 11 条端到端测试，实测 11/11
```

## 6. 大文件与制品

| 文件 | 大小 | 在哪 |
|---|---|---|
| `app/android/.../rootfs.bin` | 28.5 MB | Release `runtime-v1` 附件 |
| `app/android/.../payload.bin` | 151.2 MB | Release `runtime-v1` 附件 |
| 调试截图 | 几 MB | 不入库（`scratch/*.png` 已忽略） |

更新镜像时：重新生成 → 用 CNB 的 release 附件同名覆盖（`overwrite: true`）→ 更新本文档里的 sha256。

发布页：<https://cnb.cool/debaox3.0/test-new-technology/dsh-palm/-/releases>

## 7. 默认分支

CNB 的 OpenAPI 没有"改默认分支"的接口，所以这里做了两件事：

1. `main` 已快进到与 `develop` 同一个提交 —— 不管默认分支指向谁，`git clone` 拿到的都是最新代码；
2. 想真正把默认分支切成 `develop`：仓库页 → 设置 → 仓库设置 → 默认分支，点一下即可。

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
