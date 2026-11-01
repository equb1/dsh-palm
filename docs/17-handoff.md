# 交接文档（2026-11-02 00:0x）

> 新会话开场白：**"读 docs/17-handoff.md，从'下一步'继续"**

## 一句话状态

手机自带运行时（A 方案）**全链路打通，模型能真回话**：

```
App 启动 → 前台服务 → proot → rootfs → node → dsh web(:8787) → 单文件桥(:8788) → App
```

零点击、无电脑、无 Termux。API Key 由用户在本机引擎里填好（DeepSeek V4.1-Flash），
多轮对话、提问卡片都实测通过。**全部未提交**（分支 `develop`）。

## 这一轮（23:40–24:00）修的两个新坑

背景：用户填了 API Key 后发消息仍然报错 / 一直「生成中」。上一轮做的日志落盘这次直接救了场，
顺着日志抓到的是**两个连续的环境问题**，都不是模型的问题。

### 1. 建默认工作区：缺 `xdg-user-dir`

App 上看到的错误：
```
workspace/initializeDefault -> gateway/internal | spawn xdg-user-dir ENOENT
```
`@deepseek-ai/dsh-api-workspace-controller` 在 Linux 上执行 `xdg-user-dir DOCUMENTS`
来找"文档"目录（`defaultWorkspaceDirectory()`），Ubuntu base 镜像里没有 xdg-user-dirs 包。

修法：`app/android/app/src/main/assets/patch/xdg-user-dir.sh`，
安装/启动时由 `RuntimeInstaller.ensureShims()` 写进 `rootfs/usr/local/bin/xdg-user-dir` 并补 +x。
（另一条同样验证过的修法：profile 的 `workspace-controller.documentsDirectory`；
真机上已经回退成 `[]`，现在只靠 shim，保证"从代码可复现"。）

### 2. 会话落盘：Android 不让硬链接

App 上表现为一直「生成中」，引擎里每轮 `turn/end` 立刻报错：
```
turn/end  reason:{ kind:'error', error:{
  message:"EACCES: permission denied, link '…/session.v4.jsonl.zstd.<tmp>' -> '…/session.v4.jsonl.zstd'" } }
```
`@deepseek-ai/dsh-session-persistence-jsonl` 的 POSIX 发布路径是
"写临时文件 + fsync + `link()` + 删临时文件"，用 link 保证 NO-REPLACE。
**Android 的 app 私有目录禁止硬链接**（实测直接 `ln` 也是 EACCES，连 SELinux 域无关），
但同一个目录里的 `rename` 是允许的、也是原子的。

修法：`assets/patch/fs-link-fallback.cjs`，引擎命令加
`--require /opt/dsh/patch/fs-link-fallback.cjs`：
- `fs.link` / `fs.linkSync` / `fs.promises.link` 在 EACCES/EPERM/ENOTSUP/EOPNOTSUPP/EXDEV 时，
  目标不存在就 `rename`，目标存在则抛回原始错误（保住 NO-REPLACE）。
- 必须用 `--require` 在 dsh 的 ESM 图之前打补丁，`import { link } from 'node:fs/promises'` 才吃得到。
- 自测：`node --require ./app/android/app/src/main/assets/patch/fs-link-fallback.cjs scratch/test-link-shim.cjs`
  （正常 link / 模拟 EACCES / 目标已存在三例都过）。

两个补丁都很小，放 assets，每次启动同步进 rootfs（`ensurePatch` / `ensureShims`），
**改它们不用重打 150MB payload、也不用换 VERSION**。

## 实机证据（PLR110 / arm64 / Android 16）

两个坑修完之后的完整一条：
```
23:57:25 [runtime] shim 就位: xdg-user-dir（524 字节）
23:57:39 [engine] dsh web: http://127.0.0.1:8787/?token=vWKr_F5v…
23:57:40 [bridge] 已连上真 dsh：1 个会话，4 个宿主预设
```
发消息后（App 截图 `docs/assets/screenshot-chat-local.png`）：
```
用户: hello
模型: Hello! How can I help you today?
```
多轮 + 提问卡片也通（`docs/assets/screenshot-ask-card.png`）：用户问"请给我生成一个3分钟自我介绍"，
模型回了一张「使用场合」四选一的卡片。

会话真的落盘了：
```
…/sessions/--root-Documents-deepseek-harness-default-workspace--/session-6746c36c-…/
├── session.lock
└── session.v4.jsonl.zstd   13632 字节
```
重启 App 后会话列表还在（首页「最近 · Greeting · 2 轮 4 步」），说明重放/读取都正常。

端口 / 健康检查：
```
/proc/net/tcp: 127.0.0.1:2253(8787) LISTEN   0.0.0.0:2254(8788) LISTEN
GET http://127.0.0.1:8788/health → {"ok":true,"bridge":"real","host":"host-real-dsh"}
```

## 现在的状态

| 环节 | 状态 |
|---|---|
| 引擎启动（proot + node + dsh） | ✅ 8–16s |
| 桥（单文件 cjs，8788） | ✅ 1s 接上 |
| App 自动配对 + 自动连接 | ✅ 零点击 |
| 模型对话（多轮/流式/思考） | ✅ 真机验证 |
| 会话落盘 / 重启回放 | ✅ 真机验证 |
| 提问卡片（ask_user_question） | ✅ 真机验证 |
| 默认工作区 | ✅ `/root/Documents/deepseek-harness/default-workspace`（rootfs 里） |

## 下一步（按优先级）

1. **工作区放在 rootfs 里，用户在文件管理器看不到**。要真拿来干活，得 bind 一个外部目录，
   比如 `-b <filesDir>/workspace:/root/work`，再把 `workspace-controller.documentsDirectory`
   指到 `/root/work`（或让 shim 直接回答那个路径）。
2. **配对状态会被镜像更新冲掉**：桥的设备密钥写在 rootfs 的 `/root/.dsh-palm-devices.json`，
   换 `VERSION` 重解压就没了，App 侧 deviceKey 还在 → 连不上、得「忘记这台设备」重配对。
   正解：`-b <filesDir>/bridge:/bridge` + `DSH_PALM_DEVICES=/bridge/devices.json`。
3. **首次启动没有进度**：解压实测 ~10s（交接文档早先写的"几分钟"是错的），界面只有"启动中"。
4. **桥的看门狗**：桥挂了只写日志不重启（引擎有）。
5. **手机端模型登录**：`docs/12-model-login.md` 的 OAuth/device code 那条路，手机上没有电脑跳板。
6. **提交**：等用户点头（老规矩）。

## 环境参数（直接抄）

```
设备         3B664H00H9U00000（华为 PLR110 / arm64 / Android 16）
项目         D:\dsh-palm（分支 develop，**全部未提交**）
APK          D:\dsh-palm\app\android\app\build\outputs\apk\debug\app-debug.apk（231.6MB）
包名         cool.cnb.dshpalm
构建         $env:JAVA_HOME="C:\Program Files\Java\jdk-17"
             $env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
             cd D:\dsh-palm\app\android; .\gradlew.bat :app:assembleDebug --console=plain --no-daemon
             （Kotlin/资源改动 ~1.5 分钟；JS 改动会多一步 expo export:embed）
安装         adb -s 3B664H00H9U00000 install -r <apk>
启动         adb -s 3B664H00H9U00000 shell am start -n cool.cnb.dshpalm/.MainActivity
日志         adb -s 3B664H00H9U00000 shell run-as cool.cnb.dshpalm cat files/logs/engine.log
rootfs 里跑命令（调试）
             adb push scratch/run-in-rootfs.sh /data/local/tmp/
             adb shell run-as cool.cnb.dshpalm cp /data/local/tmp/run-in-rootfs.sh files/
             adb shell run-as cool.cnb.dshpalm sh files/run-in-rootfs.sh <nativeLibraryDir> '命令'
             （nativeLibraryDir 从日志里的 engineCmd 抄；app 自己读不了 /data/app）
清遗留进程   adb shell run-as cool.cnb.dshpalm sh files/clean-engine.sh
强装镜像     adb shell run-as cool.cnb.dshpalm rm -rf files/runtime
```

## 已经踩过的坑（别重踩）

| 坑 | 症状 | 已解决做法 |
|---|---|---|
| app 私有目录不能 exec | `can't execute: Permission denied` | proot 作为 `jniLibs/arm64-v8a/libproot.so` 打包 + `expo.useLegacyPackaging=true` |
| proot 动态链接 | `libtalloc.so.2 not found` | talloc/shmem 放 assets，解到 `runtime/lib`，设 `LD_LIBRARY_PATH` |
| 忘了给桥传环境变量 | 桥 `CANNOT LINK EXECUTABLE … libtalloc.so.2 not found` | 桥的 `ProcessBuilder` 也要 `environment().putAll(extraEnv)` |
| toybox tar 遇硬链接中止 | rootfs 只解一半 | 自研 `TarExtractor.kt`（硬链接退化为复制） |
| PATH 传成 Android 的 | 客体里 `head: not found` | 给引擎传 Linux PATH |
| Windows 打的包权限 0644 | `proot error: … is not executable` | `RuntimeInstaller.ensureExecutable()` 每次启动补 +x |
| 裁剪过头（client-ui） | `ERR_MODULE_NOT_FOUND: dsh-client-ui-*` | web profile 会静态 load 全部 client-ui 包，**不能删** |
| 裁剪过头（前端） | `dsh: startup failed: 1 required plugin did not activate` / `dsh-web-frontend is not resolvable` | 前端 5.1MB，**不能删** |
| **缺 xdg-user-dir** | `workspace/initializeDefault -> gateway/internal \| spawn xdg-user-dir ENOENT` | 安装时写 `/usr/local/bin/xdg-user-dir` shim（或 profile 配 `documentsDirectory`） |
| **硬链接被禁** | 每轮 `turn/end` 报 `EACCES: … link '…session.v4.jsonl.zstd.<tmp>'`，App 一直「生成中」 | `--require fs-link-fallback.cjs`，link 失败退化 rename |
| 关闭子进程 stdout | 抓到 token 后引擎立刻 exit 255 | 一个循环读到底，别 return |
| 残留引擎占着 8787 | 新的引擎 `listen EADDRINUSE 127.0.0.1:8787`，界面一直"出错" | `am force-stop` 杀不干净 run-as 起的孤儿，用 `scratch/clean-engine.sh` |
| token 为空时打码 | 日志里 `***/***d***a***t***a***` | `maskToken()`：token 空就直接返回原文 |
| dsh 的 HTTP 只认 cookie | `/api/...?token=` 直接 401 | 先 `GET /?token=…` 拿 303 的 Set-Cookie，再带 cookie 调 API（Host 头要 `127.0.0.1:8787`） |

## 运行时构建（D:\dsh-palm\runtime\build\）

```
node.tar.xz              node-v24.22.1-linux-arm64（npmmirror）
stage/opt/node/bin/node  已就位
stage/opt/dsh/node_modules/  dsh 树（约 512MB，含 dsh-web-frontend）
stage/opt/dsh/bridge/dsh-palm-bridge.cjs
_pruned/                 移出待定：libreoffice-kit-wasm(145MB)、sherpa-onnx(38MB)、dsh-experimental-inspector(23MB)
payload.tar.gz           151.2MB（tar -czf，从 stage 打）
```

重打 payload：
```powershell
cd D:\dsh-palm\runtime\build\stage
tar -czf ..\payload.tar.gz .
Copy-Item ..\payload.tar.gz D:\dsh-palm\app\android\app\src\main\assets\payload.bin -Force
# 然后改 RuntimeInstaller.VERSION（否则手机上不会重装）+ 重新 assembleDebug
```

dsh 是**交叉安装**的（关键技巧，来自 dsh-go 的 build-runtime.sh）：
```
npm install @deepseek-ai/dsh --prefix <stage>/opt/dsh \
  --cpu=arm64 --os=linux --libc=glibc --ignore-scripts \
  --registry=https://registry.npmmirror.com
```

## 代码位置

```
app/android/app/src/main/assets/patch/
├── fs-link-fallback.cjs  硬链接 → rename（--require 预载）
└── xdg-user-dir.sh       默认工作区用的 xdg-user-dir shim

app/android/app/src/main/java/cool/cnb/dshpalm/host/
├── HostService.kt       前台服务、启动命令来源优先级、env、prepare 链
├── HostRuntime.kt       进程管理、token 抓取、看门狗、**日志落盘 engine.log**
├── HostModule.kt        RN 原生模块 DshPalmHost
├── HostPackage.kt       注册
├── RuntimeInstaller.kt  镜像安装、proot 命令模板、VERSION、ensureExecutable/Patch/Shims、bridgeCmd
└── TarExtractor.kt      自研 tar 解压

app/src/lib/host.ts / host.native.ts        JS 侧入口（NativeModules）
app/src/lib/hostCmd.ts / hostCmd.native.ts  自定义命令持久化
app/src/state/store.ts                      DEFAULT_URL（本机/局域网）、maybeAutoConnect、host 状态
app/App.tsx                                 启动即拉起宿主 + 就绪后自动连
app/src/ui/SettingsScreen.tsx               「本机引擎」卡片（启动/停止/刷新/看日志）
scratch/clean-engine.sh                     清遗留引擎进程（调试）
scratch/run-in-rootfs.sh                    在 rootfs 里跑一条命令（调试）
scratch/probe-stuck.ts                      跟会话流 + $events，定位卡在哪一步（调试）
```

## 参考

- `docs/16-app-hosted-runtime.md` — 架构与踩坑详版（"四、还差的"已过时，以本文为准）
- dsh-go 的 `runtime/build-runtime.sh`（GitHub: ccch1mneyyy/dsh-Go）— 镜像构建的权威参考
