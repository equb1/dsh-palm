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

### E2. 分享只处理冷启动

- 现象：App 在后台时分享进来没反应。
- 原因：只读了 `getInitialShare()`，没处理 `onNewIntent`。
- 处理：当前先接受冷启动；后台分享待做。
- 验证：冷启动分享文字能进输入框。

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
- 原因：`block.delta` 直接 `patch({})`，没有合并/行缓存。
- 处理：U3 做 32ms 合并 + 稳定 key 行缓存。
- 验证：流式滚动不掉帧（主观 + 抽测）。

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

## G. 调试

### G1. 引擎日志在哪

`files/logs/engine.log`；`adb shell run-as cool.cnb.dshpalm tail -f files/logs/engine.log`。

### G2. JS 错误在哪

`adb logcat -s ReactNativeJS`；红屏会打印组件栈。

### G3. 桥/引擎端口

- 桥 8788（WS）、dsh 8787（HTTP）。
- 本机调试：`adb forward tcp:18788 tcp:8788` / `tcp:18787 tcp:8787`。
