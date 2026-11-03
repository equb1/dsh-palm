# 锦囊 · 技术文档

> 状态：2026-11-03。**本文件是实现方式的唯一来源**（需求见 [REQUIREMENTS](REQUIREMENTS.md)）。
> 深细节保留在 archive：dsh API 原文 [archive/10-dsh-api.md](archive/10-dsh-api.md)、
> 插件矩阵 [archive/24-plugin-compat-matrix.md](archive/24-plugin-compat-matrix.md)。

## 目录

1. 总架构
2. 协议
3. 真 dsh 接口
4. 运行时 A：proot 宿主
5. 运行时 B：轻引擎
6. 引擎路由与加载
7. 登录与配对
8. UI 基线
9. 构建与验证
10. 插件兼容
11. 目录结构

## 1. 总架构

```
RN App（UI，只认协议）
 ├─ EngineClient（WS）── 桥 :8788 ── proot 里的 dsh web :8787
 ├─ LocalEngineClient（进程内）── LightHost（TS 引擎）
 ├─ 原生宿主：HostService（前台服务）→ proot/Node/桥
 └─ 原生能力：分享/通知/相机/OCR/ASR/SecureStore（轻引擎侧）
```

- **一条协议**：客户端与引擎之间只有请求/响应 + 事件；换引擎不影响 UI。
- **两种 transport**：`EngineClient`（WebSocket，连本机桥或电脑宿主）、`LocalEngineClient`（函数调用）。
- **共享工作区**：`<filesDir>/workspace`；proot 里 bind 到 `/root/work`。
- **共享会话/审批/工具语义**：两边都实现 `sessions.*`、`approvals.*`、`questions.answer` 等。

## 2. 协议

定义在 `app/src/protocol/index.ts`，`PROTOCOL_VERSION = 1`。

### 2.1 消息

```ts
// 请求
{ type: 'req', v: 1, id: string, method: string, payload: { args: unknown } }
// 响应
{ type: 'res', v: 1, id: string, ok: true, result: unknown }
{ type: 'res', v: 1, id: string, ok: false, error: { code, message, hint? } }
// 事件
{ type: 'event', v: 1, event: string, seq: number, data: unknown }
```

### 2.2 方法（当前）

- 会话：`capabilities.get`、`sessions.list/create/get/send/steer/stop/rename/pin/archive`、`sessions.setModel/setPermission/setPreset`
- 审批/提问：`approvals.list/resolve`、`questions.answer`
- 模型：`models.list`、`presets.list`、`permissions.list`
- 账号：`account.state/signIn/cancelSignIn/signOut`
- 提供商：`providers.list/catalog/discover/save/remove`、`credentials.describe/set/unset`
- 附件：`attachments.upload`
- 工作区：`workspaces.list/create`
- 引擎状态：`engine.status`

### 2.3 事件

`session.created/updated`、`block.appended/delta/updated`、`run.started/finished`、
`approval.requested/resolved`、`account.updated`、`job.progress/done`、`device.paired`。

### 2.4 错误码

`bad_request`、`not_found`、`unauthorized`、`forbidden`、`conflict`、`unsupported`、`timeout`、`internal`。
UI 侧统一经 `app/src/lib/errors.ts` 翻成人话。

## 3. 真 dsh 接口

### 3.1 传输

- HTTP：`POST http://127.0.0.1:8787/api/<namespace>/<method>`
  body：`{ type: 'client-request', rpcId, method, payload: { args } }`。
- 鉴权：先 `GET /?token=<webServerToken>` 换 cookie，再带 cookie 调 API。
- 流：`GET /api/remote.mux?token=...` 的 WebSocket，收 `session/follow`、`account/watch`、`$events`。
- token 从引擎日志 `http://127.0.0.1:8787/?token=...` 取。

### 3.2 会话

- 列表：`session/list`（分页）；详情：`session/snapshot`（记录数组）；
  发送：`session/send`；插话：`session/steer`；取消：`session/cancel`；
  改名：`session/rename { request: { sessionId, title } }`。
- 钉/归档在 workspace 控制器：`workspace/pinSession|unpinSession|archiveSession|unarchiveSession`。
- **没有**会话删除、正文搜索的远程接口。
- 事件投影：`engine/src/real/project.ts` 把 `user/message`、`assistant/message`、工具调用等
  折成 `Turn/Block`；`run.finished` 映射状态。

### 3.3 账号

`account/getState`、`account/startSignIn {client, callbackOrigin, loginSource}`、
`account/cancelSignIn`、`account/signOut`、`account/watch`。
回调路由固定 `/oauth/callback`，由引擎自己的 webServer 提供，不需要 dsh cookie。

### 3.4 提供商

- `llm/listProviders`、`llm/listConfigurableProviders`（43 条目录）、
  `llm/discoverModels { settingsNs:'llm-pi-ai', request:{ baseURL, api, apiKey? } }`。
- 写入：`settings/mutate { ns:'llm-pi-ai', ops:[{op:'set', path, value}] }` + `credentials/set`。
- profile：`{ displayName?, apiKeyEnv?, api, baseURL, models:[{id,name?,contextWindow?,maxTokens?}] }`。
- 协议：`openai-completions` / `openai-responses` / `anthropic-messages`。
- key ref：`<ID>_API_KEY`（大写、非字母数字转下划线）。
- 目录模式只写 `apiKeyEnv`（+可选 baseURL），模型由适配器提供；自定义模式写完整 profile。

## 4. 运行时 A：proot 宿主

### 4.1 组成

| 组件 | 位置 | 作用 |
|---|---|---|
| `rootfs.bin` | APK assets | Ubuntu 24.04 rootfs（解压约 125MB） |
| `payload.bin` | APK assets | Node 24 + dsh + 桥 + patch（约 158MB） |
| `RuntimeInstaller` | Kotlin | 解压、迁移、DNS、补丁、权限、进度 |
| `HostService` | Kotlin FGS | 前台服务，起 proot/Node/桥，通知进度 |
| `HostRuntime` | Kotlin | 进程管理、看门狗、日志、状态 |
| `dsh-palm-bridge.cjs` | APK assets → rootfs | 单文件桥（78KB），WS :8788 ↔ dsh :8787 |

### 4.2 启动链

```
App → startHost() → HostService.onStartCommand
  → RuntimeInstaller.ensureLayout（工作区/密钥/.dsh 外置 + 迁移 + DNS）
  → ensurePatch（fs-link-fallback + 桥）
  → proot -b workspace:/root/work -b bridge:/bridge -b .dsh:/root/.dsh
       → node .../dsh/lib/bin.js web --port 8787
  → node bridge.cjs（读 8787 token，开 8788）
  → 日志出现 token/配对码 → 状态 ready
App 轮询 host.status() → maybeAutoConnect() → 连 ws://127.0.0.1:8788/ws
```

### 4.3 关键约束

- proot 冷启动 **13.7s**；node 常驻约 **239MB**，桥约 **80MB**；App 自身约 320MB。
- 桥必须每次启动前清掉残留（按命令行匹配 `dsh-palm-bridge.cjs` / `dsh/bin.js`）。
- 引擎连续失败 3 次 → 下次启动把 `profiles` 挪成 `profiles.broken-<ts>`（安全模式）。
- rootfs 里 `~/.dsh` 是空挂载点，真实数据在 `files/home/.dsh`。
- 设备密钥在 `files/bridge/devices.json`；配对码是首次连的六位码。
- DNS：从 ConnectivityManager 读系统 DNS 写 `rootfs/etc/resolv.conf`，兜底 223.5.5.5 / 119.29.29.29。
- 16KB page size 未在老设备验证。

### 4.4 数据位置

| 数据 | 路径 |
|---|---|
| 工作区 | `files/workspace`（guest `/root/work`） |
| dsh home | `files/home/.dsh`（guest `/root/.dsh`） |
| 设备密钥 | `files/bridge/devices.json` |
| 日志 | `files/logs/engine.log` |
| rootfs | `files/runtime/rootfs` |

## 5. 运行时 B：轻引擎

### 5.1 结构

```
app/src/engine/light/   Agent、provider（SSE）、tools、sessionRepo、host（协议实现）
app/src/engine/fs/      SandboxFs（chroot 路径、errno、读上限）、Node/Expo 后端、MountableFs
app/src/engine/shell/   just-bash + 限额（30s、2000 命令、24k 输出…）
```

- 进程内运行，UI 用 `LocalEngineClient`；**没有 WebSocket**。
- 工作区：`<filesDir>/workspace`；数据区另挂只读/可写沙箱。
- 工具（10）：`bash`、`read_file`、`write_file`、`list_dir`、`ask_user_question`、
  `create_docx`、`read_docx`、`create_xlsx`、`read_xlsx`、`generate_image`。
- 文档：docx（标题/段落/列表/表格/代码/分页）、xlsx（值、多 sheet）；**无样式/公式、无编辑**。
- 生图：OpenAI 兼容 images API；支持 `b64_json`/`url`。
- 会话：本地 JSON 存储；支持流式、审批、提问；**附件上传未实现**。
- 限制：单次读 10MB；软链 EPERM；chmod/utimes 只内存；bash 无 python/js/网络。

### 5.2 模型调用

OpenAI 兼容 `/chat/completions`，SSE 流；记录 ttft/stream 耗时（`[light]` 日志）。
渠道配置存 SecureStore（baseURL/apiKey/model），支持 `dshpalm://light?...` 深链覆盖。

## 6. 引擎路由与加载

> 完整规则见历史定稿 [archive/28-engine-routing.md](archive/28-engine-routing.md)；
> 这里是实现摘要。**任务清单在 AI-TASKS，不在这里。**

### 6.1 默认

- 有轻引擎配置 → **默认轻引擎**；proot 触发式（不自动连接）。
- `warmLocalHost()`：只 `startHost()` 不 `connect`，UI 继续用 light。
- 顶栏「轻/完整」角标；手动切换仅在空闲时可用。
- 预热档位：触发式（默认）/ 智能预热（充电+WiFi，可选）/ 常备（高级）。
- 回收：无运行回合且 idle 10min 停 proot；`onTrimMemory` 优先停 proot。

### 6.2 预路由

| 命中 | 引擎 |
|---|---|
| 跑代码/脚本、python/node/npm/git/ffmpeg、编译、测试、装依赖 | proot |
| 转 PDF/渲染/旧格式 | **默认不做**；需要时电脑端或 proot 可选 LibreOffice |
| 后台/锁屏长任务 | proot（light 后台会冻结） |
| 其余 | light，失败走能力门 |

### 6.3 能力门与 Handoff

1. light 工具执行前检查能力；缺能力返回 `capability_missing`，**无副作用**；
2. 用户确认 → 启/连 proot → Handoff → 只重发未执行步骤；
3. 已执行工具结果原样带走，**绝不重放**；
4. 失败回退 light，保留当前回合。

Handoff 字段：`conversationId`、`presetId`、`permission`、模型/渠道、摘要、
最近 8 轮原文（含工具结果）、文件引用、`pendingIntent`。
一条逻辑会话：`ConversationLink` 映射两个 sessionId；原会话只读保留。
模型/渠道必须一致；不一致要明示。

### 6.4 附件

**收件永远原生**：复制到 `workspace/uploads/<hash>-<name>`，生路径引用（不走 base64）。
判定顺序：原生预处理（OCR/ASR）→ 按剩余操作选引擎 → 有任一 proot-only 文件就在 proot 汇合。
PDF/未支持格式：只保存 + 提示，不解析。

### 6.5 Office

| 操作 | 引擎 |
|---|---|
| docx/xlsx 创建、读取 | light |
| docx/xlsx 编辑、复杂版式/公式 | proot + Python 三件套 |
| pptx 全部 | proot + Python 三件套 |
| 旧 .doc/.ppt、render、recalc、PDF | LibreOffice（默认不做） |

Python 三件套：`python3 + python-docx + openpyxl + python-pptx`（约 50–60MB）。
`dsh-skill-office` 已在 rootfs；缺 Python 和 linux-arm64 LibreOfficeKit。

### 6.6 已确认决策

C1 默认 light；C2 预热默认关；C3 会话统一 + badge；C4 配置共享；
C5 摘要+8 轮迁移；C6 原生收件 + 路径引用；C7 Office 三件套；
C8 render/recalc/旧格式/PDF 暂不做；C9 light 不补 pptx；C10 后台必须 proot；
C11 模型一致；C12 本文档；C13 PDF 附件只存；C14 PDF 生成延期。

## 7. 登录与配对

### 7.1 配对

- 桥打印六位配对码；App `ws://<host>:8788/ws?pair=<code>` 首连；
- 成功后桥发设备密钥，App 存 SecureStore；之后用 `key=<deviceKey>` 免码；
- 设备密钥文件在 `files/bridge/devices.json`；`dshpalm://pair?url=...&code=...` 可外部唤起。

### 7.2 官方账号

- `connect` 后 `account.state` 判断；未登录则 `account.signIn`
  （`callbackOrigin` 指向本机 webServer 的 `/oauth/callback`）。
- App 打开返回的 `authorizeUrl`；用户在浏览器完成授权；引擎收到回调后换 token。
- App 监听 `account.updated`；token 无 refresh，过期需重登。
- 授权页由 App 在 `pendingSignIn` 时自动打开；也提供「重新打开授权页」。

### 7.3 模型提供商

目录 43 条 + 自定义。UI：设置 → 模型提供商 → 两个 tab。保存后刷新 `models.list`，
会话模型胶囊里可见。Key 落 dsh credentials；`credentials.describe` 只回 configured，不回明文。

## 8. UI 基线

- 近黑背景 `#0A0B0F`、玻璃层 `rgba(255,255,255,.045/.075)`、蓝 `#6C8AF0`、金 `#D8A94B` 只给品牌。
- 圆角 10/14/20/24/999；胶囊头控件；字体系统默认，等宽用 monospace。
- 页面：连接/启动（进度）、首页（单输入 + 最近）、抽屉（搜索/会话/主机/设置）、
  聊天（回合、思考、工具行、审批/提问卡、模型 sheet）、设置（账号/Key/提供商/引擎）。
- dsh-go 借鉴：浮动顶栏、Composer 40 键几何、思考实时窗、工具合并、整轮折叠、
  ChatCard、设置 IA、右侧当前值、统一动效。完整调研见 [archive/19-ui-research.md](archive/19-ui-research.md)。

## 9. 构建与验证

### 9.1 环境

- Node 22.13+；JDK 21（Android Studio JBR）；Android SDK（platform 35/36，build-tools 36/37）。
- 依赖统一用 **npm**（根 + `app/`），不要混 pnpm，否则 autolinking 会读旧路径。

### 9.2 常用命令

```bash
npm install
npm --prefix app install
npm run verify                    # tsc + 全部测试（数量以输出为准）
npm --prefix app run typecheck
node scripts/build-bridge.mjs     # 生成 dist + APK asset
cd app/android && sh gradlew :app:assembleDebug
```

### 9.3 打包要点

- `rootfs.bin` / `payload.bin` 走 release（`scripts/setup-android.sh` 校验 sha256）；
- `jniLibs/arm64-v8a/{libproot.so,libprootloader.so}` 来自 Termux（`scripts/fetch-proot.sh`）；
- `debug.keystore` 需生成一次（gitignore）；
- 桥/补丁打进 APK assets，运行时同步进 rootfs（`ensurePatch`），改桥不用重打 payload。

### 9.4 真机

- 无线 adb（mDNS 或 `adb connect phone:port`）；`adb forward` 断了要重建。
- 自检/验收脚本：`scripts/device-m1-check.ts`、`scripts/device-real-check.ts`、
  `scripts/mock-model-server.ts`。
- 首装约 15–25s（解压+引擎），之后秒开；通知权限已接（完成/审批/提问）。

## 10. 插件兼容

| 层 | 跑法 | 状态 |
|---|---|---|
| L0 | WebView 官方前端 | 实验室可用，会话联动未做 |
| L1 | 轻引擎 + shim | 未做 |
| L2 | 无独立运行时（按 L3） | 结论已定 |
| L3 | proot | 可用 |
| L4 | 电脑端 | 未做 |

分析器：`scripts/plugin-compat.ts`（`npm run plugin:check`），输出 305 包矩阵。
完整矩阵见 [archive/24-plugin-compat-matrix.md](archive/24-plugin-compat-matrix.md)。

## 11. 目录结构

```
app/                    RN + Expo；App.tsx 入口
  src/lib/              引擎客户端、host/notify/share/platform 封装
  src/protocol/         协议契约
  src/state/store.ts    手写 store
  src/ui/               首页/聊天/抽屉/设置/输入区
  src/engine/           轻引擎：light/ fs/ shell/ docs/
  android/              Expo prebuild + host/*.kt
engine/                 mock 引擎 + 真 dsh 桥（real/）
test/                   e2e / 审批卡 / 单元
scripts/                探针、建桥、构建准备、真机脚本
runtime/                rootfs 分层与 profile
docs/                   本目录（archive/ 为旧文档）
```
