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
- WebView（M2.1）：`web.session`（仅本机 loopback 客户端 + loopback 上游下发官方前端 URL/token）

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
- **没有**会话删除、正文搜索的远程接口；桥在 proot 内按 dsh 磁盘布局直接处理
  （`engine/src/real/sessionFs.ts`：删会话目录、扫 `session.vN.jsonl.zstd`）。
- 文件接口 `fs.list/rename/delete` 不经过 dsh：桥在 proot 内直接用 Node fs 读写
  默认工作区（优先会话真实 cwd，回退 `/root/work`；见 §5.1）。
- 事件投影：`engine/src/real/project.ts` 把 `user/message`、`assistant/message`、工具调用等
  折成 `Turn/Block`；`run.finished` 映射状态。非流式 `assistant/message` 用最终全文覆盖
  同一步骤的流式块，按 seq/message id 去重，工具调用按 callId 去重，usage 累加到回合。

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
| `python.bin` | APK assets | Python/Office 层（36.8MB，解压约 114MB）：python3 + docx/openpyxl/pptx/pip |
| `RuntimeInstaller` | Kotlin | 解压、迁移、DNS、补丁、权限、进度 |
| `HostService` | Kotlin FGS | 前台服务，起 proot/Node/桥，通知进度 |
| `HostRuntime` | Kotlin | 进程管理、看门狗、日志、状态 |
| `dsh-palm-bridge.cjs` | APK assets → rootfs | 单文件桥（78KB），WS :8788 ↔ dsh :8787 |

### 4.2 启动链

```
App → startHost() → HostService.onStartCommand
  → RuntimeInstaller.ensureLayout（工作区/密钥/.dsh 外置 + 迁移 + DNS）
  → ensurePatch（fs-link-fallback + 桥）
  → ensurePython（assets/python.bin → rootfs；marker 版本一致就跳过）
  → proot -b workspace:/root/work -b bridge:/bridge -b .dsh:/root/.dsh
       → node .../dsh/lib/bin.js web --port 8787
  → node bridge.cjs（读 8787 token，开 8788）
  → 日志出现 token/配对码 → 状态 ready
App 轮询 host.status() → maybeAutoConnect() → 连 ws://127.0.0.1:8788/ws
```

Python 层单独成 assets：改它不用重打 158MB 的 payload；release 裁掉也不影响启动（`ensurePython` 打日志跳过）。
层里的路径从根开始（`usr/bin/python3`、`usr/lib/python3.12/...`），由 `TarExtractor` 解到 rootfs；
解压后补一次 `/usr/bin`、`/usr/local/bin` 的执行位。构建与验证见 `scripts/build-python-layer.sh`、
`scratch/office-smoke.py`（耗时/体积记录见 AI-TASKS 1.1）。

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
- 生图：OpenAI 兼容 images API；`responseFormat=auto|b64_json|url`，支持两种返回；url 下载 30s/20MB、
  content-type+魔数校验，b64 支持 data:/URL-safe，按 MIME 定扩展名。
- 会话：本地 JSON 存储；支持流式、审批、提问；附件已改原生收件（§6.4）。
- 文件名：`lib/filenames.ts` 统一清洗（中文/空格/`#`/`%` 等），生成工具与审批卡共用。
- 文件浏览（U8）：协议 `fs.list` / `fs.rename` / `fs.delete` 由轻宿主用工作区 `SandboxFs` 实现
  （`/` 根、name/kind/size/mtime，500 条上限；根目录不可重命名/删除）。
  完整引擎由桥的 `engine/src/real/workspaceFs.ts` 直接读写：根优先取最近会话的真实 cwd
  （如 `/root/work/deepseek-harness/default-workspace`），回退 `/root/work`；同样支持
  list/rename/delete，拒绝 `..`/根目录改名删除，软链不跟随；不依赖 dsh 远程接口。
- 只读终端（U8）：`shell.run` 用独立只读挂载（Workspace SandboxFs `readOnly` + MountableFs）
  跑 ShellRunner，写操作返回 EACCES；15s 超时、20k 输出。轻宿主和完整引擎共用同一套实现；
  桥打包时 `just-bash` 固定走 browser 入口，避免可选原生 zstd/liblzma 依赖。
- 会话运行（E2）：同一会话同时最多一个 run；运行中再 `sessions.send` 会写历史并进
  `session.queued`（返回 `queued:true`），当前 run 结束后自动开下一条；UI 仍以插话/停止为主。
- 会话管理（E3）：轻宿主实现 `sessions.delete`（运行中拒绝）和 `sessions.search`（标题/历史/思考
  正文，返回片段与命中数）；`sessions.pin` 的状态进 `SessionSummary.pinned`，抽屉据此分「置顶」组。
  完整引擎同样实现 delete/search：删除 dsh 会话目录（含 200ms 写句柄兜底），搜索按需读
  `session.vN.jsonl.zstd` 并复用 `projectRecords`，语义与轻引擎对齐；大历史首次搜索受
  15s 请求超时约束。
- 图片视觉（M2.4）：`engine/light/vision.ts` 按模型名启发式识别视觉能力；图片读成 data URL，
  单张 8MB、合计 16MB、最多 4 张；非视觉/超限降级为路径并在正文提示。历史只落 `imageFiles`（路径+MIME），
  请求前才读字节，provider 转成 OpenAI `content` array；不把 base64 写进会话 JSON。
- 限制：单次读 10MB；软链 EPERM；chmod/utimes 只内存；bash 无 python/js/网络。
  未知视觉模型可能被降级；远程图片 URL / PDF / OCR 未做。

### 5.2 模型调用

OpenAI 兼容 `/chat/completions`，SSE 流；45s 空闲超时（每分片重置）；
成功每次调用打一行 `[light] ttft=<ms> stream=<ms> model=… step=… first=content|tool tools=… usage=… run=…`，
失败打 `[light] error kind=timeout|offline|unauthorized|rate_limited|… status=… run=…`；
错误消息优先取服务端 JSON 的 `error.message`/`message`（`describeHttpError`），不把整段 JSON 塞进横幅；
错误经 `lib/errors.ts` 人话化后写回当前会话（ChatScreen 横幅）。
渠道配置存 SecureStore（baseURL/apiKey/model/image），支持 `dshpalm://light?...` 深链覆盖。
账号模式的模型目录（M2.5）：`engine/light/catalog.ts` 用 `x-dsh-auth-token` GET `{baseURL}/models`，
解析 `data[].id/name`、去重、6s 超时、失败回退；`LightHost.models.list` 返回目录并缓存 5 分钟，
模型面板因此可选 `deepseek-chat / DeepSeek-V4.1-Flash / DeepSeek-V4-Pro`；选中后写会话级
`sessions.setModel`，下一轮请求用该 model id。
性能基准：`npm run bench:light -- --n 20`（本地 SSE mock；`--url/--key/--model` 可打真端点）。
平台差异：`transport.ts`（fetch）与 `transport.native.ts`（XHR）共用 `transport.shared.ts`
的常量/类型；native 不能从 `'./transport'` 取共享项，否则 Metro 会解析回自身形成 self require cycle。

## 6. 引擎路由与加载

> 完整规则见历史定稿 [archive/28-engine-routing.md](archive/28-engine-routing.md)；
> 这里是实现摘要。**任务清单在 AI-TASKS，不在这里。**

### 6.1 默认

- 有轻引擎配置 → **默认轻引擎**；proot 触发式（不自动连接）。没配置时首页给「配置模型渠道」入口。
- 状态机在 `app/src/state/engineManager.ts`（纯 reducer，`light|starting-proot|full` + effects），
  `store.ts` 只执行 effects；切完整是两阶段：目标 WS 握手成功后才关轻引擎，失败回退不丢回合。
- `warmLocalHost()`：只 `startHost()` 不 `connect`，UI 继续用 light。
- 顶栏「轻/完整 42%」角标；手动切换仅在空闲（无回合、无审批）时可用。
- 预热档位：触发式（默认）/ 智能预热（充电+WiFi，可选）/ 常备（高级）；存 ui-cache。
- 回收：无运行回合且 idle 10min 停 proot；宿主状态看门狗发现 proot 死亡回退 light；
  `onTrimMemory`（`MainApplication` → `HostRuntime`）在无活跃回合时停 proot + 撤通知，
  `RUNNING_CRITICAL`/`COMPLETE` 必停；`HostService` 返回 `START_NOT_STICKY`，系统不会把 proot 拉回来。

### 6.2 预路由

实现在 `app/src/state/router.ts`（纯函数，`routeTurn()`），发消息前调用。规则按优先级：

| 命中 | 引擎 |
|---|---|
| 用户前缀 `完整/全/用完整引擎`、`轻/留在轻引擎` 或会话 pin | 按用户 |
| PDF 转换/render/recalc/旧 .doc/.ppt（含旧格式附件） | `blocked-unsupported`，不启动 proot |
| pptx/zip/视频/>10MB 附件 | proot |
| 后台/锁屏/“继续跑/别停” | proot |
| **动作词 + 解释器/编译器**（python/node/npm/pip/git/ffmpeg/apt/make/gcc…） | proot |
| 编辑已有 docx/xlsx、pptx 操作 | proot |
| 其余（含裸代码块、只问“python 是什么”） | light |
| 忙/待审批/`starting-proot`/远程宿主 | 不自动切，按当前引擎 |

proot 的代码/后台/Office 预路由会要求 `danger-full-access`（见 PITFALLS F8）；能力门卡片路径要二次确认。

### 6.3 能力门与 Handoff

1. light 工具执行前 `capability.ts` 检查：bash 命令按 shell 段拆分，任一段调用 proot-only 二进制就**整段拒绝**
   （不执行 `touch x && python y.py` 的前半段）；`read_file` >10MB、未知/只有完整引擎有的工具也拒绝。
2. 拒绝时先给每个未执行调用写 `[CAPABILITY_MISSING] not executed` 合成工具结果（避免 OpenAI 协议里
   dangling tool_calls），再落 `capability` block、发 `capability.missing` 事件、以 `capability_missing` 结束回合；
   **无审批、无文件副作用**。UI 的 `CapabilityCard` 给「用完整模式继续 / 留在轻引擎」。
3. Handoff v1（`app/src/lib/handoff.ts` + light `sessions.handoff`）：摘要（最后一条用户请求 + 已完成工具名 + 文件）、
   最近 8 轮（含工具结果）、已完成步骤、文件引用 `/workspace/...`、待执行调用（callId/name/args）。
   `handoffId` 由 light session + 末回合 + 被拦 callId 哈希得到，种子文本带 `[dsh-handoff:<id>]`。
4. `store.beginHandoff`：guard `canSwitch` → 保存源 `currentId/detail` → 两阶段切 proot → `models.list` 非空
   → `sessions.create` 后立即持久化 `fullSessionId` → rename → setPermission（bash 需 `danger-full-access`）
   → setModel（同渠道模型优先，否则宿主默认并记录 notice）→ 只发一次种子。任何 send 前失败回滚 light；
   send 后不确定时先 `sessions.get` 找种子标记，绝不重放已完成步骤。
5. `ConversationLink`：`currentId` 保持逻辑 id，物理 id 由 `physicalIdFor()` 映射；入站事件重写 sessionId；
   会话列表隐藏 `fullSessionId`，只显示一条逻辑会话（角标 轻/完整）；打开时合并 light 缓存 + proot 回合，
   丢掉种子 user 回合；proot 死后会话只读，不在 light 重放。链接/pin/autoRoute 存 ui-cache；
   active-full 时 idle 回收不 stop proot。

Handoff 字段：`conversationId`、`presetId`、`permission`、模型/渠道、摘要、
最近 8 轮原文（含工具结果）、文件引用、`pendingIntent`。
一条逻辑会话：`ConversationLink` 映射两个 sessionId；原会话只读保留。
模型/渠道必须一致；不一致要明示。

### 6.4 附件

**收件永远原生**：`Intake.kt` 用 64KB 流式复制 + 流式 SHA-256，落到
`<filesDir>/workspace/uploads/<hash16>-<sanitized name>`；200MB 上限，先写 `.part` 再原子改名，
同 hash+大小直接复用。JS 只拿 `FileRef {path, relPath, name, mime, bytes, hash}`，**不碰 base64**。
入口：系统分享（`ShareInbox`，SEND/SEND_MULTIPLE + text/plain、image/*、*/*）、相册（`expo-image-picker`
`base64:false` 拿 URI）、文件选择器（`ACTION_OPEN_DOCUMENT`，原生内部直接收件）。
文字分享进输入框；文件/图片按 MIME 分类：text/md/json/csv/docx/xlsx 标「轻」，pdf/pptx/doc/视频/音频/
其他标「完整」且 `saveOnly` + 提示；>20MB 只按路径引用。
路径映射：轻引擎 `/workspace/uploads/<x>`、完整引擎 `/root/work/uploads/<x>`，同一物理目录，零传输。
`protocol` 的 `sessions.send/steer` 增加 `files?: FileRef[]`；桥只拼 `[附件]` 路径清单，不再走
`fileUploads/upload`；`attachments.upload` 仅留旧客户端兼容。

### 6.5 Office

| 操作 | 引擎 |
|---|---|
| docx/xlsx 创建、读取 | light |
| docx/xlsx 编辑、复杂版式/公式 | proot + Python 三件套 |
| pptx 全部 | proot + Python 三件套 |
| 旧 .doc/.ppt、render、recalc、PDF | LibreOffice（默认不做） |

Python 三件套（2026-11-04 已落地）：`python3 3.12.3 + python-docx 1.1.0 + openpyxl 3.1.2 +
python-pptx 1.0.2 + Pillow 10.2.0 + lxml 5.2.1 + XlsxWriter 3.3.1 + pip 24.0`，
作为 APK 独立层 `assets/python.bin`（36.8MB gzip / 解压约 114MB），首次启动解压约 1s；
不依赖首次下载。`dsh-skill-office` 已在 rootfs；仍缺 linux-arm64 LibreOfficeKit（render/recalc/PDF 不做）。

**为什么不用 apt/dpkg 装**：app 私有目录里 SELinux 禁 `link()`，dpkg 做 `status-old`/备份硬链接直接失败；
改用 `dpkg-deb --fsys-tarfile <deb> | tar -x --hard-dereference` 解包（硬链接退化为复制）。
基础 rootfs 里还混着 bsdtar 的 `PaxHeaders/` 目录，`dpkg` 会把它当配置文件读而报错，
`TarExtractor` 现在直接丢弃这类条目。

### 6.6 已确认决策

C1 默认 light；C2 预热默认关；C3 会话统一 + badge；C4 配置共享；
C5 摘要+8 轮迁移；C6 原生收件 + 路径引用；C7 Office 三件套；
C8 render/recalc/旧格式/PDF 暂不做；C9 light 不补 pptx；C10 后台必须 proot；
C11 模型一致；C12 本文档；C13 PDF 附件只存；C14 PDF 生成延期；
C15 Python 走 APK 独立层（`python.bin`），不做首次下载（离线可靠、可裁剪）。
C16 账号模型目录只做 `models.list` 展示与会话级 `setModel`，不引入 providers.list/save；
C17 统一会话列表第一步只做“缓存 + 徽标 + 先切引擎再打开”，跨引擎 Handoff 继续另做。

### 6.7 统一会话列表（M2.6 第一步）

- 每个引擎最近 60 条会话存在 `store.sessionCache: { light, full }`，随 `refreshSessions`
  更新并写 UI cache（重启恢复）；当前引擎列表以 `sessions.list` 为准。
- `state/sessionList.ts` 的 `mergeSessionRows()` 合并当前列表 + 另一个引擎缓存：
  当前引擎优先、按 id 去重、`updatedAt` 倒序，行上带 `engine: 'light'|'full'`。
- 抽屉用 `store.sessionRows()`；另一个引擎的行标「轻/完整」，长按菜单只对当前引擎行开放。
- 点击 `store.openSessionRow(id, engine)`：engine 不同先 `switchEngine`（完整会起 proot），
  成功后按原 id `openSession`；失败时回落到 `switchEngine` 的错误提示。
- 只读横幅同样一键继续：`ChatScreen.resumeOnActiveSide` 按 `ConversationLink.activeSide`
  切引擎后 `openSession(link.id)`，不用再回首页手动切。
- 反向继续（完整 → 轻）：完整会话长按「在轻引擎继续（摘要交接）」→ `turnDetailToHistory`
  + `buildHandoff` 生成摘要/最近 8 轮/工具结果 → 切轻引擎 → 轻宿主 `sessions.import`
  创建带 seed 的会话（不触发模型）→ `ConversationLink(activeSide='light')`；seed 由合并层 strip。
- 仍需：跨引擎 Handoff 继续（在另一引擎续聊、原会话只读）、按引擎过滤搜索、缓存失效/归档同步。

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
- 轻引擎账号模式每次连接都重读 `files/home/.dsh/.credentials.yaml` 的 token
  （`withFreshAccountToken`），缓存里的旧 token 只在新 token 读不到时回退；浏览器 OAuth
  重登后切回轻引擎即用新 token，不用重启 App。

### 7.3 模型提供商

完整引擎：目录 43 条 + 自定义。UI：设置 → 模型提供商 → 两个 tab。保存后刷新 `models.list`，
会话模型胶囊里可见。Key 落 dsh credentials；`credentials.describe` 只回 configured，不回明文。

轻引擎（2026-11-06，M2.5）：只有一条 OpenAI 兼容渠道，复用同一张 ProvidersCard。
`providers.list` 回当前渠道；`providers.discover` 由轻宿主实现，账号模式走
`x-dsh-auth-token`、普通渠道走 `Authorization: Bearer` 拉 `/models`（解析 id/name/contextWindow，
失败给人话）；`providers.save` 在 App 侧接管：`applyProviderSave` 校验协议/地址/模型，
优先保留当前模型、账号模式保留 `authMode/authToken`、换 Base URL 必须重填 Key，
然后 `connectLight` 重连并写 SecureStore（失败不覆盖旧配置）。轻引擎下卡片隐藏目录/新增/删除，
`discover` 会把同域名的当前模型并入候选（账号目录已不列 `deepseek-chat`）。

## 8. UI 基线

原则：**暗色优先、单手、首屏不阻塞、状态写进控件而不是堆横幅、错误可行动**。

### 8.1 设计 token 与主题运行时

两套 palette 都在 `app/src/ui/theme/palette.ts`；页面不直接引用颜色常量，走
`useTheme()` / `useThemedStyles(createStyles)`（`theme/context.tsx`）。

浅色（默认基线）对齐官方 DSH light alias：

| 项 | 值 |
|---|---|
| 背景 | `#FFFFFF`；侧栏 `#F9FAFB`；浮层 `#F9FAFB` |
| 卡片/气泡/输入 | `#FFFFFF`；hover `#F1F3F5`；按下 `#EBEEF2`；用户气泡 `#EDF3FE` |
| 描边 | `rgba(0,0,0,.08)` / 强 `.12` |
| 文字 | `#0F1115` / `#4D5258` / `#6B7076` |
| 交互色 | deepseek 蓝 `#4176E6`；浅蓝底 `#E4EDFD`；品牌字标黑 `#0F1115` |
| 状态 | 成功 `#22C55E`、警告 `#F59E0B`、危险 `#EC1313` |

深色（官方 Neutral 色阶；`palette.ts` 的 `darkColors`）：

| 项 | 值 |
|---|---|
| 背景 / 面板 | `#0F1115` / `#151920`；hover `#1C2129`；按下 `#242A33` |
| 用户气泡 | `#1A2A44` |
| 描边 | `rgba(255,255,255,.10)` / 强 `.16` |
| 文字 | `#E6E8EB` / `#A8B0BA` / `#8B949E` |
| 交互色 | 蓝 `#7AAAFF`；浅蓝底 `rgba(65,118,230,.24)`；主按钮字 `#0F1115` |
| 状态 | 成功 `#4ADE80`、警告 `#FBBF24`、危险 `#FF6B6B` |
| 代码 | 块底 `#0B0D11`、行内 `#1A1F27`、正文 `#D7DBE0` |

通用 token：圆角 4 / 8 / 12 / 16 / 20 / 28 / 999；间距 4 / 8 / 12 / 16 / 20 / 28；
字体系统/monospace，正文 14/22、次级 13/20、说明 12/18；动效 100 / 200 / 300ms，
`cubic-bezier(.4,0,.2,1)`；页面/抽屉/弹层用 `motion.spring.page|sheet`（约 300ms 收敛）。
主题模式 `system` / `light` / `dark` 存 UI cache，
`ThemeProvider` 用 `useColorScheme()` 解析 system；根 View/StatusBar、启动 Overlay 和
web `colorScheme` 一起切换。深色对比度按正文 ≥ 4.5:1 选值。

### 8.2 屏幕与组件（现状）

| 屏 | 内容 |
|---|---|
| 启动层 `LaunchOverlay` | 品牌 + 进度，覆盖首屏，就绪后淡出；跟随主题 |
| 首页 `HomeScreen` | 品牌、时段问候、最近会话、Composer（权限/锦囊在输入框上方） |
| 抽屉 `SessionDrawer` | 工作区、搜索、筛选胶囊、运行中/今天/更早、行内状态、长按菜单、底部账号/设置、⊞ 全部功能 |
| 全部功能 `FeaturesScreen` | 卡片网格：对话/设置/引擎/实验室 + 文件/工作区/终端（可用）+ 插件/社区（未接入标灰） |
| 文件 `FilesScreen` | `fs.list` 列 `/workspace`、面包屑、文件名过滤、目录/文件行、`fs.rename`/`fs.delete`、分享（轻引擎） |
| 搜索 `SearchScreen` | `sessions.search` 全文搜索（标题/历史/思考），命中片段，点开进会话 |
| 工作区 `WorkspaceScreen` | 宿主工作区概览（root/会话数/运行中/锦囊数）+ 文件入口（轻引擎单工作区） |
| 终端 `TerminalScreen` | `shell.run` 只读终端：pwd/ls/cat/grep，写操作被沙箱拒绝，15s/20k |
| 聊天 `ChatScreen` | 顶栏（返回/标题/预设/模型）、回合、思考、工具行、审批/提问卡、输入区；字号档 `chatFontScale`；深色由 palette 驱动 |
| 动效 `ScreenStack` | 页面 push 从右滑入、旧页左移 24% + 压暗；返回滑出；非当前页冻结 store 订阅并用 `display:none` 隔离；详见 [ANIMATION](ANIMATION.md) |
| 动效 `BottomSheet` | 遮罩淡入 + 面板底部弹簧；ModelSheet / GeneratedFilesSheet 共用 |
| 设置 `SettingsScreen` | 6 组首页（搜索 / SettingsTile / 右侧当前值），只做导航 |
| 设置二级页 | `AccountScreen` / `CredentialsScreen` / `ProvidersScreen` / `HostScreen` / `LabScreen` / `EngineScreen` / `ThemeScreen` |
| 引擎 `EngineScreen` | 状态环、启停/重启、失败卡、保活、日志、高级启动命令 |
| 模型 `ModelSheet` | 模型列表 + 推理等级；权限/工作区不在这里 |
| 提供商 `ProvidersCard` | 目录/自定义两个 tab、发现模型、增删 |

基础组件在 `app/src/ui/parts.tsx`（`Btn` / `Pill`）与 `app/src/ui/components/*`
（`Card` / `Chip` / `IconButton` / `Skeleton` / `EmptyState` / `SectionHeader`）与 `SmoothKeyboardAvoid.tsx`；
Markdown 渲染在 `MarkdownView.tsx`：代码块（语言标签/复制/横向滚动）、表格、链接（http/https/mailto/dshpalm）、图片、流式光标（`streaming` 属性，待接线）。
代码高亮在 `syntax.ts`（js/ts、py、sh、json、html；未知语言回退纯文本）。
聊天渲染在 `app/src/ui/chat/*`（`TurnView` / `ApprovalCard` / `CapabilityCard` / `ChatCard`），`ChatScreen.tsx` 只负责顶栏、滚动和 Composer 组装。
生成文件面板在 `GeneratedFilesSheet.tsx`（`lib/generatedFiles.ts` 解析工具结果 + `fileActions.native.ts`
用 expo File 的 `canPreview/preview` 打开/分享）。

### 8.3 聊天页：现状与目标

**现状**：回合按 `role` 分气泡/全宽；思考与工具是行；审批/提问/能力门共用
`ui/chat/ChatCard.tsx`（20 圆角、16 内边距、tonal hairline；主色只给主按钮）；
输入区已按 dsh-go 几何：单行 56 / 28 圆角、左右 40 圆键，权限与锦囊在输入框上方，
模型在顶栏；完成回合有复制/分享，回到底部键在生成中做脉冲描边。
顶栏已浮动（`position:absolute` + `top:topInset`，0.86/0.97 半透明白 + 滚动后描边/投影），
正文按 `headerH` 留位；错误横幅是 dangerSoft 圆角卡片；完整过程里相邻 ≥2 个工具合并成一行。
审批/提问的 turn block 带自包含 `snapshot`（问题、选项、`resolution`）；历史里 pending approvals
已清空时 `protocol/qa.ts` 仍能生成只读问答卡，轻宿主和完整桥分别从持久化 turn / 工具结果补答案。

流式链路：

- 桥和客户端共用 `app/src/protocol/turns.ts` 的 canonical runId / blockId 与归一化规则；
  同 run 的快照和实时数据合并，跨 run 即使都 streaming 也不合并。
- 每个 assistant-stream 步骤的实时 block id 带 step（`<runId>:live:<step>:b<index>`），
  避免多个步骤都从 index 0 开始导致 id 撞车。
- store 用 chunk 数组接 `block.delta`，微任务 flush；只替换活跃 turn/block 引用，
  历史 turn/block 保持引用供 memo 跳过。
- Markdown 只重解析 stable 前缀 + tail；stable/tail 分组件渲染。
- `TurnView`、`AssistantTurn`、`ThinkingRow`、`ToolRow`、`MarkdownView`、稳定块列表均为 memo 组件。
- `ChatScreen` 使用 `FlatList` + 稳定 key + footer blankSpace；追底是显式 follow 状态机：
  用户真实拖拽离底后冻结，回到底部/点击按钮才恢复。跳到底部按钮位于列表容器内，键盘弹出时不被盖住。

**目标（未做）**：朗读（需要原生 TTS）；90 分钟 soak 与
VirtualizedList 慢更新/内存增长（PITFALLS I10）继续观察。
完整调研见 [archive/19-ui-research.md](archive/19-ui-research.md)，本次修复记录见 [STREAMING-FIX](STREAMING-FIX.md)。

### 8.4 输入与键盘

- 输入框 1–6 行自增高（上限 120），`+` 打开附件面板，发送/停止一键切换；
- 权限与锦囊在输入框上方，模型在顶栏；
- 权限显示为「仅可查看 / 工作区内修改 / 完全权限」；切到完全权限会弹风险确认，必须点「我了解风险，继续」才生效；
- 运行中占位写状态：「生成中 · 可直接插话」；不支持插话时写「等这一轮跑完」；
- 中文输入法 Enter 换行、不误发送；发送后重置高度；
- `SmoothKeyboardAvoid` 负责键盘避让，底部安全区单独留。

### 8.5 设置与抽屉

- 设置首页（2026-11-06，U4）：6 组 IA（AI / 能力 / 外观 / 通用 / 主机 / 帮助与关于）
  + 顶部搜索；行在 `ui/settings/SettingsTile.tsx`（32 圆盘图标、52 行高、2px 缝、右侧当前值、
  chevron）。首页只做导航，点 tile 进二级页：`AccountScreen` / `CredentialsScreen` /
  `ProvidersScreen` / `HostScreen` / `LabScreen` / `EngineScreen`（轻引擎渠道直进 LightEngineScreen）。
  二级页 header 的 ‹ 和安卓返回键都先回设置首页。
- 每行右侧显示当前值（已登录/未配置/运行中/受限制），异常值用警告色；
- 外观：主题进 `ThemeScreen`（跟随系统/浅色/深色，`themeMode` 存 UI cache）；对话字号
  标准/大/特大（`chatFontScale`）；「完成后收起过程」开关（`collapseProcess`）。
- 通用：通知由系统管理；后台保活进引擎页。
- 抽屉分组：置顶 / 运行中 / 今天 / 更早；筛选胶囊「全部 / 运行中 / 待确认 / 未读」；文件夹胶囊
  「全部文件夹 + 自定义文件夹」（长按「移到文件夹…」，UI cache 的 `sessionFolders`）；行尾最多一个状态标记；
  长按出「置顶/取消置顶/归档/改名/删除」；搜索框右侧「全文」进 SearchScreen；标题右侧 ⊞ 进「全部功能」；
- 底部主机条：本机 dsh + 引擎版本 + 模型与凭据 + 断开/设置。

### 8.6 无障碍与文案

- 所有可点控件有 `accessibilityRole` 和中文 `accessibilityLabel`；
- 错误只显示人话（`lib/errors.ts`），不把 `gateway/...` 抛给用户；
- 术语克制：会话、锦囊、完整模式、轻模式；不混用 session/preset/engine。

### 8.7 未做

多工作区的置顶/分组/排序、悬浮球、E2E 加密 WS、多宿主索引/密钥分仓、完整离线状态机。
完整引擎文件系统/终端/delete/search、工作区新建、浅色/深色主题、字号档、动效 token、
全部功能页、通知直达、QS 磁贴、桌面小组件均已完成；任务状态见 [AI-TASKS](AI-TASKS.md)。

### 8.8 LAN 发现与系统入口（M3.2/M3.3 第一步）

- 桥身份：`engine/src/real/identity.ts` 把 hostId/name/fingerprint 持久化到
  `DSH_PALM_DEVICES` 同目录；`capabilities.host` 带 `fingerprint`。
- mDNS：`engine/src/real/discovery.ts` 广播 `_dsh-palm._tcp`，TXT 只含 id/name/kind/path/fp/v；
  不广播会话正文或凭据。找不到组播时静默降级。
- Android：`HostModule.discoverLanHosts` 用 `NsdManager` 扫描并 resolve；HostService 持有
  Wi-Fi multicast lock；Android 16 声明 `ACCESS_LOCAL_NETWORK` 并按需请求。
- 连接页：扫描结果点一下填 `ws://host:port/ws`，配对码仍由用户输入；`remoteHost` 存在
  UI cache，断线后可「重连」。仍未做多宿主密钥分仓和 E2E。
- 系统入口：`DshTileService`（QS）、`DshWidgetProvider`（桌面小组件）、通知 ACTION_VIEW
  直达会话/审批；HostService 常驻通知也可点回 App。悬浮球未接。

> 注：1.5 的「生成文件」弹层（`GeneratedFilesSheet`，只列本会话工具生成的文件、可打开）已落地，
> 不等于这里的 U8 全功能文件面板（全工作区浏览/上传管理/重命名/搜索/分享）。

### 8.9 页面栈与动效（2026-11-07）

- `ScreenStack` 维护页面栈：push 时旧页保留挂载并左移 24%，新页从右滑入；
  pop 时当前页右滑出，目标页从 -24% 回 0。动画结束后非当前页 `display:none`，
  不卸载以保留滚动位置/输入态。
- `ScreenActiveContext` 冻结非当前页的 `useStore` 订阅；详情页流式输出时，
  底下首页/设置页不跟着重渲染。
- `openSession` 先同步推入空壳 `detail`（`detailLoading=true`），转场和
  `sessions.get` 并行；`ChatScreen` 首屏 `initialNumToRender=8`，顶栏初始高度
  `topInset+52`，避免首帧跳高。
- 抽屉：`motion.spring.sheet` + `PanResponder` 左滑跟手 + 首页 42px 视差；
  预挂载内容，关闭只移出屏幕。
- 底部弹层：`BottomSheet` 遮罩淡入 + 面板弹簧滑出；ModelSheet /
  GeneratedFilesSheet 已接入。
- 详细方案与实测见 [ANIMATION](ANIMATION.md)。

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
npm run bench:light -- --n 20     # 轻引擎 ttft/总耗时 P50/P90（本地 mock；--url 真端点）
node scripts/build-bridge.mjs     # 生成 dist + APK asset
# Python/Office 层（在手机 rootfs 里跑，产物放 APK assets；日常不用重打）
# adb shell run-as cool.cnb.dshpalm sh files/run-in-rootfs.sh <nativeLibraryDir> \
#     '/bin/sh /root/work/build-python-layer.sh'
cd app/android && sh gradlew :app:assembleDebug
```

### 9.3 打包要点

- `rootfs.bin` / `payload.bin` / `python.bin` 走 release（`scripts/setup-android.sh` 校验 sha256）；
  三个都在 `runtime-v1` release，`python.bin` sha256 `2cc882ce91212fc997c67befbef34dc7ad24d218e856e24f206b6788d13c40c5`；
- `python.bin` 也是制品（gitignore；36.8MB）；改 `scripts/build-python-layer.sh` 后重打，`RuntimeInstaller.PYTHON_LAYER_VERSION` 同步 +1；
- `jniLibs/arm64-v8a/{libproot.so,libprootloader.so}` 来自 Termux（`scripts/fetch-proot.sh`）；
- `debug.keystore` 需生成一次（gitignore）；
- **release 签名**：`scripts/gen-release-keystore.ps1` 生成 `app/android/keystore/release.jks` 与
  `app/android/keystore.properties`（都 gitignore）；`app/build.gradle` 检测到 properties 就用 release key，
  否则退回 debug key（只能本地试装）。`assembleRelease` 后可用
  `$ANDROID_HOME/build-tools/37.0.0/apksigner.bat verify --print-certs app-release.apk` 核对；
  版本号可用 `DSH_PALM_VERSION_CODE` / `DSH_PALM_VERSION_NAME` 覆盖。
  **keystore + 密码必须备份**，丢失后不能覆盖升级。
- 发布 runbook 见 [RELEASE.md](RELEASE.md)：`npm run release:preflight` 只读检查 APK/签名/设备/备份；
  release 非 debuggable，debug→release 证书不同时不能 `install -r`，这台设备切换会丢 App 数据。
- 桥/补丁打进 APK assets，运行时同步进 rootfs（`ensurePatch`），改桥不用重打 payload。

### 9.4 真机

- 无线 adb（mDNS 或 `adb connect phone:port`）；`adb forward` 断了要重建。
- 自检/验收脚本：`scripts/device-m1-check.ts`、`scripts/device-real-check.ts`、
  `scripts/device-regression.ts`（`npm run device:regression`，E5 关键路径）、
  `scripts/mock-model-server.ts`。
- 首装约 15–25s（解压+引擎），之后秒开；通知权限已接（完成/审批/提问）。

## 10. 插件兼容

| 层 | 跑法 | 状态 |
|---|---|---|
| L0 | WebView 官方前端 | 实验室可用；双向会话联动（M2.1，真机待回归） |
| L1 | 轻引擎 + shim | 未做 |
| L2 | 无独立运行时（按 L3） | 结论已定 |
| L3 | proot | 可用 |
| L4 | 电脑端 | 未做 |

分析器：`scripts/plugin-compat.ts`（`npm run plugin:check`），输出 305 包矩阵。
完整矩阵见 [archive/24-plugin-compat-matrix.md](archive/24-plugin-compat-matrix.md)。

### 10.1 App 内插件兼容页（M2.3）

- `reports/plugin-compat.json` 是静态扫描快照；`npm run plugin:data` 用
  `scripts/plugin-data.mjs` 生成 `app/src/data/pluginCompat.ts`（只保留展示需要的字段），
  App 打包后离线可看，不依赖运行时 `node_modules`。
- `app/src/lib/pluginCatalog.ts` 是纯函数：按「含依赖」等级计数/过滤、搜索包名/理由/
  Node 内建/DSH 依赖、按 L0→L3 排序；`app/src/ui/PluginsScreen.tsx` 只负责渲染和交互。
- 入口：全部功能 →「插件」；`AppState.view = 'plugins'`，安卓返回回首页。
- 更新矩阵后跑 `npm run plugin:check && npm run plugin:data`；`test/plugin-catalog.test.ts`
  会校验 App 数据与 `reports/plugin-compat.json` 同步。

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
