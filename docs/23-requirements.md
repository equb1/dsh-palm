# 23 · 需求与运行时分工（v1 冻结稿）

> 状态：**v1 需求冻结（2026-11-02）**。
> 本文是产品需求 + 运行时分工的单一事实来源；与 [22-cross-platform-ts-engine.md](22-cross-platform-ts-engine.md) 冲突时以本文为准
>（22 里"纯 TS 替换 proot""账号即通道""2.5.2 100% 合规"三处已被修正）。

## 0. 一句话

**手机是完整宿主**：默认跑轻量 TS 引擎（秒开），需要真环境时按需拉起完整引擎（proot），电脑是可选的另一台宿主；三者共用一套会话 / 审批 / 工具协议。

## 1. 目标与非目标

**目标（v1）**

1. 手机离线可用的 agent：问答、文档、票据、会议纪要、生图、语音输入。
2. 默认体验快：**冷启动到可输入 < 1s（P90）**，轻引擎就绪 < 300ms；完整引擎按需启动。
3. **能跑现有 DSH 插件**：按兼容等级自动选择运行时（见第 4 节）。
4. 官方账号登录；手机与电脑的会话可聚合、可续跑、可双向委派。
5. Android 桌面小组件 / 悬浮球；iOS 小组件 / 实时活动。

**非目标（v1 明确不做）**

- 手机端作为代码开发主场景（写代码、跑仓库让给电脑；proot 只是可选能力）。
- 在轻引擎里运行 Node 原生插件（依赖 `node:fs`/`child_process` 的旧插件）——不承诺。
- iOS 全局悬浮窗（系统不允许）。
- 推送、插件市场交易、桌宠、皮肤。

## 2. 能力 → 运行时矩阵

| 能力 | 运行时 | 具体实现 | 备注 |
|---|---|---|---|
| 问答 / 写作 / 推理 / 多轮会话 | 轻 TS 引擎 | Hermes + Cordis + 自带 agent loop | 流式/思考/审批/提问 |
| 文档生成与解析（docx/xlsx；PDF 暂缓） | 轻 TS | docx、SheetJS（PDF 的 pdf-lib/pdf.js 暂缓） | 覆盖率主路径 |
| 文档格式转换与渲染（office→pdf/png） | 完整引擎 / 电脑端 | Android：proot 里的真 LibreOffice；双端：电脑端 LibreOfficeKit 服务；可选 WKWebView + ZetaOffice（仅小文档） | **v1 暂缓（见 28 C8）**；Hermes 无 WASM（实测 RN 0.88 的 `libhermesvm.so` 里没有 `WebAssembly` 符号）；LO wasm 要 pthreads + GB 级堆，手机必 OOM（见 R1） |
| 生成图像 | 轻 TS | 调图像模型 API + 落盘 | 官方账号只有文本模型，需另配 provider |
| 图像理解 / OCR | 原生 | ML Kit / Vision | |
| 录音 / 转写 | 原生 | sherpa-onnx（DSH 已有 sensevoice 包） | |
| 语音合成 | API 或原生 | 看 provider | |
| 音视频转码 / 剪辑 | 原生（可选） | ffmpeg-kit | 只录音转写可不要 |
| **写**脚本 | 轻 TS | 模型输出文本 | 不需要运行时 |
| **跑**脚本（python/node/shell） | **完整引擎（proot）** | 真 Linux + Node 24 | 唯一必须真环境的硬需求 |
| 浏览器操作 | 手机 WebView / 电脑原插件 | DOM 桥 | |
| 旧 DSH 插件 | 分五层，见第 4 节 | | |
| 多端互联 | 桥 + 中继 | | 账号只做身份 |

## 3. 运行时分层

```
App（RN 原生壳）
├─ LightEngine        TS/Hermes：默认引擎，<300ms 就绪
├─ NativeCapabilities OCR / ASR / ffmpeg / sqlite / WASM(?)
├─ FullEngine         proot + Node24 + 原版 dsh：按需启动，13.7s
├─ WebSurface         WebView → 官方 web 前端：旧 UI 插件零改动
└─ RemoteHosts        电脑端引擎（桥 / relay）
```

**能力路由器（Capability Router）**

- 建会话时按预设选默认引擎（文档/票据/纪要 → 轻引擎；"开发者"预设 → 完整引擎）。
- 工具调用时发现当前引擎缺能力（要跑脚本、要格式转换、要用 L3 插件）→ 提示"切到完整模式"，用户确认后**会话迁移**（导入上下文与文件引用）。
- 界面永远只认协议，不认引擎（`docs/02-architecture.md` 的能力协商原则）。

**启动策略**

- 轻引擎随 UI 启动；完整引擎默认不启动（用户第一次需要时才拉起），并尽量常驻（前台服务 + 独立进程）。
- UI 首屏只读本地缓存，绝不等引擎（`docs/08-verification.md` 的结论）。

## 4. 插件兼容体系（核心差异化）

现有 DSH 插件分两类：**服务端 Node 包**（cordis 插件）和 **浏览器 UI 包**（`dsh-client-ui-*`，52 个）。手机端按五层兼容：

### 4.1 五个兼容层

| 层 | 插件形态 | 手机端跑法 | 改动量 | 启动成本 |
|---|---|---|---|---|
| **L0** | Web UI 插件 | 内置 WebView 打开本机/电脑的官方 web 前端 | **零改动** | 随 WebView |
| **L1** | 纯 JS 服务端插件（只用 path/events/url 等轻内建） | 轻 TS 引擎 + node 内建 shim | 小（shim 层） | 亚秒 |
| **L2** | 需要 fs/http/net/crypto 等 Node 内建 | **当前没有可用运行时**：只能进 proot（按 L3 处理），或由轻引擎重写 | 中 | 2–4s（前提是有内嵌 Node，目前不成立） |
| **L3** | 需要真实二进制（child_process / python / git / libreoffice） | 完整引擎（proot + 真 Linux） | 零改动 | 13.7s，按需 |
| **L4** | 需要桌面能力（Electron API、本地大模型、系统权限） | 电脑端执行，手机远程调用 | 零改动 | 无（电脑开销） |

> 关键判断：**L0 和 L4 是"零改动"就能拿到的最大红利**——前者复用整套 web 插件 UI，后者复用整台电脑。
> L1 需要写一层 shim；L3 就是我们现在的 proot。
>
> **R4 结论（2026-11-02）**：内嵌 Node 这条路暂时走不通——`nodejs-mobile` 停在 Node 18.20.4，
> 而 DSH 0.2.1 用了 Node 22.15+ 的 `node:zlib` zstd、`node:sqlite`、`Promise.withResolvers` 等；
> koffi / node-pty / sharp / sherpa / node-addon-require-builtin 也都没有 Android prebuild。
> **所以 L2 目前没有运行时可落**：L2 包要么进 proot（按 L3 处理），要么由轻引擎重写。

### 4.2 兼容分析器（把"兼容"变成产品能力）

做一个 **`dsh-plugin-check` 静态分析器**（Node 脚本，CI + 手机端共用）：

- 输入：npm 包名或本地插件目录。
- 扫描：`node:*` 内建引用、`child_process`、`.node` 原生模块、Electron/DOM 依赖、`engines` 声明、动态 `import()`。
- 输出：`L0–L4` 等级 + 判定理由 + 可自动修复项 + 建议运行时。
- 集成：手机插件市场/设置页给每个插件打徽章 **「手机原生 / 手机完整 / 仅电脑」**；CI 每次发版对 dsh 全量 305 个包跑一遍，生成兼容矩阵。

**为什么这是优势**：别人的手机端只能"重写一套手机插件"；我们有存量插件的**归属判定**——用户装一个插件前就知道它能不能在手机上跑、跑在哪一层。这比"支持插件"三个字值钱。

### 4.3 自动转译（后期，仅 L1）

对 L1 插件提供 `phone-bundle` 流水线：esbuild 打包 + node 内建 shim + 把 `fs` 映射到 RN 文件系统适配器，产出一个可直接被轻引擎加载的 bundle，并附兼容报告。**只对 L1 做**，不假装能把 Node 原生插件搬过来。

### 4.4 边界（必须写进文档，避免预期错位）

- 旧 Node 插件**只能**在 L3（proot 完整引擎）里跑；轻引擎不承诺兼容它们。
- UI 插件在 RN 原生界面里**不重绘**，只在 WebView 里用；原生界面和 WebView 是两套皮肤、同一份数据。
- 插件下载执行受 App Store 2.5.2 约束：市场只做"启用/禁用 + 配置下发 + 内置插件"，不做"下载 JS 后执行"。

## 5. 账号与多端互联

**登录（官方 OAuth）**

- 官方包 `@deepseek-ai/dsh-deepseek-account-platform`：browser PKCE、loopback 回调、token 无 refresh。
- 源码约束（已读 v0.2.1-rc.5）：`redirect_uri` 必须是 `http://localhost|127.0.0.1|[::1]:<显式端口>/oauth/callback`，
  **不支持自定义 scheme**，路径不可配；state/PKCE 只存在内存，App 被杀则登录尝试作废（token 无 refresh，只能重登）。
- 手机方案：App 内起 `127.0.0.1` 随机端口 HTTP server（路由固定 `/oauth/callback`），
  `ASWebAuthenticationSession`（iOS）/ Custom Tabs（Android）打开授权页，回调后换 token 存 SecureStore（Keychain/Keystore）。
- Platform 侧的 `redirect_uri` 白名单不可见，需真机跑一次登录确认（R3）。
- 多账号：凭据按 accountId 隔离；设备列表可切换。

**互联（账号只做身份，不做通道）**

| 层 | 通道 | 场景 |
|---|---|---|
| 1 | 同 Wi-Fi 直连（mDNS/IP + 端到端加密 WS） | 家里/办公室 |
| 2 | 自建 relay（Cloudflare Workers/Durable Objects 或 Tailscale） | 跨网，零配置体验 |
| 3 | WebRTC DataChannel + TURN | 低延迟，relay 流量兜底 |

- 语义沿用 `docs/02-architecture.md`：镜像 / 分叉 / 委派；**单 writer**；文件只同步索引，正文按引用 `dsh://<host>/<path>` 按需拉。
- 降级红线：电脑离线时手机全部本地功能不受影响。

## 6. 系统入口

| 平台 | 小组件 | 悬浮 / 快捷 |
|---|---|---|
| Android | AppWidget（RemoteViews） | overlay 悬浮球（`SYSTEM_ALERT_WINDOW`）、QS 磁贴、分享目标 |
| iOS | WidgetKit | Live Activity / 灵动岛、App Intents / 快捷指令、Share Extension |

入口只承载四件事：**最近会话、任务进度、一键语音、审批提醒**；点击进 App，不在入口里跑长任务。

## 7. 数据与隐私

| 实体 | 归属 | 同步 |
|---|---|---|
| 账号凭据 | 账号级 | 端到端加密 |
| 设备身份/公钥 | 账号级 | 是 |
| 会话 | 宿主级 | 只同步元数据与状态，正文按需 |
| 文件 | 宿主级 | 否，靠引用 |
| 插件兼容报告 | 公共 | 可缓存 |

relay 只见密文；文件永不离家。

## 8. 里程碑

| 阶段 | 内容 | 产出 |
|---|---|---|
| **M0（2 周）** | 四个 spike + 兼容分析器（✅ 2026-11-02 完成静态部分） | 结论见第 9 节 + [24-plugin-compat-matrix](24-plugin-compat-matrix.md) |
| **M1（4 周）** | LightEngine MVP：会话/流式/审批/提问 + 文档 JS 库 + 生图 | Android 可用的轻引擎（会话/文档/表格/生图已完成，见 [26-light-engine.md](26-light-engine.md)；PDF 待中文字体方案） |
| **M2（4 周）** | WebSurface（WebView 官方前端）+ 完整引擎按需 + 插件徽章 | L0/L3 可用 |
| **M3（4 周）** | 官方登录 + LAN 互联 + Android 小组件/悬浮球 | v1 内测 |
| **M4** | relay/WebRTC + iOS + L1 自动转译 | 公测 |

## 9. 风险与 spike

### 已完成（2026-11-02，M0 前半）

**R1 · WASM —— 不可行。**
- Hermes 没有 WebAssembly：RN 0.84 起官方在把 WASM 带进 Hermes，但本项目 RN 0.88.1 的 `libhermesvm.so` 里搜不到 `WebAssembly` 符号；RN 的 WASM 方案只有 JSI 解释器（wasm3，单内存）和构建期 AOT（polygen，不支持 threads/exceptions）两类。
- LibreOffice 的真正阻塞是运行时契约：Emscripten pthreads 需要 SharedArrayBuffer/COOP-COEP；`libreoffice-kit-wasm 0.2.3` 48MB tgz / 152MB 解包，同类浏览器版首下 ~240MB、GB 级堆 → 手机必 OOM。
- 结论：office→pdf 放 **proot（Android）** 或 **电脑端 LibreOfficeKit（双端）**；iOS 只能电脑端或商业原生 SDK。
  **v1 暂缓，见 [28](28-engine-routing.md) C8。**

**R4 · 内嵌 Node —— 不可行。**
- `nodejs-mobile-react-native` 最新 18.20.4（2024-10 发布），没有 22.x 分支；DSH 启动即用 Node 22.15+ API（`node:zlib` 的 zstd、`node:sqlite`），Node 18 直接 SyntaxError。
- 原生依赖 koffi / node-pty / sharp / sherpa / require-builtin 都没有 Android prebuild；nodejs-mobile 也没有 fork/exec，PTY 与 subprocess 直接废。
- 结论：L2 不设独立运行时，按 L3 或重写处理。

**R2 · just-bash —— 已在真机验证（功能 + 性能基线）。**
- 实测 RN 0.88.1 的 Hermes：`TextEncoder` / `TextDecoder` / `atob` / `btoa` / `Intl` **有**；`Buffer` / `crypto` / `fetch` / `AbortController` / `performance` / `WebAssembly` **没有**（其中 fetch、AbortController 由 RN 运行时提供）。
- 真机（PLR110）跑通：补 `Buffer` / `crypto.getRandomValues` / `performance` 三个 shim、Metro 给 `node:zlib` 一个 stub 即可；
  日常命令（echo / grep / for / 重定向 / ls）**1–2ms**，`seq 5万 | sed` 273ms，`seq 10万 | awk` 4.6s。
- 结论：**可行**。剩余是集成工作：`IFileSystem` 适配真实目录、命令覆盖、执行限额。详见 [25-m1-spike-results.md](25-m1-spike-results.md)。

**R3 · OAuth —— 可行，但要移植（源码结论，待真机登录验证）。**
- 官方包不自己起 server：它向 Host 的 `webServer` 注册固定路由 `/oauth/callback`（源码 `ctx.get("webServer")`，缺失直接报 protocol）。
- `redirect_uri` 只认 `http://localhost|127.0.0.1|[::1]:<显式端口>/oauth/callback`；**https loopback、自定义 scheme、`127.0.0.2` 一律拒绝**；端口可随机。
- RN 复用清单：① 用 App 内 loopback HTTP server 替换 webServer（端口 0 由系统分配）；② 保持 redirect 规则与 PKCE/state 流程；③ 替换 Node API（crypto/stream/Buffer/`Promise.withResolvers`/`AbortSignal.any`）；④ 凭据落 Keychain/Keystore；⑤ 去掉 Cordis Service 外壳；⑥ 用 `Linking.openURL` 打开授权页。
- 遗留风险：Platform 服务端是否接受该 loopback redirect 需实测；授权完成页 302 到 platform 的 `/dsh/authorized`，外部浏览器不会自动回 App（需中间页/深链，或用 desktop 变体走 204）。
- 另外两个源码级细节要记住：回调 handler **不处理 `error` 参数**（用户拒绝授权时会一直等到 600s 超时，而不是立刻失败）；`state`/PKCE 只存在内存，App 被杀后只能重新发起。

### 待验证（都要真机）

| 编号 | 要验证什么 | 验证方式 | 不过则 |
|---|---|---|---|
| R3' | Platform 服务端是否接受手机 loopback 回调 | App 内起 loopback server 走一次真实授权 | 电脑代授权，或等上游支持 custom scheme |

（R1、R4 已闭环：都不可行，方案已按结论调整。R2 已真机验证，见 [25-m1-spike-results.md](25-m1-spike-results.md)。）

## 10. v1 验收标准

1. 冷启动到可输入 **< 1s（P90）**；轻引擎就绪 **< 300ms**。
2. 完整引擎首次启动 < 15s，且只在用户需要时发生；之后常驻。
3. 兼容矩阵覆盖 dsh 0.2.1-rc.5 全部 305 个包，人工抽检准确率 > 95%。
4. 手机端可运行 L0 + L1 插件占全量 **≥ 60%**（按包数）。
5. 断网可用：会话、文档、OCR、文件操作；联网后自动补模型调用。
6. 账号登录后，电脑在线时手机能看到并续跑电脑会话；电脑离线不影响手机。

## 11. 与其它文档的关系

- `02-architecture.md`：分层与跨设备语义（本文沿用）。
- `05-runtime.md` / `08-verification.md`：proot 的启动实测与"引擎常驻"决策（本文沿用）。
- `17-handoff.md`：当前 Android 实现的现状与坑。
- `28-engine-routing.md`：轻引擎/proot 的路由、加载、切换、附件与 Office 分流（2026-11-03 确认）。
- `22-cross-platform-ts-engine.md`：方向（纯 TS + iOS）保留；"替换 proot""账号即通道""2.5.2 100% 合规"三处按本文修正。
