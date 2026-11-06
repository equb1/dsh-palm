# 锦囊 · 踩坑记录

> 状态：2026-11-03。**本文件只记“踩过的坑 + 怎么处理”**，不写需求和任务。
> 新坑按「现象 → 原因 → 处理 → 验证」追加；能写成脚本的写进 `scripts/`。

## A. 环境与构建

### A1. `pnpm` 严格 node_modules 导致 Babel preset 找不到

- 现象：`expo export` / `:app:createBundleDebugJsAndAssets` 报
  `Cannot find module 'babel-preset-expo'`。
- 原因：根/`app` 用 pnpm 安装，preset 是 `expo` 的传递依赖，没被提升到 `app/node_modules`。
- 处理：`app/package.json` 显式加 `@babel/core`、`babel-preset-expo`；或统一用 npm。
- 验证：`npm --prefix app run typecheck` + `expo export` 通过。

### A2. `gradlew: Permission denied`

- 现象：直接 `./gradlew` 报权限错误。
- 原因：仓库里 wrapper 没有可执行位。
- 处理：用 `sh gradlew ...`，不要 `chmod` 改仓库文件。
- 验证：`BUILD SUCCESSFUL`。

### A3. `Keystore file 'debug.keystore' not found`

- 原因：`debug.keystore` 被 gitignore，新机器没有。
- 处理：`keytool -genkeypair -v -keystore app/android/app/debug.keystore -alias androiddebugkey -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"`。
- 验证：`assembleDebug` 通过、`adb install` 成功。

### A4. 缺 `libproot.so` / `libprootloader.so`

- 现象：构建报 `jniLibs` 缺库。
- 原因：proot 二进制不在仓库，需要从 Termux 包取。
- 处理：`scripts/fetch-proot.sh`（下载 aarch64 deb，Python 解 ar；macOS 自带 `ar` 对尾部 `/` 会失败）。
- 验证：`app/android/app/src/main/jniLibs/arm64-v8a/` 有 3 个 `.so`。

### A5. `INSTALL_FAILED_UPDATE_INCOMPATIBLE`

- 现象：覆盖安装失败，签名不一致。
- 原因：之前装过别的签名/包（例如 release 或 spike 包）。
- 处理：确认数据可丢后卸载旧包再装；或改用独立 `applicationId` 的测试包。
- 验证：`adb install -r` 成功。

### A6. 启动红屏 `RNCWebViewModule could not be found`

- 现象：合并后首次启动报 TurboModule 找不到，但 `app/package.json` 里有 `react-native-webview`。
- 原因：`app/node_modules` 还残留 pnpm 的 `.pnpm` 结构，Expo 自动链接读到旧的
  `autolinking.json`，新模块没进 `PackageList.java`。
- 处理：
  `rm -rf app/node_modules app/android/build/generated/autolinking app/android/app/build/generated/autolinking`
  → `npm --prefix app install` → `sh gradlew :app:assembleDebug`。
- 验证：`PackageList.java` 出现 `RNCWebViewPackage`，重装不红屏。

### A7. Windows 长路径导致 CMake `build.ninja still dirty`

- 现象：`gradlew :app:assembleRelease` 反复失败。
- 原因：仓库路径过长，CMake/ninja 生成物路径超限。
- 处理：把工作区放到短路径（如 `D:\dp`）再构建。
- 验证：构建成功。

### A8. `node --import tsx -e` 里写顶层 await 报错

- 现象：临时脚本报 CJS/ESM 错误。
- 原因：`-e` 走 CJS，不支持顶层 await。
- 处理：包一层 `async function main()` 再调用。
- 验证：脚本正常退出。

### A9. Windows 上 Metro 不跟文件改动，真机吃旧 bundle（2026-11-04）

- 现象：改了 JS、重启 App 后界面/逻辑还是旧的（例如新加的分享逻辑完全没日志）；日志里能看到
  `Running "main"`，但新代码的 `console.warn` 不出现。
- 原因：Metro 的文件监听在 Windows 上偶尔漏事件（没有 watchman），`expo start` 的服务端缓存了旧 transform。
- 处理：改完 JS 先重启 Metro：`cd app; $env:CI="1"; npx expo start --port 8081 --clear`，
  再 `adb shell am force-stop cool.cnb.dshpalm && am start -n …`；验证新逻辑时加一条临时 `console.warn`
  看 `adb logcat -s ReactNativeJS`，确认后再删。
- 验证：`[share-debug] intake -> {"text":…}` 出现、界面同步变化。

## B. rootfs / proot

### B1. 全新安装选中了 smoke 引擎命令

- 现象：首装后引擎起不来，日志显示跑的是测试命令。
- 原因：命令选择用 `hasNode()` 判断，但解压前 Node 还不存在。
- 处理：用 `hasPayloadAsset()` 判断 payload 是否就位，再选 proot 命令。
- 验证：首装日志出现 `proot ... dsh/bin.js web`。

### B2. `EAI_AGAIN` / 账号请求 `no-response`

- 现象：引擎能起，但模型/账号请求解析失败。
- 原因：rootfs `etc/resolv.conf` 为空，proot 里没有可用 DNS。
- 处理：`ensureDns()` 从 ConnectivityManager 读系统 DNS，写 `resolv.conf`；兜底
  223.5.5.5 / 119.29.29.29。
- 验证：`getent hosts api.deepseek.com` / 日志里模型列表加载成功。

### B3. `~/.dsh` 在 rootfs 里，换镜像全丢

- 现象：重装/升级后会话、登录、工作区索引消失。
- 原因：dsh home 落在 `rootfs/root/.dsh`。
- 处理：把 `files/home/.dsh` bind 到 `/root/.dsh`；启动时迁移旧数据（日志：
  「会话与凭据已迁出 rootfs」）。
- 验证：`files/home/.dsh` 有 profiles/sessions/storages；rootfs 里 `.dsh` 是空挂载点。

### B4. 老 rootfs 迁移只覆盖“宿主目录为空”

- 现象：如果 `files/home/.dsh` 已有内容，旧 rootfs 里的数据不会合并。
- 原因：迁移逻辑为了避免覆盖，只在目标为空时搬。
- 处理：升级前确认目标为空；需要合并时手动处理。
- 验证：伪造老布局重跑一次，三项（workspace/devices/.dsh）都迁出。

### B5. proot 内存比预期高

- 现象：后台常驻后手机变卡。
- 原因：真机实测 node ≈239MB + 桥 ≈80MB，App 自身 ≈320MB。
- 处理：默认不预热；idle 回收；`onTrimMemory` 优先停 proot；常备做成高级开关。
- 验证：`ps -A -o RSS` / `dumpsys meminfo`。

### B6. 16KB page size 未验证

- 现象：新系统要求 16KB 对齐，老 `.so` 可能不兼容。
- 处理：发版前在 16KB 设备/模拟器验证 proot 的 `.so`。
- 状态：**未验证**。

### B7. 基础 rootfs 里混着 `PaxHeaders/` 垃圾目录（2026-11-04）

- 现象：解压后的 rootfs 里有 492 个 `PaxHeaders/` 目录（`/etc/dpkg/dpkg.cfg.d/PaxHeaders` 等），
  平时不影响运行，但 `dpkg`/`apt` 会把它当配置文件读而报错。
- 原因：`rootfs.bin` 打包时 bsdtar 把 PAX 元数据目录当成真实目录写进了 tar；`TarExtractor` 之前照单全收。
- 处理：`TarExtractor` 跳过路径段为 `PaxHeaders` / `PaxHeaders.*` 的条目；已经装过的设备可一次性 `find … -prune -exec rm -rf`。
- 验证：新版本 APK 首装解压后 `find / -xdev -type d -name 'PaxHeaders*' | wc -l` 为 0。

## C. 引擎与桥

### C1. 桥 `EADDRINUSE` / 假 ready

- 现象：重启后桥起不来，或状态 ready 但连不上。
- 原因：上次的桥/node 残留进程占着 8788，健康检查只看了端口。
- 处理：启动前按命令行匹配 `dsh-palm-bridge.cjs` / `dsh/lib/bin.js` 清进程；
  `awaitHealthy` 同时检查 `p.isAlive`。
- 验证：日志「清掉残留进程 pid=…」，重启 1s 内恢复。

### C2. payload 里的桥是旧的

- 现象：新功能（账号/提供商）在全新安装上消失。
- 原因：桥打包在 `payload.bin`，只 `adb push` 覆盖会被重解压覆盖回去。
- 处理：桥改为 **APK 补丁**，`build-bridge.mjs` 写进 assets，`ensurePatch()` 每次启动同步。
- 验证：rootfs 里桥的字节数/内容与 assets 一致。

### C3. `sessions.setPreset` 在真宿主不支持

- 现象：点会话内预设胶囊报错。
- 原因：桥里 `sessions.setPreset` 是 `unsupported`。
- 处理：按 `capabilities.actions` 隐藏预设胶囊；`setPreset` 先检查能力再给人话提示。
- 验证：真机聊天页不显示预设胶囊。

### C4. 会话删除 / 正文搜索没有宿主接口

- 现象：抽屉只能改名/置顶/归档。
- 原因：dsh 远程接口没有 delete/search。
- 处理：不硬做本地假删；等上游或自建索引。
- 验证：—

### C5. 账号 token 无 refresh

- 现象：过一段时间账号失效，需要重登。
- 原因：官方包 token 无 refresh；state/PKCE 只在内存，App 被杀则登录尝试作废。
- 处理：保持 App 进程；提供「重新打开授权页」；错误文案引导重登。
- 验证：杀进程后重开，登录态仍在（凭据已落盘）。

### C6. `gateway/invocation-unavailable` 直接抛给用户

- 现象：界面显示一长串英文协议错误。
- 处理：`app/src/lib/errors.ts` 按模式翻成人话（版本不支持/配对码/401/超时/DNS）。
- 验证：错误卡显示中文建议。

## D. 网络与账号

### D1. OAuth 授权链接过期，App 仍自动打开

- 现象：点登录后浏览器说授权失败。
- 原因：之前 probe 创建的 attempt 被 App 自动打开，链接已过期。
- 处理：只自动打开用户主动发起、未过期的 attempt（`pendingSignIn` + 过期判断）；
  加「重新打开授权页」。
- 验证：新登录一次成功；旧链接不再弹出。

### D2. 「查看用量」跳到充值页

- 现象：设置里点用量打开的是 top-up。
- 原因：用了 `links.topUpUrl`。
- 处理：改为 `links.usageUrl`（`https://platform.deepseek.com/usage`）。
- 验证：真机打开的是用量页。

### D3. 配对码 / 设备密钥

- 现象：第二次连接还要输码，或 key 失效。
- 原因：设备密钥没存/被清；`devices.json` 随 rootfs 丢。
- 处理：密钥外置到 `files/bridge/devices.json` 并迁移；App 存 SecureStore。
- 验证：重启 App 免码直连。

## E. Android / 原生

### E1. 通知权限被 ROM 拒绝

- 现象：前台服务通知不显示，`pm grant` 被拒。
- 原因：ColorOS 权限策略；没有运行时申请。
- 处理：原生 `requestNotificationPermission` 在连上宿主时申请；进度同时画在 App 内。
- 验证：`dumpsys package` 里 `POST_NOTIFICATIONS: granted=true`；后台完成能收到通知。

### E2. 分享只处理冷启动（2026-11-04 已修）

- 现象：App 在后台时分享进来没反应；冷启动的分享有时也丢。
- 原因：旧实现只读 `getInitialShare()`（Activity.intent），`onNewIntent` 回来后没通知 JS；
  而且 `intakeShare` 没 catch，权限异常会变成未捕获 rejection。
- 处理：新增 `ShareInbox`（onCreate/onNewIntent 都 offer，`take()` 只消费一次）；JS 在冷启动与
  `AppState=active` 时 `consumeShare()`；文字进输入框，文件走原生收件；失败 catch 成人话。
- 验证：冷启动分享 `最终分享验证 2026` 进输入框；文件选择器选图落 `uploads/`；见 AI-TASKS 1.3。

### E3. `dshpalm://` 深链是死的

- 现象：外部唤起打开 App 但没反应。
- 原因：manifest 声明了 scheme，JS 没接 `Linking`。
- 处理：`App.tsx` 处理 `getInitialURL` + `url` 事件，支持 `pair` 参数。
- 验证：`am start -a VIEW -d "dshpalm://pair?..."` 能填地址/码。

### E4. WebView 会话态不通

- 现象：实验室能打开官方前端，但和 RN 会话互不相通。
- 原因：token 从日志捞，导航没打通。
- 处理：M2 做（宿主暴露 web 地址/token + 双向跳转）。
- 状态：未完成。

### E5. 无线 adb 容易断

- 现象：`adb devices` 空了 / `forward` 失效。
- 原因：息屏、IP 变化、mDNS 服务名变化（可能带 `(2)`）。
- 处理：重新 `adb connect`/用新的 mDNS 名；`adb forward` 重建；必要时 USB。
- 验证：`adb shell echo ok`。

### E6. 截图全黑

- 现象：`screencap` 只有 20KB 全黑。
- 原因：屏幕休眠/锁屏。
- 处理：`input keyevent 224` 唤醒并解锁后再截。
- 验证：截图有内容。

### E7. `input tap` 在 Chrome 里不生效

- 现象：自动化点不动网页。
- 原因：Chrome 的输入处理与系统 input 不同。
- 处理：用 `localabstract:chrome_devtools_remote` + `Runtime.evaluate` 点击。
- 验证：页面状态变化。

### E8. 重装 debug APK 报签名不一致

- 现象：`adb install -r app-debug.apk` 报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`。
- 原因：手机上的包是另一台机器/另一个 debug keystore 签的，本地 `app/android/app/debug.keystore` 指纹对不上。
- 处理：不要卸载重装（会丢登录和会话）；用 Metro 热载验证：`adb reverse tcp:8081 tcp:8081` + `npx expo start --port 8081`，再重启 App 从 8081 拉 bundle。
- 验证：`adb logcat -s ReactNativeJNI` 不再报 `Failed to connect to localhost:8081`，改动在真机生效。

### E9. trim 停 proot 时出现 InterruptedIOException（2026-11-04）

- 现象：`am send-trim-memory … RUNNING_LOW` 后日志有
  `[engine] 异常: java.io.InterruptedIOException: read interrupted by close() on another thread`。
- 原因：`HostRuntime.stop()` 主动关掉引擎 stdout，读线程被中断；属预期，不是崩溃。
- 处理：保留日志便于排查；看门狗只在“非主动停止”时计失败。停止后 `ps` 无 proot、通知消失即为成功。
- 验证：trim 后 `ps -A | grep proot` 为空，UI 回「轻」。

## F. 轻引擎 / Office

### F1. Hermes 缺 Buffer/crypto/fetch/WebAssembly

- 现象：just-bash / docx 库在真机报错。
- 原因：Hermes 没有 Node 全局；RN 运行时只提供 fetch/AbortController 等。
- 处理：`app/src/lib/polyfills.ts` 补 Buffer/crypto.getRandomValues/performance；
  Metro 给 `node:zlib` stub；WASM 不可用。
- 验证：真机 shell 自检 7 条通过。

### F2. just-bash 重文本命令慢

- 现象：`awk` 10 万行约 4.6s。
- 原因：纯 JS 解释执行。
- 处理：命令限额（30s/2000 命令/24k 输出）；重活走 proot。
- 验证：自检与限额测试。

### F3. 轻引擎 FS 语义与 POSIX 不同

- 现象：软链报 EPERM、chmod 重启丢、读 >10MB 报 EFBIG。
- 原因：手机 FS + 内存覆盖层。
- 处理：文档写清；需要真语义走 proot。
- 验证：`test/fs-sandbox.test.ts`。

### F4. Office 依赖缺失

- 现象：`dsh-skill-office` 在 rootfs 里但跑不了。
- 原因：没有 Python；`libreoffice-kit` 没有 linux-arm64 二进制。
- 处理：proot 装 `python3 + python-docx + openpyxl + python-pptx`；
  render/recalc/PDF/旧格式需要真 LibreOffice（默认不做）。
- 验证：三件套创建/读取/编辑各跑一次。

### F5. 轻引擎 docx/xlsx 保真有限

- 现象：只支持结构化 blocks / 值，没有样式、公式、编辑。
- 处理：复杂/编辑/pptx 路由到 proot。
- 验证：真机对比生成结果。

### F6. dpkg/apt 在 app 私有目录里跑不了（2026-11-04）

- 现象：`dpkg: error processing archive ... unable to make backup link of './usr/lib/...' before installing new version: Permission denied`；
  随后 `dpkg: error: error creating new backup file '/var/lib/dpkg/status-old': Permission denied`；
  更早还会先报 `read error in configuration file '/etc/dpkg/dpkg.cfg.d/PaxHeaders': Is a directory`。
- 原因：① Android SELinux 不允许 app 私有目录 `link()`，dpkg 备份/`status-old` 依赖硬链接；
  ② 基础 `rootfs.bin` 里混进了 bsdtar 的 `PaxHeaders/` 元数据目录（492 个），dpkg 把目录当配置文件读。
- 处理：完整引擎的 Python 三层不走 apt/dpkg 入库，直接
  `dpkg-deb --fsys-tarfile <deb> | tar -x --hard-dereference --no-same-owner -C /`
  （硬链接退化成复制）；`TarExtractor` 丢弃路径里带 `PaxHeaders` 的条目；
  产物打成 APK 层 `assets/python.bin`。脚本：`scripts/build-python-layer.sh`。
- 验证：`TarExtractor` 重解 rootfs 后 `find / -name 'PaxHeaders*'` 为 0；层删除-重解后三格式 smoke 通过。

### F7. 后台时 App 的网络被 ROM 掐断（2026-11-04）

- 现象：apt/pip 在后台跑时报 `Temporary failure in name resolution`；`run-as` 里 `getent hosts` 全失败，
  连 `127.0.0.1:8787` 也超时；把 App 拉到前台（`am start`）后同一命令立刻成功。
  DNS 走 Clash 的 172.19.0.2 时更明显。
- 原因：PLR110 / HarmonyOS 对后台 UID 断网（有前台服务也不放行），不是 DNS 配置问题。
- 处理：所有需要网络的长任务必须在 App 前台时跑；Python 层因此随 APK 发布，不做首次下载。
  调试时先 `adb shell am start -n cool.cnb.dshpalm/.MainActivity`，再跑 `apt/pip`。
- 验证：前台 `python3 -m pip install` 20s 成功；后台同一命令 DNS 失败。

### F8. 完整引擎默认 `workspace-write` 跑不了 bash（2026-11-04）

- 现象：模型调 bash 直接失败：`Error: sandbox mode "workspace-write" is requested but no sandbox backend is usable on this host;
  refusing to run the command unconfined. Install bubblewrap or run a Landlock-enforcing kernel (Linux)…`。
- 原因：`dsh-bash-sandbox` 在 Linux 上要 bwrap 或 Landlock；proot 里 bwrap 起不来，Android 内核的 Landlock 探测也失败，
  executor 是 fail-closed，绝不在受限模式下降级为无约束执行。
- 处理：会话权限切「完全权限」（`danger-full-access`）后 provider 不参与，bash 正常；
  真机已验证 `python3 -c "import docx, openpyxl, pptx; print(...)"` 返回 `1.1.0 3.1.2 1.0.2`。
  默认 `workspace-write` 下需要 UI/能力门提示用户切权限（P0 1.4）；不要改 `DSH_PERMISSION_MODE` 全局默认。
- 验证：`permissions.list` 默认 `workspace-write`；`sessions.setPermission` 切 full 后同一提示词工具返回 `state=done`。

### F9. Kotlin 注释里的 `/*` 会嵌套，编译报 Unclosed comment（2026-11-04）

- 现象：`Intake.kt:236:1 Syntax error: Unclosed comment`，同时 `HostModule.kt` 一堆
  `Unresolved reference 'Intake'`（真正原因在 Intake 自己）。
- 原因：Kotlin 支持**嵌套块注释**；KDoc 里写了 `` `uploads/*.part` ``，这个 `/*` 又开了一层，
  后面只有一个 `*/`，注释一直到文件尾都没闭合。
- 处理：注释里别出现 `/*`（改成 `uploads/<name>.part`）；新建 Kotlin 文件先
  `gradlew :app:compileDebugKotlin` 单独过一遍，别等整包。
- 验证：`assembleDebug` 通过；`grep -c '/\*'` 与 `*/` 数量可粗略自检。

### F10. 能力门 / Handoff 的四个边界（2026-11-04）

- **bash 要整段拒绝**：只拦“包含 python”不够，`touch x && python y.py` 不能先执行前半段；
  `capability.ts` 按引号拆 shell 段、递归 `bash -c`/`xargs`，任一段命中 proot-only 就整段拒绝。
- **合成工具结果**：拒绝后必须给每个未执行调用写 `[CAPABILITY_MISSING] not executed` 的 tool 消息，
  否则 `history` 以 assistant `tool_calls` 结尾，下一次 light 请求会被 OpenAI 兼容接口拒。
- **Handoff 幂等**：种子带 `[dsh-handoff:<id>]`；`sessions.create` 后先落 `fullSessionId` 再 send；
  send 失败先 `sessions.get` 找标记，找到就算成功，找不到才重试；已完成步骤只在摘要里，绝不重放。
- **完整权限**：bash 卡片要二次确认并把目标会话设 `danger-full-access`（F8）；预路由命中代码/后台/Office
  时目前**直接**用 full-access（没有第二次确认），属已知取舍，后续可在设置里加“预路由也确认”。
- 验证：`test/capability-gate.test.ts`（无审批/无文件/下一轮可发）、`test/handoff-orchestration.test.ts`
  （切换失败不 create、create 失败不 send、并发只一次、种子丢失按标记恢复）。

### F11. 生图 url 不能直接信（2026-11-04）

- 现象：`url` 返回 200 但内容是 HTML 网关页；旧代码照样存成 `.png`；下载没有超时，挂住会一直转。
- 原因：只看了 HTTP 200，没校验 `content-type`/魔数；没有超时/大小上限；扩展名默认 `.png`。
- 处理：30s 超时 + 20MB 上限；`content-type: image/*` 与魔数双重校验；相对/`data:` URL 单独解析；
  跨域不转发 API Key；按真实 MIME 定扩展名；`response_format` 被 400/422 拒时去掉重试一次（auto）。
- 验证：`test/image.test.ts`（b64/url/dataurl/html/401/429/slow/20MB）；mock `MOCK_IMAGE_MODE=url`。

### F12. 输出文件名不能只靠 toSandboxPath（2026-11-04）

- 现象：模型给 `会议 纪要 #1 100%` 时，`#`/`%` 在分享/`file://` 里被当片段/转义，Windows 同步也可能炸；
  300 字符文件名会 `ENAMETOOLONG`，而审批卡已经显示了原名。
- 原因：`toSandboxPath` 只防目录穿越，不做文件名可移植性。
- 处理：`lib/filenames.ts` 统一 `sanitizeFileName/sanitizeSandboxPath`（NFC、CJK/空格/`._-` 保留，
  `#%/\:*?"<>|`+控制字符→`_`，码点截断，冲突扩展名替换），生成工具与审批卡共用；
  `toSandboxPath` 仍是唯一安全边界。
- 验证：`test/filenames.test.ts` + `docs.test.ts` 集成；磁盘名 `docs/会议 纪要 _1 100_.docx`。


## H. UI / RN

### H1. `Rendered more hooks than during the previous render`

- 现象：打开抽屉直接崩，红屏指向组件。
- 原因：`useState` 写在了提前 `return null` 之后（`SessionDrawer`）。
- 处理：所有 hooks 放在第一个条件返回之前。
- 验证：抽屉反复开合不崩。

### H2. RN `Modal` 在真机上不弹

- 现象：点「选择提供商」没反应，状态改了但界面无变化。
- 原因：Android Modal 在部分 ROM/层级下不显示（未深究）。
- 处理：改成**页内展开**（inline picker），少一层原生弹层。
- 验证：点「选择」出现搜索列表。

### H3. `Pressable` 行点了没反应

- 现象：设置/表单里的行按了没触发，但按钮能点。
- 原因：行内 `Pressable` 在 ScrollView 里的手势与样式组合不稳定（未复现根因）。
- 处理：交互行改用已验证的 `Btn`；或给 `Pressable` 加 `onPressIn` 兜底。
- 验证：真机点按有反馈、状态变化。

### H4. 流式输出每个 delta 都 patch

- 现象：长回答时代码侧每 token 触发一次 store 更新。
- 历史处理：U3 曾计划 32ms 合并；实际先后试过 50ms 定时器、requestAnimationFrame（约 16ms）。
- 现状（2026-11-04）：`queueMicrotask` + chunk 数组缓冲，同一事件栈内的 token 合并；Markdown 只重解析 stable/tail。
- 结果：主链路已收口，工具密集长流和真机滚动验证通过；剩余 20 分钟 soak 见 **H7**。

### H5. adb 点击坐标与截图不一致

- 现象：按截图坐标点不中。
- 原因：截图被缩放（如 1272→871）或屏幕旋转/分屏。
- 处理：按原始分辨率换算（1.46×）；坐标算完先在截图确认边界。
- 验证：点击后界面按预期变化。

### H6. 键盘把输入区顶飞 / 遮住

- 现象：多行输入或中文候选栏弹出时布局跳动。
- 原因：`adjustResize` + 自定义避让叠加。
- 处理：统一走 `SmoothKeyboardAvoid`；底部安全区单独留；不重复加 padding。
- 验证：1–6 行输入、中文候选都不遮。

### H7. 长会话流式仍抖 / 思考重复（2026-11-04 主体已修，20 分钟 soak 待补）
**现象**

- 20+ 分钟的长任务，思考或正文输出时界面一跳一跳，不是连续流；
- 同一段思考出现两份（一份灰色已完成、一份蓝色思考中）；
- 退出重进后正在进行的思考消失，或下面又冒出一段；
- 列表页状态/预览不跟手，详情页和列表页状态割裂；
- 极端情况下 JS 线程卡死、App 被系统杀掉。

**已确认的根因**

1. **快照 + 实时双回合**：`sessions.get` 的落盘回合和 `block.appended` 的实时回合 id 不同；宿主快照没有 runId 时，客户端只能按内容/时间猜，猜错就出现两份。
2. **active 状态挂在 turn 上**：`ThinkingRow` 的 `live` 曾按整个 streaming 回合传给所有 thinking block，所以同一轮所有思考段都显示“思考中”。
3. **重复 block**：快照里是前半段、实时里是完整段，id 和全文都不相等，普通按 id/全文去重认不出来；需要“前缀相同即同段”的合并。
4. **渲染成本**：`block.text += delta` 是 O(n²) 字符串复制；每个 token 全量 `parseMarkdownBlocks`；整个消息列表用 `ScrollView`，最后一行不断长高。
5. **布局竞争**：最后一行长高、键盘避让、用户滚动三方同时改 offset；Android 上即使每 token 更新，也会表现为跳动。
6. **状态不同步**：`run.started/finished` 只改 detail，不改 `sessions` 列表；`refreshSessions` 也不收口 detail 里残留的 streaming 回合。
7. **缓存脏数据**：重装/恢复后 UI 缓存可能还指向旧模型 id（如 `flash`），发消息 1 秒内被宿主拒绝，表现为“出错”。
8. **实时 block id 跨步骤撞车**：每个 assistant-stream 步骤都从 `block index 0` 重新开始，但 runId 不变；实时 id 会重复，多个步骤的思考可能被合错/重复。
9. **追底状态被测量修正误伤**：仅靠 offset 变化判断用户上滑，会被 FlatList 动态测量修正误触发；跳到底部按钮又放在键盘 padding 区域，键盘弹出时被盖住。

**第一轮已做（历史）**

- 渲染前 `cleanTurns`：连续同 run/同 streaming 的 assistant 回合合并，重复 text/thinking 按内容去重，空 thinking 丢弃；
- `sameBlock` 对 thinking 加前缀判定，保留更长的那份；
- 只有最后一个 thinking block 显示“思考中”，之前显示灰色“思考”+首行预览；
- `run.started/finished` 同步 `sessions`；`flushDeltas` 每次 flush 同步列表 preview；
- `queueMicrotask` 逐 token 提交；Markdown 只全量解析 stable 前缀，tail 逐 token 解析；
- 修复缓存模型 id 校验（不在 models.list 就回退宿主默认）；
- 重新打包 bridge、卸载重装 APK，rootfs 里已确认是新 bridge。

**2026-11-04 收口**

- 新增 `app/src/protocol/turns.ts`：桥和客户端共用 canonical runId / blockId、同 run 合并和跨 run 隔离；删除 UI 层逐 token 去重。
- 桥的 `run.started/finished`、turn、快照投影统一使用 `turn:<n>`；实时 block id 改为 `<runId>:live:<step>:b<index>`，步骤间不再撞车。
- `sessions.get/rename/setPermission/setModel` 都合并当前 live 回合；活跃会话不再把未结束回合标成 done。
- store 的 delta 改成 chunk 数组，微任务 flush；只替换活跃 turn/block 引用；`replace`/`block.updated` 也改成不可变更新。
- `TurnView`、`AssistantTurn`、`ThinkingRow`、`ToolRow`、`MarkdownView`、稳定块列表全部 memo；stable/tail 分开渲染。
- `ChatScreen` 换 `FlatList` + footer blankSpace；follow 状态机要求真实触摸 + `onScrollBeginDrag` 才冻结，避免程序滚动/测量修正误判。
- “回到底部”移入列表容器，键盘弹出时仍在 Composer 上方。
- 新增 `test/stream-turns.test.ts` 与 `scripts/stream-replay.ts`；10 万 delta 回放通过。

**仍然待做**

1. **20 分钟真机 soak**：本轮完成 3000 字、工具密集长流和多次重进，但还没跑到连续 20 分钟。需要补一条带工具、键盘反复开关、多次退出重进的回归。
2. **APK 直装**：设备旧包签名不一致，本轮按 E8 用 Metro + 手动更新 rootfs 桥验证；统一调试签名后再直接 `adb install -r` 验证 APK 内补丁。
3. **VirtualizedList 警告**：真机仍偶发 `large list slow to update` 警告，暂不阻塞交互；后续结合性能基准调窗口参数。

**验证方式**

- 新会话发 20+ 分钟任务；
- 流式期间：只应有一个蓝色“思考中”，其余灰色带预览；
- 上滑应停住，不自动追底；回到底部后再跟随；
- 退出重进：live 思考不丢、不重复；
- 结束后：一个“已完成”、一个用时、列表 status=idle；
- 观察 `adb logcat -s ReactNativeJS` 是否有 duplicate key / 长任务 OOM。

本轮真机已验证：工具密集回合无重复思考；流式中上滑 6 秒内容不动；回到底部按钮可见且可点击；退出重进无重复。

### H8. 切到轻引擎默认后“未连接”（2026-11-04，2026-11-05 已修）

- 现象：旧设备只配过 proot 账号/凭据，没有轻引擎渠道；冷启动首页显示「轻引擎未就绪」，
  `onTrimMemory`/空闲回收掉 proot 后界面停在「重连中」。
- 原因：轻引擎是独立的 OpenAI 兼容渠道（SecureStore 里的 baseURL/apiKey/model），
  旧版本默认直连 proot，从来没配过；不是 1.2 的回归。
- 处理（2026-11-05 已修）：无配置冷启动自动打开配置页；账号已登录时直接读 dsh 账号 token
  （`x-dsh-auth-token`），**不需要 API Key**；也可点「先用完整模式」并记住选择。
  不要为了这个把 proot 改回自动连接（违反 1.2 验收）。
- 验证：无配置自动弹页；账号模式 `[light] ttft=1296ms`；切回轻引擎成功。

## G. 调试

### G1. 引擎日志在哪

`files/logs/engine.log`；`adb shell run-as cool.cnb.dshpalm tail -f files/logs/engine.log`。

### G2. JS 错误在哪

`adb logcat -s ReactNativeJS`；红屏会打印组件栈。

### G3. 桥/引擎端口

- 桥 8788（WS）、dsh 8787（HTTP）。
- 本机调试：`adb forward tcp:18788 tcp:8788` / `tcp:18787 tcp:8787`。

## I. 构建、安装与运行时补充

### I1. debug APK 改了 JS 但界面没变

- 现象：`assembleDebug` + `install -r` 后，代码改动没生效；设备上仍是旧界面。
- 原因：debug 包优先加载 Metro 缓存的 `files/BridgelessReactNativeDevBundle.js`，
  不是 APK 里的 `assets/index.android.bundle`；缓存时间可能早于改动。
- 处理：
  1. 起 Metro（`npm --prefix app start`）+ `adb reverse tcp:8081 tcp:8081`，再重启 App；
  2. 或删掉 `files/BridgelessReactNativeDevBundle.js` 后重启（会回退到 APK 内 bundle）；
  3. 发布/独立使用打 release，避免 dev bundle 依赖。
- 验证：删缓存 + 无 Metro 启动，界面仍是新代码。

### I2. `INSTALL_FAILED_UPDATE_INCOMPATIBLE`（签名不一致）

- 现象：`adb install -r app-debug.apk` 报签名不一致，无法覆盖；`dumpsys package` 的 `lastUpdateTime` 不变。
- 原因：手机上装的包与本机 `debug.keystore` 不是同一套签名（换机器/换 agent 构建常见）。
- 处理：
  1. **不要直接卸载**（会丢会话/登录）；优先用 Metro 加载 JS 改动：`adb reverse tcp:8081 tcp:8081` + 起 Metro + 重启 App；
  2. 需要整包更新时：`run-as` 备份 `files` 与 `shared_prefs` → 卸载 → 装新包 → 还原数据；
  3. 长期：固定一台机器/一个 keystore 构建；release 已接专属 keystore（`scripts/gen-release-keystore.ps1`，
     产物 `keystore/release.jks` + `keystore.properties`，都 gitignore），见 TECHNICAL §9.3。
- 验证：`dumpsys package` 的 `lastUpdateTime` 更新；App 数据仍在。
- 注意：debug 包与 release 包仍是两套签名；release 覆盖 debug 包会失败，需按上面 2 或统一签名。

### I3. 中断后继续问，400 `tool_calls must be followed by tool messages`

- 现象：在审批卡/工具执行时点「结束回话」，再继续提问，模型返回
  `400 An assistant message with 'tool_calls' must be followed by tool messages…`。
- 原因：assistant 的 `tool_calls` 已经写进历史，但用户中断时工具还没执行完，
  对应的 `tool` 消息没写；下一次请求整段历史非法。`trimHistory` 也可能从中间截断。
- 处理：`light/history.ts` 在每次请求前清洗——给缺失的调用补
  `{role:'tool', content:'[已停止] 未执行'}`，丢弃孤立 tool 消息；中断时也主动补齐。
- 验证：原会话继续发消息不再 400，能正常进入 `list_dir` / `bash` 审批卡。

### I4. 默认 PATH 的 Node 20 让 e2e 的 before hook 不执行

- 现象：`npm run verify` 卡住或 e2e 报 `Cannot read properties of undefined (reading 'request')`，
  但单跑部分测试正常。
- 原因：当前 shell 的 `node` 可能指向 20.13（`/usr/local/bin/node`），
  `node:test` 的 `before` hook 在该组合下没有正常执行；项目要求 Node 22+。
- 处理：`PATH="/opt/homebrew/bin:$PATH" npm run verify`（Node 26），或 `nvm use 22`；
  长期在 `package.json` 加 `engines.node >=22`。
- 验证：e2e 的 before 成功，`npm run verify` 全绿。

### I5. `adb shell input text` 被中文输入法改写（2026-11-05）

- 现象：`input text 'create docx file docs/x.docx'` 落进输入框变成
  `Create啊small docx file at docs／verify－share。docx`（空格变“啊”、`/` 和 `.` 变全角）。
- 原因：注入的按键先经过当前中文 IME（Gboard/Sogou），被当作拼音/中文标点处理；`%s` 也会被转换。
- 处理：验证 UI 前临时禁用 IME：
  `adb shell ime disable com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME`，
  输入框仍能收硬件键事件，ASCII 原样落进去；验完 `ime enable` 恢复。
  更稳的做法是用 mock 模型/深链/直接调 native，不依赖 UI 输入。
- 验证：`uiautomator dump` 里出现原样的 `create docx file docs/verify-share.docx`。

### I6. release keystore.properties 的 UTF-8 BOM 让 Gradle 报 `Value is null`（2026-11-05）

- 现象：`assembleRelease` 在 `storeFile rootProject.file(keystoreProperties["storeFile"])` 报
  `A problem occurred evaluating project ':app'. > Value is null`，但 properties 里明明有 `storeFile=`。
- 原因：Windows PowerShell 5.1 的 `Set-Content -Encoding utf8` 写 BOM；Java `Properties.load`
  把 BOM 当成第一个 key 的一部分（`\uFEFFstoreFile`），所以取不到值。
- 处理：用无 BOM 的方式写（`[IO.File]::WriteAllText(..., New-Object Text.UTF8Encoding($false))`）；
  `scripts/gen-release-keystore.ps1` 已改，旧文件可手工去 BOM。
- 验证：`assembleRelease` 通过；`apksigner verify --print-certs` 显示 `CN=DSH Palm`。

### I7. 轻引擎账号模式 401（2026-11-05）

- 现象：轻引擎发消息 1 秒内失败，日志
  `[light] error kind=unauthorized status=401 … Authentication Fails (governor)`；
  ChatScreen 横幅显示「登录或 API Key 无效/已过期（401）」。
- 原因（2026-11-05 已定位并修复）：旧版本保存的轻引擎账号配置可能只有 `baseURL/model`，没有
  `authMode/authToken`；`resolveLightSetup` 只对 `authMode==='account'` 注入 token，结果轻引擎带着
  **auth=none** 去请求，必然 401。日志证据：`[light] auth=none base=https://api.deepseek.com/v1`。
  同一 token 在完整引擎和 PC curl（`x-dsh-auth-token` + `/v1/chat/completions`）都正常，所以不是 token 过期。
- 处理：`resolveLightSetup` 在“没有 apiKey 也没有 authToken”时自动 `loadAccountToken()` 补齐；
  并加脱敏日志 `[light] auth=account(n)/apiKey/none base=…`。恢复入口（401 横幅「重新登录」）保留，
  但它不是根因修复。
- 验证：修复后真机日志 `[light] auth=account(64) base=https://api.deepseek.com/v1`，ready=19ms；
  typecheck + verify 209 pass。

### I8. 审批未决时再发消息，出现重复 React key（2026-11-05）

- 现象：`create_docx` 审批卡未处理时又发一条消息，日志刷
  `Encountered two children with the same key, '.$r_mw3jn4bs_lhyo'`；界面上同一个 run 出现两个
  create_docx 行/两张审批卡，点“批准”很容易点错/失效。
- 原因：先生成的 assistant 回合和随后补发的回合共用同一个 runId（`r_…`），FlatList/TurnView 的 key
  用了 runId；`turnIdsFor`/`cleanTurns` 没有为“同 run 的后续回合”生成唯一 key。
- 处理（2026-11-05 已修）：`ChatScreen` 的 FlatList `keyExtractor` 改为
  `` `${turn.id ?? turn.runId ?? 'turn'}#${index}` ``，同 run 的多个回合不再撞 key；
  提交 `8ef85fa`，typecheck + verify 209 pass。
- 验证（2026-11-05 真机已完成）：重启 Metro/App 后复现「create docx → 不批准 → 再发 wait」，
  再点「拒绝」让同一 run 产出第二个回合；`adb logcat -s ReactNativeJS` 全程无 duplicate key，
  审批卡只保留一张。截图 `scratch/shots/10-rejected.png`。

### I9. 完整引擎切换 approval policy 的提示被当成用户消息（2026-11-05）

- 现象：能力门交接后完整引擎执行完，会话里多出一条用户气泡
  `The approval policy changed from "ask" to "never" (changed by the user).`；
  这不是用户输入，用户会以为是自己发的。
- 原因（初步）：交接把完整引擎 turns 原样并入逻辑会话；DSH 在切 `danger-full-access` 时
  会往会话历史写一条 user 角色提示，`ConversationLink` 只剥 handoff seed 回合，没过滤这类系统提示。
- 处理（2026-11-05 已修）：`handoff.ts` 增加 `fullSideTurns`，合并完整引擎回合时过滤掉以
  `The approval policy changed` 开头的 user 回合；只匹配这句固定文案，真实用户消息不删。
  原生完整会话（不经 ConversationLink）也在 `ChatScreen` 用 `stripEngineNoticeTurns` 过滤展示。
  单测 `handoff.test.ts` 两条：合并不误删真实用户消息、展示层只去 policy 提示。
- 验证：`npm run verify` 217 pass / 0 fail。真机 2026-11-05 23:59 重启 Metro/App 后打开原会话
  「检查 python 文档库版本」，policy 气泡已消失（截图 `scratch/shots/102-i9-filtered.png`）；
  原生完整会话与 handoff 合并两条路径都过滤。

### I10. 长会话 soak 内存（2026-11-05，观察）

- 20 分钟：light 会话 33 个回合 / 41 次流式调用后 PSS 623 MB（RSS 804 MB）；中途采样
  485 MB（12 回合）→ 531 MB（21 回合）→ 623 MB（33 回合）。Native 282→312 MB，Java 48→54 MB。
- 40 分钟复核（2026-11-05 22:08–22:48，新会话、deepseek-chat、chat-only 提示，49 轮）：
  PSS 461 MB 起步，稳定在 **430–501 MB**（37 分钟时 431 MB），RSS 600–683 MB，无 OOM/崩溃。
- 42.5 分钟复核（2026-11-05 22:58–23:40，用户要用手机主动停；52 轮、43 次采样）：
  PSS 391 MB 起步 → 30 分钟 524 MB → 峰值 546 MB（23:38）→ 结束 465 MB；RSS 566→722→638 MB；
  无 OOM/崩溃。两次 40 分钟级运行都是“涨一段再回落”，没有单调线性上涨。
- 说明 20 分钟那次的 623 MB 更像峰值/GC 抖动，不是线性泄漏。
- **90 分钟完成**（2026-11-06 00:11–01:42，109 轮、90 次采样）：PSS 349 MB 起步 → 14 分钟 465 →
  30–59 分钟 433–449 平台 → 74 分钟 556 → 结束 601–615 MB（峰值 644）；RSS 454→734（峰值 763）。
  无 OOM/崩溃，结束时会话仍可滚动/输入。形态是“随上下文增长的分段上涨”，不是每轮线性泄漏；
  单会话 90 分钟 soak 已跑通，后续只需在更长上下文（如 >200 轮）或图片/附件场景再观察。
- 附带：`VirtualizedList: You have a large list that is slow to update` 在 20 分钟那次出现 1 次
  （dt 1109ms，prevDt 24543ms）；duplicate key 全程 0。
- 推测：长回答（20 分钟那次最后一次 in:37155 tokens）留在 JS 状态与 Markdown 视图里，
  `ChatScreen` 的 FlatList 是 `removeClippedSubviews={false}` + `windowSize=9`；
  回合越多驻留的 native view/文本越高，但 40 分钟数据没有持续上涨。
- 下一步：90 分钟 soak 看是否线性上涨（40 分钟那次为回归 UI 主动停止，不算完成 90 分钟）；
  用 `dumpsys meminfo`/heap profile 区分「列表驻留」与「RN 泄漏」；必要时改
  `removeClippedSubviews`/窗口大小或给长会话做回合降采样。

### I11. 脚本点真机按钮点空（2026-11-06）

- 现象：`adb shell input tap x y` 看着点在发送/选项/批准上，界面没反应；键盘弹出后更容易点空。
- 原因：聊天截图预览按比例缩放（1272×2800 → 871×1918），按预览像素估坐标会偏 100+ px；
  键盘/输入框弹出后布局整体上移，旧坐标直接失效。
- 处理：先 `adb shell uiautomator dump /sdcard/window.xml` 拉回 XML，按目标节点 `bounds`
  算中心点再 tap；点击后截图确认状态，不连点。输入用 `adb shell input text`（空格写 `%s`）。
- 验证：2026-11-06 用 bounds 点发送/选项/批准，提问/审批/能力门三类卡片一次走通。

### I12. `verify` 偶发 ENOTEMPTY 清理失败（2026-11-06，已修）

- 现象：`npm run verify` 偶发 `ENOTEMPTY: directory not empty, rmdir …/dsh-palm-light-*/sessions`，
  单跑重试即过；首次 240 pass，第二次 240 pass / 1 fail，第三次又全绿。
- 原因：`test/light-engine.test.ts` 的 `after` 用 `rm(recursive)` 清临时目录时，测试内仍有
  异步落盘收尾，属于测试清理竞争，不是产品代码失败。
- 处理：已给 `after` 的 `rm` 加 `maxRetries: 5, retryDelay: 50`（Node 对 ENOTEMPTY 自动重试）。
- 验证：连续 3 次 `npm run verify` 均为 240 pass / 0 fail（数量以命令输出为准）。





### I13. 深色主题不能靠改 `colors` 常量（2026-11-06）

- 现象：只加一个主题开关、把 `theme.ts` 的浅色值换掉，界面不会整体变色；部分页面黑了但文字还是深灰，
  Markdown/审批卡仍是浅色。
- 原因：所有页面在模块加载时 `StyleSheet.create`，颜色是字面量快照；`MarkdownView` 还有模块级可变
  `styles` 和字号重建，`React.memo` 子组件不会因为父级重渲染自动更新。
- 处理：颜色拆到 `theme/palette.ts`，`ThemeProvider` 下发 palette；页面用
  `createStyles(theme)` + `useThemedStyles`；Markdown 用 `MarkdownStylesContext` 同时下发
  主题/字号/语法色；memo 子组件自己消费 context。深色主按钮用 `onAccent`（深色字），
  不要沿用白字；`onDanger` 在深色下也用深色字保证对比度。
- 验证：全局搜颜色字面量只剩 `theme/palette.ts`；Web 深色/浅色截图（设置、主题页、聊天、
  审批卡）；`npm --prefix app run typecheck` + `npm run verify` 全绿。
