# 交接文档（2026-11-02 11:0x）

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
| 默认工作区 | ✅ `/root/work/deepseek-harness/default-workspace`（**rootfs 外**，见下） |

## 这一轮做完的（1–5）

上一版交接列的 1–5 全部落地，细节写在这里，**别重踩**。

### 1. 工作区移出 rootfs

```kotlin
// RuntimeInstaller.prootPrefix()
-b <filesDir>/workspace:/root/work
```

- `filesDir/workspace` → 客体 `/root/work`，`xdg-user-dir DOCUMENTS` 的 shim 改成回 `$HOME/work`。
- dsh 的默认工作区因此变成 `/root/work/deepseek-harness/default-workspace`，
  **换运行时镜像不再冲掉用户的文件**。
- 老版本留在 `/root/Documents/deepseek-harness` 的数据会**自动迁走**：`ensureLayout()` 里
  先 `rename`（失败退化成复制），再原位留一个 `../work/deepseek-harness` 的软链，
  这样老会话里记的 cwd 还能打开。
- `ensureLayout()` 每次启动都跑（`install()` 有"已装好"的短路，老 rootfs 里可能还没有 `/root/work`）。

### 2. 设备密钥移出 rootfs

```kotlin
-b <filesDir>/bridge:/bridge          // proot 前缀里
env "DSH_PALM_DEVICES=/bridge/devices.json"
```

老的 `/root/.dsh-palm-devices.json` 会在 `ensureLayout()` 里复制成 `files/bridge/devices.json`，
所以**升级 App 之后不用重新配对**。

### 3. 首装解压有进度

- `Status` 新增 `phase` / `progress`（0–100），`HostModule.status()` 原样透给 JS。
- 解压按字节报进度：基础层 0–16%、载荷 16–95%（`AssetManager` 的 `available()` 当分母），
  之后是"启动引擎（第 N 次）96% → 引擎就绪 99% → 就绪 100%"。
- 常驻通知跟着变（"解压运行时（2/2）· 42%"），设置页在启动时把轮询打到 **500ms**。
- `publish()` 加了 snapshot 去重：设置页轮询不会再让日志/通知刷屏。

### 4. 桥也有看门狗了

`HostRuntime.bridgeSupervisor()` 是一个常驻线程，和引擎同一套退避（1s → 5s → 15s → 60s）：

- 桥退出 → 标记 failed → 退避 → 用**当前** token 重起；
- 引擎重启换了 token → `startBridge()` 先 `killBridge()`（**等它真的退出**，否则新桥 EADDRINUSE）；
- 健康检查超时也算失败，杀掉重来；
- 桥 ready 之后把 attempt 归零，避免跑一天后挂掉要等 60 秒。

### 5. 手机端账号登录（不用电脑）

**上一版文档的结论是错的**：不是"login 没有导出"，是方法名探错了。

| 作用 | 真正的方法 |
|---|---|
| 读状态 | `account/getState` |
| 开始登录 | **`account/startSignIn { client, callbackOrigin, loginSource }`** |
| 取消 | `account/cancelSignIn { attemptId }` |
| 退出 | `account/signOut { client }` |
| 状态流 | `account/watch`（mux stream，`authorizeUrl` 只从这里出） |

`login` / `signIn` / `startLogin` / `authorize` / `oauth` / `deviceCode` 全都不存在 —— 上一版按这些名字探，
拿到的 `gateway/invocation-unavailable` 是"名字不对"，不是"没有这个能力"。

手机上的完整链路（**本机模式成立，连电脑模式不成立**）：

```
App ──account.signIn──▶ 桥 ──account/startSignIn{ callbackOrigin: http://127.0.0.1:8787 }──▶ 引擎
                                          │
      系统浏览器 ◀── Linking.openURL(authorizeUrl) ── account/watch 推到 waiting-browser
                                          │
      https://platform.deepseek.com/dsh/authorize?...  ──用户授权──▶ 302 到 127.0.0.1:8787/oauth/callback
                                          │
                              引擎换到 token，落在宿主的凭据库
```

- 回调是引擎自己 `webServer.register` 的 `/oauth/callback`，**不需要 dsh 的登录 cookie**，
  所以系统浏览器直接打得中。
- 桥只在 `baseUrl` 是 loopback 时才允许 `account.signIn`；连电脑时返回 `unsupported` +
  一句人话（那条路的浏览器在手机上、回调在电脑上）。
- 实测（桌面宿主 + 我们的桥，用 `EngineClient` 直连桥手测）：`getState` → `startSignIn` →
  `account/watch` 推出 `waiting-browser` + `authorizeUrl` → `cancelSignIn` 变 `cancelled`，全通。

## 真机复验（2026-11-02 下午，PLR110 / Android 16）

无线 adb（配对码）连上去，把 1–5 全部过了一遍，**又暴露出 5 个只有真机才看得见的问题**，都已修。

### 1–5 的验证结果

| # | 验的东西 | 结果 |
|---|---|---|
| 1 | 工作区在 rootfs 外 | ✅ `files/workspace/deepseek-harness/default-workspace`，客体 `/root/work` 是空挂载点 |
| 2 | 设备密钥在 rootfs 外 | ✅ `files/bridge/devices.json`，重启不丢 |
| 3 | 首装进度 | ✅ 连接页显示「解压运行时（2/2）· 62%」，实测可见 |
| 4 | 桥看门狗 | ✅ `kill -9` 桥 node → 1 秒内清孤儿 + 重启 + health ok |
| 5 | 手机端账号登录 | ✅ 拿到真实 `authorize_url`（`https://platform.deepseek.com/dsh/authorize?...`），取消也正常 |

第 5 条只验到"生成授权链接"；真正的浏览器授权要人点，没法自动化。

### 真机暴露的 5 个坑（都已修）

1. **全新安装选错引擎命令**
   `defaultEngineCmd()` 用 `hasNode()` 判断，但首装那一刻 node 还没解压出来 → 选中冒烟脚本
   （`echo dsh web ...; exec sleep 600`），桥连不上 8787 直接崩。
   修法：同时看 **APK assets 里有没有 `payload.bin`**（有就说明装完一定有 node）。

2. **rootfs 里的 `/etc/resolv.conf` 是空文件**
   客体里是 Ubuntu + glibc 的 node，解析域名只认这个文件 → 所有 HTTPS 请求 `EAI_AGAIN`，
   表现是「填了 Key 也发不出消息」「账号登录 `no-response`」。
   修法：启动时从 `ConnectivityManager` 取当前网络 DNS 写进 `rootfs/etc/resolv.conf`
   （取不到用 `223.5.5.5` / `119.29.29.29` 兜底）。**这条不修，本机引擎基本不可用。**

3. **杀桥只杀了 `sh` 包装，node 变孤儿占着 8788**
   新桥起来 `EADDRINUSE`；更阴的是健康检查会被**孤儿桥**骗过，状态在 ready/failed 之间反复横跳。
   修法：`killMarked()` 按命令行标记（`dsh-palm-bridge.cjs` / `@deepseek-ai/dsh/lib/bin.js`）
   扫 `/proc` 清同 uid 残留；`awaitHealthy(p)` 同时检查**自己的进程还活着**。

4. **首装进度在连接页看不见**
   没连上时 App 停在 ConnectScreen，而进度只加在 HomeScreen / SettingsScreen。
   修法：ConnectScreen 加一张进度卡（阶段 + 百分比 + "装好会自动连上"）；
   `App.tsx` 未连接时轮询从 2s 降到 800ms。

5. **通知权限没申请，通知栏看不到进度**
   `numEnqueuedByApp=354 / numPostedByApp=0` —— 进度一直在推，但 Android 13+ 没授权就不显示。
   进度在 App 内可见；通知栏要等用户手动开权限。后续应该做一次权限引导。

### 账号登录："授权失败" 的真相

第一次在真机上点「登录」看到的是平台页「授权失败」。原因不是流程坏了，是**点到了已作废的授权链接**：

- 调试时用探针发起过一次 `account.signIn`，桥把 `account.updated` 广播给了**所有**客户端，
  App 收到就把链接开进了浏览器；随后探针把这次尝试 `cancel` 了。
- 用户点的是那个旧标签页，`authorize_id` 已经失效 → 平台返回「授权失败」。
- 用**新鲜**的链接打开，页面是正常的（账号 + 「登录」按钮）；点下去之后，凭据落进
  `.dsh/.credentials.yaml`（`deepseek-account-platform/default`），引擎随即用账号列到了 2 个模型。

修掉的坑：App 之前对**任何**看到的 `waiting-browser` 都会自动开浏览器，包括别的客户端发起的、
已经过期的尝试。现在只自动打开**本机发起且未过期**的那一次，并在设置页加了「重新打开授权页」。

> 顺带记一条调试环境的事实：这台 ROM 上 `adb shell input tap` 对 Chrome 不生效
> （HOME/TAB/ENTER 可以），要点页面按钮得走 Chrome DevTools（`localabstract:chrome_devtools_remote`）。
> 另外无线 adb 会随屏幕/省电策略掉线，掉了就 `adb connect` 重连；`forward` 也要重建。

### 任意模型提供商（渠道）

设置页新增「模型提供商」：列表 + 添加/编辑/删除。底层走官方同一套
`llm/discoverModels` + `settings/mutate(llm-pi-ai)` + `credentials/set`，
**真机上验过**：保存 openrouter（2 个模型）→ `settings/describe` 里能看到
`llm-pi-ai.value.providers.openrouter` → 删除后清空；`discoverModels` 打
`api.deepseek.com` 无 Key 时正确返回 `answered 401; check the API key`。

### 打开 App 不再先看到"引擎地址/配对码"

本机模式下冷启动要 15–25 秒（解压 + 起引擎），这段时间原来渲染的是 `ConnectScreen`，
而它把地址/配对码当主界面展示 —— 用户第一眼看到的是"配置页"，不是产品。

现在：本机模式只显示「锦囊 + 启动进度」，地址/配对码收进 **「连接另一台电脑」**；
启动失败时给「重试」，启动成功自动进首页。`ConnectScreen` 只在
「非本机（web/Expo Go）」或用户主动点「连接另一台电脑」时展示表单。

### 桥在 payload 里，这点别忘

`/opt/dsh/bridge/dsh-palm-bridge.cjs` 是**打包进 payload.bin** 的。改了 `engine/src/real/`：

- 临时验证：`node scripts/build-bridge.mjs` → `adb push` → `run-as cp` 覆盖（本机就是这么验的）；
- 正式出包：必须在 `runtime/build/stage` 里换掉再重打 `payload.tar.gz`，否则**全新安装会退回旧桥**。

### 上真机需要、但不在 git 里的东西

| 文件 | 怎么来 |
|---|---|
| `debug.keystore` | `bash scripts/setup-android.sh` 生成（`*.keystore` 被忽略） |
| `jniLibs/arm64-v8a/libproot*.so` | 同上，脚本从 Termux 拉 |
| `assets/rootfs.bin` / `payload.bin` | 同上，脚本从 CNB Release 拉并校验 sha256 |

## 2026-11-02 下午：P1 + 工程债

- P1 全部落地（保活、安全模式、迁移真机验证、会话管理、日志导出、错误文案、附件压缩、能力 gate）；
- 工程债清完（CI、测试、单测、文档、锁文件）；
- P2 未做，原因见 [20-open-work](20-open-work.md)；
- 真机：抽屉长按改名/置顶/归档、后台保活状态、导出日志、迁移三项。

## 下一步（按优先级）

1. **提交**：等用户点头（老规矩）。
2. **通知权限引导**：Android 13+ 不授权就看不到常驻通知（进度只在 App 内可见）。
3. **老 rootfs 的升级路径**：这一轮验的是全新安装；从旧版（工作区还在 `/root/Documents`）升级的迁移还没在真机跑过。
4. **会话与会话日志还在 rootfs 的 `$HOME` 里**：换镜像会丢。要保命得把 `$DSH_HOME` 也 bind 出去
   （`-b <filesDir>/home:/root`，注意会连 vendor 的默认文件一起搬）。
5. ~~proot 二进制没有分发渠道~~ → 已补 `scripts/fetch-proot.sh`（Termux aarch64 的
   `bin/proot` / `libexec/proot/loader`）。`*.so` 仍然不进库，换机器跑一次脚本即可；
   `loader32` 没用上（只支持 arm64 设备）。
6. **首次启动仍会整层重解压**：`VERSION` 一改就 10 秒；后续可以做增量层。

## 环境参数（上一轮 Windows 真机，直接抄）

> 这一轮在 macOS 上做，真机用**无线 adb**（同一 Wi-Fi，配对码）连的，
> 不是 USB。下面的 Windows + USB 流程是上一轮的，仍然有效。

```
设备         3B664H00H9U00000（华为 PLR110 / arm64 / Android 16）
项目         D:\dsh-palm（分支 develop）
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
| 桥重启抢端口 | 新桥 `listen EADDRINUSE 127.0.0.1:8788`，界面一直"桥失败" | `killBridge()` 必须 `waitFor` 等旧进程退出再 spawn；不 await 就必踩 |
| 升级后工作区"空了" | 老 rootfs 的 `/root/Documents` 没了，新 `/root/work` 是空目录 | `ensureLayout()` 里 rename + 原位软链；只看 `install()` 会漏（它有"已装好"短路） |
| 账号方法名 | 调 `account/login` 等一律 `invocation-unavailable` | 用 `account/startSignIn`；`authorizeUrl` 只从 `account/watch` 出 |
| 进度条先到 100 再回退 | 安装完 100%，起引擎又 96% | 安装停在 95%，引擎 96–99，桥就绪才 100 |

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
