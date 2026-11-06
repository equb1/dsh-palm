# 锦囊 · AI 维护清单

> 状态：2026-11-06 夜间（release 0.2.0 / 完整引擎平权 / LAN 发现 / 系统入口）。
> **本文件是任务状态、规则和命令的唯一来源**。
> 需求看 [REQUIREMENTS](REQUIREMENTS.md)，实现看 [TECHNICAL](TECHNICAL.md)，坑看 [PITFALLS](PITFALLS.md)，
> 长会话流式见 [STREAMING-FIX](STREAMING-FIX.md)。交接：2026-11-05 见
> [archive/32](archive/32-handoff-2026-11-05.md) / [archive/33](archive/33-handoff-2026-11-05.md)，
> 2026-11-06 见 [archive/34](archive/34-handoff-2026-11-06.md) / [archive/35](archive/35-handoff-2026-11-06.md) /
> [archive/36](archive/36-handoff-2026-11-06.md) / [archive/37](archive/37-handoff-2026-11-06.md) /
> [archive/38](archive/38-handoff-2026-11-06.md)。
> **每次做完任务，必须回来勾选/更新这里**；不要另开任务文档。

## 1. 当前基线

- 真机：华为 PLR110 / Android 16 / arm64；无线 adb。
- 本机宿主：proot + Node + dsh + 单文件桥；首装解压 15–25s；桥/引擎看门狗可用。
- 轻引擎：会话/流式/审批/提问/10 个工具/docx+xlsx/生图；真机全链路通过。
- 账号：官方 OAuth 真机可用；提供商目录（43）+ 自定义渠道可用。
- 已完成的重活：工作区/设备密钥/`.dsh` 外置；通知、冷启动分享、`dshpalm://` 深链；
  会话改名/置顶/归档；日志导出；错误人话化；图片压缩；桥走 APK 补丁。
- UI token 已对齐官方 DSH 默认浅色（2026-11-04）：`#FFFFFF` 基底、`#F9FAFB` 侧栏、
  deepseek 蓝 `#4176E6`、8/12/16/20/28 圆角。深色 alias 已接（2026-11-06）：
  `theme/palette.ts` + `ThemeProvider`，支持跟随系统/浅色/深色，存 UI cache。
- 输入区按 dsh-go 几何（2026-11-04）：单行 56 / 28 圆角、40 圆键；权限与锦囊在输入框上方，
  模型回顶栏，`+` 走附件面板；B3 前先把 Chat 的回合/思考/工具渲染拆到 `ui/chat/*`。
- 流式主链路已修（2026-11-04）：canonical run/block id、chunk 缓冲、稳定块 memo、FlatList 和 follow
  状态机已落地；真机工具密集长流、上滑冻结、回到底部、重进通过。20 分钟和 90 分钟 soak 均已完成
  （2026-11-06：109 轮，PSS 349→615MB，无 OOM，见 PITFALLS I10）；
  见 `PITFALLS.md` H7 和 [STREAMING-FIX](STREAMING-FIX.md)。
- 完整引擎（proot）自带 Python/Office 层（2026-11-04）：`assets/python.bin` 首次启动解压到 rootfs，
  `python3` + docx/openpyxl/pptx；三格式创建/读回/编辑在真机通过（见 P0 1.1）。
- 默认引擎已改轻（2026-11-04）：冷启动只连轻引擎、不预热 proot；切完整走角标两阶段，
  `onTrimMemory` 优先停 proot，`HostService` 改 `START_NOT_STICKY`（见 P0 1.2）。
- 附件收件已原生化（2026-11-04）：`Intake.kt` 流式复制 + SHA-256 → `workspace/uploads/`，
  分享/相册/文件选择器三入口，JS 只拿 `FileRef` 路径；`sessions.send/steer` 带 `files`（见 P0 1.3）。
- 预路由/能力门/Handoff v1 已落地（2026-11-04）：`router.ts` 两因子路由、`capability.ts` 整段拒绝、
  `handoff.ts` + `ConversationLink` 一条逻辑会话（见 P0 1.4）。
- M1 收尾（2026-11-04）：生图 b64/url 自动降级与 url 校验、45s 空闲超时 + `[light] ttft`/`[light] error`、
  文件名统一清洗、生成文件面板（打开；分享延后）；`npm run verify` 206 pass（见 P0 1.5）。
- 已知缺口：完整引擎默认 `workspace-write` 跑不了 bash（无 bwrap/Landlock，见 PITFALLS F8），
  跑 Python/Office 命令需把会话切「完全权限」。
- 轻引擎无渠道的引导已补（2026-11-05）：冷启动自动打开配置页，并提供「先用完整模式」
  （记住选择，下次直接起 proot）；连接失败不再停在「连接中」。
- 轻引擎支持账号模式（2026-11-05）：读 `files/home/.dsh/.credentials.yaml` 的账号 token，
  用 `x-dsh-auth-token` 调模型，**账号已登录时不需要手动填 API Key**；切回轻引擎也不再报失败。
- 轻引擎工具历史已清洗（2026-11-05）：中断/停止后 assistant `tool_calls` 悬空会导致下一次
  请求 400，现于发请求前统一补齐 `[已停止] 未执行` 并丢弃孤立 tool 消息（`light/history.ts`）。
- 账号重登闭环（2026-11-06 验收）：轻引擎 401 横幅的「重新登录」入口已可用；release 上浏览器
  OAuth 授权完成（页面「授权已完成」），回 App 已登录、模型可选（见 M2.7）。
- 桥补非流式 assistant/message（2026-11-06）：最终全文覆盖同步骤流式块、工具按 callId 去重、
  usage 累加、turn/end 幂等收尾；单测见 `test/real-assistant-message.test.ts`。
- 完整引擎平权（2026-11-06 夜间）：`sessions.delete` 直接删 dsh 会话目录（运行中拒绝）、
  `sessions.search` 扫本地 vN 日志（标题/用户/正文/思考，片段与轻引擎一致）、`shell.run`
  用只读 SandboxFs + just-bash（写操作 EACCES）；工作区映射修成真实 workspaceId，
  新建工作区可落在 `/root/work` 下。
- OAuth 取消（2026-11-06 夜间）：桥起 loopback 回调中继，用户拒绝授权时立刻
  `account/cancelSignIn`，App 显示「已取消授权」，不再等 600s。
- LAN（M3.2 第一步）：桥持久化 hostId/name/fingerprint 并广播 `_dsh-palm._tcp`；
  Android NSD 扫描宿主，连接页可扫描/填入地址/重连上次宿主；群组播锁由 HostService 持有。
- 系统入口（M3.3 第一步）：QS 磁贴、桌面小组件、通知 ACTION_VIEW 直达会话/审批、
  常驻通知可点回 App；悬浮球和 E2E 加密仍未做。
- 验证：`npm run verify` 全绿（**数量以命令输出为准**）；APK 可构建；`stream:replay` 10 万 delta 通过。
- 已知限制：PDF 暂缓；render/recalc/旧格式无 Linux LibreOffice；轻引擎附件只给路径，不解析图片/PDF；
  轻引擎无文档编辑、无 pptx（复杂/编辑/pptx 走完整引擎）。

## 2. 任务清单

> 规则：P0 未完成前不铺新功能；一项任务一个分支；完成后勾选并写验证方式。

### P0 · 当前优先

- [x] **1.1 Office 三件套（proot + Python）**
  - [x] proot 里装 `python3` + `python-docx` + `openpyxl` + `python-pptx`
  - [x] 跑通 docx / xlsx / pptx 的创建、读取、编辑
  - [x] 决定打包方式（进 payload / 首次下载）并记录体积
  - 验收：三格式各一份创建+读回+编辑；真机耗时与体积有记录
  - 结果（2026-11-04）：APK 独立层 `assets/python.bin`（36.8MB，解压 1s，安装后约 114MB）；
    Python 3.12.3 / python-docx 1.1.0 / openpyxl 3.1.2 / python-pptx 1.0.2 / Pillow 10.2.0 / lxml 5.2.1；
    真机耗时（创建/读回/编辑 ms）：docx 33/12/13，xlsx 7/3/4，pptx 16/5/6。
    不用 dpkg（app 私有目录禁 `link()`），用 `dpkg-deb --fsys-tarfile | tar --hard-dereference` 解包；
    构建脚本 `scripts/build-python-layer.sh`，验证 `scratch/office-smoke.py`。

- [x] **1.2 EngineManager + 轻引擎默认**
  - [x] 状态机：`light` 默认、`proot` 触发式
  - [x] `warmLocalHost()`：只 `startHost()` 不 `connect`
  - [x] 顶栏「轻/完整」角标 + 空闲时手动切换
  - [x] 预热档位（触发式默认 / 智能预热可选 / 常备高级）
  - [x] idle 10min 回收、`onTrimMemory` 优先停 proot
  - 验收：冷启动到可输入 <1s；proot 不自动连接；切换有进度；失败回退不丢回合
  - 结果（2026-11-04）：`app/src/state/engineManager.ts` 纯 reducer + `store` 执行 effects；
    冷启动 `am start -W` 296–385ms，`ps` 无 proot/HostService；角标点按切完整 14s 内 ready 并显示「完整」；
    `am send-trim-memory … RUNNING_LOW` 停 proot、撤通知、回「轻」；force-stop 后重开不再拉起 HostService。
    2026-11-05 补：无渠道冷启动自动打开配置页；「先用完整模式」会持久化跳过（`dsh-palm.light.setup.skipped`），
    下次冷启动直接起 proot；连接失败清理链路，不再停在「连接中」。
    2026-11-05 账号模式：轻引擎读取 dsh 账号 token（`x-dsh-auth-token`），账号已登录时无需 API Key；
    真机验证 `[light] ttft=1296ms model=deepseek-chat`，完整↔轻双向切换通过。

- [x] **1.3 附件收件管线（原生）**
  - [x] 分享/相册/文件选择器 → `workspace/uploads/<hash>-<name>`
  - [x] 生成路径引用（不走 base64），两种引擎都能读
  - [x] 附件 chip 标注「轻/完整」
  - [x] PDF/未支持格式只保存 + 提示
  - [x] 大文件只走路径
  - 验收：分享图片/文档进 `uploads/`；不出现 base64 大包
  - 结果（2026-11-04）：`Intake.kt` 流式复制 + SHA-256 + 200MB 上限 + `.part` 原子改名；
    `ShareInbox` 接冷启动/onNewIntent；Manifest 补 SEND/SEND_MULTIPLE（text/image/*）。
    真机：文件选择器选图落到 `uploads/910fd81f6ca0de0e-dsh-trim.png`，chip 显示文件名；
    文字分享冷启动直接进输入框（`最终分享验证 2026`）；`HostModule` 里 base64 路径已删。
    分享 `content://` 时若对方没给读权限，错误条给人话（不再未捕获 rejection）。
    2026-11-05 真机：文件选择器多选「测试 报告#1%.pdf / big-video.mp4 / plain note.txt」→
    `uploads/02536eb9753aae8a-测试 报告_1_.pdf`（中文+空格保留，`#`/`%`→`_`）、
    `394c345f0b0c63ee-big-video.mp4`（25MB）、`7fa36b95d5c98859-plain note.txt`；chip 标「完整」，
    提示「PDF 暂不解析，只保存文件路径」「25 MB，超过 20MB，只按路径引用」；完整引擎模型列出三件并读回 txt。
    系统分享入口：文档查看器「以 PDF 格式分享」→ 选锦囊 → chip 复用同一文件（uploads 无重复），
    提示同上。轻引擎侧也已真机：attach `plain note.txt` → 消息里带
    `[附件] /workspace/uploads/7fa36b95d5c98859-plain note.txt (text/plain, 16 B, 未解析)` →
    模型 `read_file` 后回答「文件第一行 hello attachment」，2 秒完成（tools=1）。

- [x] **1.4 预路由 + 能力门 + Handoff v1**
  - [x] 发送前按 R2/R3 预路由（代码/后台/转格式 → proot）
  - [x] 轻引擎工具执行前检查能力 → `capability_missing`（无副作用）
  - [x] Handoff：摘要 + 最近 8 轮 + 工具结果 + 文件引用 + 待执行步骤
  - [x] 一条逻辑会话（`ConversationLink`）；只重发未执行步骤；失败回退
  - 验收：手动/能力门切换都能续跑；重复副作用 0；用户看不到两个会话
  - 结果（2026-11-04）：`router.ts` 两因子预路由（动作词 + 解释器，裸代码块/提问不误判）；
    `capability.ts` 整段拒绝 bash（不执行前缀）、`read_file` >10MB、未知工具；
    `agent.ts` 先落 `[CAPABILITY_MISSING]` 合成结果再停，不产生审批/文件副作用；
    `handoff.ts` 摘要+8 轮+已完成步骤+文件引用+待执行调用，`[dsh-handoff:<id>]` 幂等种子；
    `store.beginHandoff` 两阶段 + `models.list` 预检 + create 后立即落 fullSessionId + 失败回滚；
    `ConversationLink` 隐藏完整会话、事件 sessionId 重写、列表合并；桥补 `job.done`。
    验证：`npm run verify` 166 pass / 0 fail（新增 router/capability/handoff/orchestration 36 条）；
    真机冷启动 322ms、无 proot，抽屉「自动选择引擎」开关可见。未配轻引擎渠道，端到端模型触发的
    CapabilityCard → Handoff 未真机跑（逻辑由单测覆盖）。
    2026-11-05 真机端到端：关自动选择引擎 → 「Run python3 to print 42」→ 轻引擎 bash 能力门 →
    CapabilityCard「这个操作需要完整引擎」（python3 -c "print(42)"）→ 勾选知晓 → 确认并交接 →
    完整引擎（V4.1-Flash）执行输出 42；列表仍只有一条逻辑会话，python 只执行一次，无重复副作用。

- [x] **1.5 M1 收尾剩余**
  - [x] 真生图渠道（`b64_json`/`url` 两种返回）
  - [x] 真模型 ttft + 断网/401/429 异常路径
  - [x] 中文/空格/`#`/`%` 文件名边界
  - [x] 生成文件面板（打开/分享）
  - 结果（2026-11-04）：生图支持 `responseFormat=auto|b64_json|url`（auto 不传字段，400/422 自动降级）；
    b64 支持 data:/URL-safe + 20MB，url 30s/20MB + content-type/魔数校验、跨域不转发 Key、按 MIME 定扩展名；
    模型调用 45s 空闲超时、错误分类（断网/401/429/超时/空响应），`[light] ttft=…` 与 `[light] error kind=…` 日志，
    `run.finished` 错误写回 ChatScreen 横幅；`filenames.ts` 统一清洗文件名并接入生成工具与审批卡；
    生成文件面板（顶栏入口 + 底部弹层 + 系统查看器打开）已落地；**原生分享**（HostModule.shareFile +
     expo File.contentUri + ACTION_SEND/ClipData）已接，真机分享面板待端到端。
    验证：`npm run verify` 209 pass / 0 fail；`npm run bench:light -- --n 3` 输出 P50/P90 JSON；
    mock `MOCK_IMAGE_MODE=url` 手动 smoke 返回 image/png。真机 401 错误横幅已验证；
    受账号 token 过期影响，生图/生成文件/分享/能力门→Handoff 的模型链路仍未端到端跑。
    2026-11-05 真机端到端：明确指令（Do not ask questions, call create_docx directly）→ 模型直接
    create_docx → 批准 → `/workspace/docs/weekly.docx`（9541B）→ 「生成文件」面板「打开」进系统文档
    查看器（Weekly Report / Progress / All milestones are on track.）→「分享」拉起系统分享面板
    （MIME `…wordprocessingml.document`，9KB）。
  - 2026-11-06 异常路径真机：轻引擎临时指向本机 401 mock（`127.0.0.1:8800`）→ 发消息，
    横幅显示「登录或 API Key 无效/已过期（401）：Authentication Fails (governor)」+「重新登录」；
    `describeHttpError` 现在只取 JSON 的 `error.message`/`message`，不再把整段 JSON 塞进横幅
    （`test/light-errors.test.ts` 3 条）。随后 LightEngineScreen「用账号连接」恢复，
    日志回到 `auth=account(64)`，真模型 `hi` 正常（`159-401-humanized.png`）。
  - 2026-11-06 追加 429/断网真机：用 `dshpalm://light` 深链把渠道切到本机 429 mock →
    横幅「请求太频繁或额度不足（429）：rate limit exceeded」；停 mock、移除 adb reverse 再发 →
    「连不上模型服务（网络错误）…」；每次都用 LightEngineScreen 断开 +「用账号连接」恢复，
    真模型 `hi` 正常（`160-429.png`、`161-offline.png`）。超时仍只有单测（45s 空闲）。
  - 2026-11-06 追加超时真机：本机 SSE mock 先回一个 chunk 再挂 60s → 45s 后横幅
    「模型服务 45 秒没有新响应…」、日志 `kind=timeout`；恢复账号模式后真模型 `hi` 正常
    （`171-timeout.png`）。20MB/魔数仍只有单测。

### UI 工作流（与 P0 并行）

> U1/U3/U4/U5/U6/U7（全量）/U8 依赖或强冲突于 P0 的 1.2–1.4，**先不要动**；
> 先做下面「可并行 UI 项」。U2 可先做组件抽取（B3）。

- [x] **U1 聊天页重排**：浮动顶栏、Composer 28 圆角/40 键、错误横幅、回到底部键
  - 完成：Composer 28 圆角/40 键、回到底部键、模型顶栏；2026-11-05 浮动顶栏与错误横幅也真机验证。
  - 2026-11-05：顶栏改浮动（`position:absolute` + `top:topInset`，滚动后 0.97 白底 + 底部描边 +
    轻投影，未滚动 0.86 半透明）；正文用 `headerH` marginTop 留位，键盘/长会话滚动下不遮挡。
    真机验证：顶部/滚动后两张截图，标题、模型、引擎角标、生成文件入口均可见可点。
  - 2026-11-05：错误横幅改成圆角 dangerSoft 卡片（图标 + 3 行文本 + 重新登录 + ×关闭）。
    真机验证：轻引擎打开完整侧只读会话后发消息，卡片显示「已切换引擎，这个会话只读…」，
    不挡 Composer，× 能关；截图 `scratch/shots/97-error-banner.png`。
- [x] **U2 消息层**：思考 3 行实时窗、工具行合并、整轮折叠、ChatCard 统一
  - 2026-11-05：思考实时窗改 3 行（只跟最后 240 字）；完整过程展开后相邻 ≥2 个工具合并成
    「N 个工具 · a · b」一行，可再展开逐条详情（`TurnView.tsx` 的 `groupProcessBlocks`）。
    真机 weekly.docx 会话验证：折叠行显示「2 个工具 create_docx · read_docx」，展开后两条工具行都在。
  - 2026-11-06：审批/提问/能力门统一到 `ui/chat/ChatCard.tsx`（20 圆角、16 内边距、tonal hairline；
    主色只给主按钮）。`ApprovalCard`/`CapabilityCard` 只保留各自内容，外框不再各写一套；
    低风险审批/提问用中性描边，中风险 warn、高风险 danger；代码/命令块统一 `ChatCardCodeBox`。
    真机三类卡片通过：提问卡（`120-chatcard-question.png`）、审批卡（`121-chatcard-approval.png`、
    `122-chatcard-approval-bash.png`）、能力门卡（`123-chatcard-capability.png`）；
    流式时工具行仍逐条外露（跑/等审批必须可见），整轮结束后按上面的规则合并。
    `typecheck` + `npm run verify` 全绿。
  - 2026-11-06 只读问答卡：已回答的问题 / 已处理的审批在聊天里保留为只读卡（问题、
    用户选择或自定义回答、已回答/已跳过/已拒绝），不再显示可点选项和输入框；等待中的
    仍走原交互卡。轻宿主把审批快照和结果落进 turn，完整桥从 ask_user_question 的
    tool/call + tool/result 还原答案；`app/src/protocol/qa.ts` 纯函数 + `test/readonly-qa.test.ts`、
    `test/unit.test.ts` 投影用例覆盖。`typecheck`、`npm run verify`、`export:web` 全绿。
    局限：完整引擎的普通权限审批上游没有可回放的历史事件，重开会话只保留提问卡；
    当前时间线内已处理审批仍按只读卡展示。
- [x] **U3 流式性能**：按帧合并 + 活跃 block 局部更新 + stable/tail Markdown + 空 block 修复；
  20 分钟 soak 已过（0 duplicate、1 次 VirtualizedList 警告），40/42.5 分钟复核内存 430–546MB，
  **90 分钟 soak 已完成**（2026-11-06 00:11–01:42，109 轮，PSS 349→615MB，无 OOM，见 I10）
- [x] **U4 设置 IA**：6 组、SettingsTile、右侧当前值、搜索
  - 2026-11-06 第一步：设置首页改成 6 组（AI / 能力 / 外观 / 通用 / 主机 / 帮助与关于），
    新增 `app/src/ui/settings/SettingsTile.tsx`（32 圆盘图标、52 行高、组内 2px 缝、右侧当前值、
    chevron）；顶部搜索按标题/当前值/副标题过滤。
  - 2026-11-06 第二步：详细卡全部拆成二级页——`AccountScreen`（账号/手机号/登录）、
    `CredentialsScreen`（API Key）、`ProvidersScreen`（复用 ProvidersCard）、`HostScreen`（宿主信息/
    断开）、`LabScreen`（三个实验入口）、`EngineScreen`（U5）。SettingsScreen 只剩 header、搜索、
    6 组 tile、notice、错误行；tile 的 ‹ 与安卓返回键都先回设置首页。
  - 外观（主题/字号）与通用（通知）目前只有只读当前值，点按提示“未接后端”；外观的深色/字号档
    属于 U7。
  - 真机：首页 6 组、搜索 `deepseek` 过滤、账号/API Key/提供商/宿主/实验室/引擎各页都打开过，
    安卓返回键从账号页回设置首页（`127`–`138` 截图）；typecheck + verify 全绿。
- [x] **U5 引擎页**：状态环、启动/停止/重启、失败卡（重试/安全模式/日志）
  - 2026-11-06：新增 `app/src/ui/EngineScreen.tsx`，设置首页「本机引擎 / 完整引擎 / 后台保活」
    三个 tile 都进这一页。状态环（已停止/启动中/运行中/出错 + 进度）+ 引擎/桥/当前/保活元信息；
    预热完整引擎 → 运行中后主按钮变「切到完整引擎」；停止 proot、重新启动、安全模式重启；
    失败卡（重试/安全模式/看日志）；日志刷新/导出；预热档位；高级启动命令。
    真机：预热约 20s 后 `engine=ready bridge=ready :8788`、状态环变绿，停止后回 stopped
    （`131-engine-screen.png`、`132-engine-running.png`、`133-engine-stopped.png`）。
    失败卡未真机触发（需要坏命令/坏 rootfs），代码路径已接。
- [x] **U6 全部功能页 + 抽屉**：卡片网格、筛选胶囊、文件夹/长按菜单、整页搜索
  - 2026-11-06 第一步：抽屉加筛选胶囊「全部 / 运行中 / 待确认 / 未读」，按 `SessionSummary.status`
    和 `unread` 过滤，空结果有单独空状态；长按菜单（置顶/归档/改名/反向交接）原有。
  - 真机：全部/待确认/未读切换、空状态（`139-drawer-filters.png`、`140-drawer-filter-empty.png`）。
  - 2026-11-06 第二步：新增 `ui/FeaturesScreen.tsx`「全部功能」卡片网格（2 列）：
    新对话 / 会话 / 设置 / 本机引擎 / 轻引擎渠道 / 实验室 + 文件 / 终端 / 工作区 /
    插件 / 社区 / 帮助与关于；未接后端的卡片标「未接入」，点按只提示。抽屉标题右侧加 ⊞ 入口，
    `view` 增加 `features`，安卓返回回首页。
    真机：网格、未接入提示、设置跳转（`141-features-grid.png`、`142-features-disabled-notice.png`）。
  - 2026-11-06 第三步：正文搜索——协议 `sessions.search`（轻宿主扫标题/历史消息/思考正文，
    返回片段/命中数，20 条上限）；抽屉搜索框加「全文」，新 `ui/SearchScreen.tsx`（250ms 防抖、
    命中卡片、点开直接进会话）。真机搜 `python` 命中 3 条会话、点结果打开原会话
    （`153-search-results.png`、`154-search-open-session.png`）；单测覆盖命中/空词拒绝。
  - 未做：自动/多层文件夹分组（自定义文件夹已完成）；正文搜索只覆盖轻引擎本地会话，
    完整引擎显式 unsupported。
  - 2026-11-06 第四步：置顶分组——`SessionSummary` 带 `pinned`（轻宿主 summary 透出），
    抽屉把置顶会话放在最上面的「置顶」组（运行中的仍优先归「运行中」）。真机长按「Use the bash」
    → 置顶 → 顶部出现置顶组；再取消置顶组消失（`155-drawer-pinned.png`）；单测覆盖 pin 状态。
  - 2026-11-06 第五步：用户自定义文件夹——`AppState.sessionFolders`（逻辑会话 id → 文件夹名，
    UI cache 持久化）；长按「移到文件夹…」在抽屉顶部输入新名字或点已有文件夹，留空移出；
    会话行显示文件夹标签；筛选胶囊「全部文件夹 + 各文件夹」；删会话时清映射。
    真机：移到 `work` 后行标签和胶囊出现，点 work 只剩 1 条会话（`162-folder-tag.png`、
    `163-folder-filter.png`）。
  - 文件夹是 UI 层标签，不改宿主/工作区；协议没有 folder 字段。
  - 2026-11-06 验收：筛选/全部功能/正文搜索/置顶/自定义文件夹全部通过
    （`ACCEPTANCE-2026-11-06`）；完整引擎正文搜索与多工作区仍属后续项。
- [x] **U7 视觉**：浅色主题、字号档、动效 token（按压/弹层/列表）
  - 2026-11-06 前置：外观组加了「完成后收起过程」开关（`collapseProcess`，默认开，
    持久化在 UI cache）；关掉后完成的回合默认展开思考/工具过程，收起/展开仍可手动点。
    真机：关 → 打开已完成会话，摘要箭头朝上、过程展开；改回开（`146`、`147` 截图）。
  - 深色主题已落地（2026-11-06）：`theme/palette.ts` + `theme/context.tsx`；所有页面改成
    `createStyles(theme)` + `useThemedStyles`，Markdown 走 `MarkdownStylesContext`；设置 →
    外观 → 主题可选跟随系统/浅色/深色（`themeMode` 存 UI cache）。
  - 2026-11-06 动效 token：新增 `ui/components/ScreenFade.tsx`，页面切换按 `motion.duration.base`
    + `motion.easing.standard` 淡入（App 的 screen 统一包一层）；设置行按压用
    `motion.duration.fast` 缩到 0.98 回弹（`SettingsTile`）。真机 10 步回归全绿，页面切换无布局跳动。
  - 2026-11-06 字号档：`AppState.chatFontScale`（1 / 1.15 / 1.3，UI cache 持久化）；设置「外观 →
    对话字号」点按循环 标准/大/特大；`MarkdownView` 按倍率重建模块样式（fontSize/lineHeight），
    `TurnView` 用户气泡同步缩放；真机同一会话标准 vs 特大对比（`166-font-standard.png`、
    `167-font-large.png`、`168-settings-font.png`）。
  - 2026-11-06 验收：字号档 + 页面/设置行动效 ✅；深色主题已实现，Web 浅色/深色截图覆盖
    设置、主题页、聊天、审批卡、文件页与系统跟随（见 [DARK-THEME](DARK-THEME.md)）。
    真机用并行测试包（`cool.cnb.dshpalm.test`，不动 release 数据）深色 `device:regression`
    10/10 通过（2026-11-06，含引擎启停/文件/全文搜索）；测试包仍在设备上，release 未动。
- [x] **U8 内容屏**：文件面板、终端、工作区（依赖后端接口）
  - 2026-11-06 第一步：轻宿主加 `fs.list`（列 `/workspace` 目录，返回 name/kind/size/mtime，
    子项 500 条上限、单子项 stat 失败不拖垮整页）；新增 `ui/FilesScreen.tsx` 文件浏览器
    （面包屑、目录/文件行、刷新、空目录/错误提示），文件用系统查看器打开（复用
    `openWorkspaceFile`）。全部功能页的「文件」卡已可点，`view` 增加 `files`。
  - 真机：根目录列出 `deepseek-harness / docs / uploads`，进 `docs` 看到 weekly.docx 9.3KB，
    点开进系统文档查看器显示 Weekly Report（`143-files-root.png`、`144-files-docs.png`、
    `145-files-open-docx.png`）；单测覆盖 fs.list 目录/大小/不存在目录。
  - 2026-11-06 第二步：协议加 `fs.rename` / `fs.delete`（轻宿主，根目录拒绝），文件页每行加
    ⋯ 操作菜单：重命名（行内输入）、分享（`shareWorkspaceFile`）、删除（二次确认，目录递归）。
    真机：weekly.docx → weekly.docx-renamed → 改回；新建 tmp-del.txt 后删除，宿主文件同步消失
    （`150-files-actions.png`、`151-files-rename.png`、`152-files-renamed.png`）；
    单测覆盖 rename/delete/根目录拒绝。
  - 2026-11-06 第三步：文件搜索——FilesScreen 头部加 ⌕，按文件名过滤当前目录，
    无匹配显示「没有匹配的文件」，清空恢复。真机 docs 目录输 `zz` 空结果、清空输 `week`
    只剩 weekly.docx（`156-files-search-empty.png`、`157-files-search-match.png`）。
  - 2026-11-06 第四步：工作区页——全部功能「工作区」卡可点，新增 `ui/WorkspaceScreen.tsx`：
    列出宿主报告的工作区（名称/root/会话数/运行中/锦囊数），入口「浏览文件」；
    轻引擎单工作区有说明。真机：本机工作区、`/workspace`、19 个会话 · 2 个锦囊，
    点「浏览文件」进文件页（`158-workspace.png`）。
  - 2026-11-06 第五步：只读终端——协议 `shell.run`；轻宿主用独立挂载（`/workspace` 只读
    SandboxFs + MountableFs）跑 ShellRunner，与会话 bash 隔离；新增 `ui/TerminalScreen.tsx`：
    命令输入、快捷命令、stdout/stderr/exit/耗时、15s 超时/20k 截断、清空；全部功能「终端」可点。
    真机：`pwd` → `/workspace`、`ls` → deepseek-harness/docs/uploads；`touch /workspace/t.txt`
    → `EACCES: read-only file system`（`164-terminal.png`、`165-terminal-readonly.png`）；
    单测覆盖 pwd/echo/ls/写拒绝/空命令。
  - 2026-11-06 第六步：完整引擎文件系统——桥新增 `engine/src/real/workspaceFs.ts`，在 proot 内
    直接读写 `/root/work`，实现 `fs.list/rename/delete`；拒绝 `..`/根目录改名删除，软链不跟随。
    FilesScreen 复用同一套 UI，错误文案不再说「完整引擎暂不支持」。
    单测 `test/bridge-workspace.test.ts` 4 条（列表/改名/删除/穿越/软链）；`npm run verify` 244 pass。
    真机已验证：完整引擎文件页列出 docs/uploads，删除 `docs/u8-test.txt` 后 UI 与宿主目录同步消失；
    rename 由单测覆盖。
  - 2026-11-06 夜间完整引擎平权：`sessions.delete` / `sessions.search` / `shell.run` 已实现；
    工作区映射改为真实 `workspaceId`，`sessions.create` 支持传入 workspaceId，
    `workspaces.create` 可在 `/root/work` 下创建目录；WorkspaceScreen 增加「新建工作区」入口。
  - 未做：多工作区的置顶/分组/排序（M2 余项）；完整引擎正文搜索仍是本地日志扫描，
    没有上游 FTS 的实时索引。
- [x] **U9 长会话流式布局**：FlatList + blankSpace + follow 状态机；真机主要路径通过，
  20 分钟 soak 已完成（33 回合），**90 分钟 soak 已完成**（2026-11-06，109 轮，PSS 615MB，
  无 OOM/崩溃，PITFALLS I10）
  - 2026-11-06 夜间抽屉展开优化：空闲预挂载 + 关闭不卸载 + 去掉面板硬件纹理 +
    useMemo；同机 8 次开合 Janky 6.42%→3.51%，单独展开 0 掉帧（PITFALLS I22）。

#### 可并行 UI 项（2026-11-03，给 agent）

> 历史规划。U1/U4/U5/U6/U7/U8/U9 已完成；当前状态以上方任务清单和
> `ACCEPTANCE-2026-11-06` 为准，下表的「现在不要做」不再适用。

**背景**：1.2/1.3/1.4 会改 `App.tsx`、`store.ts`、`SettingsScreen.tsx`、
`ConnectScreen.tsx`、`Composer.tsx`、`ChatScreen.tsx` 的逻辑。
以下任务不碰这些文件（或只留槽），可与 P0 并行。

**禁区（本轮不要改这些文件）**：

```
app/App.tsx
app/src/state/store.ts
app/src/ui/SettingsScreen.tsx
app/src/ui/ConnectScreen.tsx
app/src/ui/Composer.tsx
app/src/ui/ChatScreen.tsx   # 只有 B3 允许改 import 几行
```

如果任务必须改到禁区文件，**停止并拆分支/后置**，不要硬改。

**A. 完全独立（推荐先做）**

| ID | 分支 | 任务 | 只改 | 验收 | 估时 |
|---|---|---|---|---|---|
| [x] A1 | `ui/markdown-polish` | Markdown 增强：代码块复制、表格样式、链接打开、图片、流式光标 | `ui/MarkdownView.tsx`（+ 新增 `ui/syntax.ts`、`test/syntax.test.ts`） | 代码/表格/链接正常；typecheck + verify 通过 | 已完成 |
| [x] A2 | `ui/design-tokens` | 字号层级、动效时长/曲线、语义色；**只增不改** | `ui/theme.ts` | 现有导出不变；typecheck | 已完成 |
| [x] A3 | `ui/components-kit` | `Card`/`Chip`/`IconButton`/`Skeleton`/`EmptyState`/`SectionHeader` | `ui/parts.tsx` + 新文件 `ui/components/*` | 新组件有 props 类型；旧组件不变 | 已完成 |
| [x] A4 | `ui/engine-badge` | `EngineBadge` 组件，先不接线 | 新文件 `ui/EngineBadge.tsx` | props 类型完整；未接线不影响现有 UI | 已完成 |
| [x] A5 | `ui/attachment-chips` | `AttachmentChips` 组件，先不接线 | 新文件 `ui/AttachmentChips.tsx` | props 类型完整；未接线 | 已完成 |
| [x] A6 | `ui/model-sheet` | ModelSheet 视觉：分组、默认标记、搜索、禁用态 | `ui/ModelSheet.tsx` | 现有选择行为不变；截图 | 已完成 |
| [x] A7 | `ui/skeletons` | 聊天/首页/抽屉的 Skeleton 与 EmptyState | 新文件 `ui/Skeletons.tsx` | 未接线；typecheck | 已完成 |

> A1 备注：代码块轻量语法高亮（`ui/syntax.ts` + `test/syntax.test.ts`）随 A1 一并落地，未单列任务；
> 流式光标已在 `MarkdownView` 提供 `streaming` / `isStreaming` 属性，但 `ChatScreen` 属禁区未接线，界面暂不显示；按约定等 1.2–1.4 合入后再做（见 C 表）。

**B. 低风险（可做，但留槽位）**

| ID | 分支 | 任务 | 文件 | 留槽要求 |
|---|---|---|---|---|
| [x] B1 | `ui/session-drawer-polish` | 行高/搜索聚焦/空状态/主机条吸底 | `ui/SessionDrawer.tsx` | 主机条右侧留空槽，不写死内容；不读新 store 字段 |
| [x] B2 | `ui/home-polish` | 问候、最近卡片、预设胶囊、空状态 | `ui/HomeScreen.tsx` | 顶栏右侧留槽位；不改连接/引擎逻辑 |
| [x] B3 | `ui/chat-components` | 把回合/思考/工具渲染拆到 `ui/chat/*`，ChatScreen 只组装 | 新文件 + `ChatScreen.tsx` **只改 import** | 不改 store/protocol；1.4 之后再加新 block 类型 |

**C. 现在不要做**

| 任务 | 原因 |
|---|---|
| U1 聊天页重排 | 改 ChatScreen + Composer，和 1.2/1.3/1.4 都撞 |
| U3 流式 32ms 合并 | 已改为逐 token + 微任务 chunk；旧方案不再适用 |
| U4 设置 IA | 改 SettingsScreen，1.2 引擎卡/账号/提供商都在里面 |
| U5 引擎页 | 需要 EngineManager 的状态字段 |
| U6 全部功能页 | 要动 App/Settings 导航；等 1.2 入口定型 |
| U7 浅色主题全量 | 只做 A2 的 token；全量换肤等 UI 批次 |
| U8 文件/终端/工作区 | 依赖后端接口 |
| 流式光标接线（A1 遗留） | 要改 `ChatScreen`（禁区），等 1.2–1.4 合入后再做 |

**D. 顺序**

1. A1 → A2 → A3（基础三件套）；
2. A4 / A5（给 1.2/1.3 预留组件）；
3. A6 / A7；
4. B1 / B2 / B3（留槽，允许和引擎任务并行）；
5. 等 1.2/1.3/1.4 合入后，再做 U1/U4/U5/U6/U7/U8；U9 已完成主体，补 20 分钟 soak。

每个分支都从最新 `develop` 切，一个分支一个任务，走 MR；不要直推 `develop`。

**E. 组件契约（引擎任务只传数据，UI 不改）**

```ts
// ui/EngineBadge.tsx
type EngineBadgeProps = {
  kind: 'light' | 'remote' | null;
  label?: string;
  onPress?: () => void;
};

// ui/AttachmentChips.tsx
type AttachmentChip = {
  id: string;
  name: string;
  kind: 'image' | 'file';
  engine?: 'light' | 'full';
};
type AttachmentChipsProps = {
  items: AttachmentChip[];
  onRemove?: (id: string) => void;
  onPress?: (id: string) => void;
};
```

**F. Definition of Done**

- `npm --prefix app run typecheck` 与 `npm run verify` 全绿；
- `git diff --name-only` 不包含禁区文件（B3 只允许 ChatScreen import 行）；
- 真机或网页截图附在 PR（至少改动的屏）；
- 勾选本文件对应项；新踩的坑追加到 `PITFALLS.md`；
- 一个分支一个任务，MR 合入后删分支。

### M2 · 进行中

- [x] **2.1 WebView 与 RN 会话态联动**（token 暴露、双向跳转、生命周期）
  - 2026-11-06：完整引擎新增 `web.session`，只在「桥客户端是 loopback + 上游 dsh 是 loopback」时
    下发官方前端 URL/token；远程/非 loopback 明确返回 `unsupported`，不下发 token，也不打日志。
    实验室不再从宿主日志捞 token，改用协议取地址；失败提示保留。
  - RN → WebView：`getWebFrontendTarget` 先确保完整引擎在线，再按 `ConversationLink` 定位物理会话；
    轻引擎会话只打开首页并显示降级说明。「打开完整界面」= 首页，「当前会话（WebView）」= 当前会话。
  - WebView → RN：启动前注入 localStorage（`dsh.sessions.current`）定位会话，并观察用户点会话的变化；
    支持 `dshpalm://session?id=…&engine=…` 与 loopback `?sessionId=` / `/session/<id>`；
    未知深链停在 WebView 并显示 unsupported 说明。
  - 生命周期：切后台/卸载停止 WebView 内轮询并停加载，回前台恢复；token 失效（401）、连接拒绝、
    引擎重启都显示可读错误，并提供「重新获取地址」（重新调 `web.session`）。
  - 单测 `test/webview-link.test.ts` 14 条（URL/token、注入脚本、深链、错误、生命周期）；
    `npm --prefix app run typecheck`、`npm run verify`（254 pass）与 `expo export --platform web` 通过。
    真机未跑（按要求只做代码/单测/Web 构建）；官方前端没有 URL 路由，WebView→RN 依赖其
    localStorage 会话选择观察器。
- [x] **2.2 会话迁移完整版**（事件回放/结构化交接；P0 的 1.4 只做 v1）
  - 2026-11-06 Handoff v2（向后兼容 v1）：交接包新增 `replay`（turn/text/thinking/tool，
    含 callId/arguments/state/detail），不再只有摘要/最近 8 条；
  - 轻宿主 `sessions.import` 按序重建 turns + history（工具调用/结果一一对应），
    以 `handoffId`（或 seed marker）幂等：重复导入返回同一会话，不重复回合/副作用；
  - 完整 → 轻的反向交接以重建后的轻侧为唯一正文（`handoffDirection`），不再把完整侧追加一遍；
  - 完整引擎没有公开的事件导入 API，seed 明确标注「文本降级」，`sessions.import` 返回
    `unsupported`，不假装原生事件回放；
  - 单测 `test/handoff.test.ts` / `handoff-import.test.ts` / `handoff-reverse.test.ts` /
    `handoff-orchestration.test.ts` 覆盖结构化生成/解析、幂等、工具结果顺序、失败回滚、v1 兼容；
    `npm --prefix app run typecheck` + `npm run verify` 全绿（254 pass）。
- [x] **2.3 插件徽章**（矩阵已有，App 入口 + 搜索 + 判定理由）
  - 2026-11-06：新增 `npm run plugin:data`，把 `reports/plugin-compat.json` 转成
    `app/src/data/pluginCompat.ts`（305 包快照，离线可看）；`lib/pluginCatalog.ts` 提供
    搜索、等级过滤、按「含依赖」等级排序和计数；`ui/PluginsScreen.tsx` 显示 L0–L4/无代码徽章、
    判定理由、Node 内建、DSH 依赖和原厂标记，Features「插件」卡启用（`view=plugins`）。
  - 单测 `test/plugin-catalog.test.ts` 5 条：App 数据与报告同步、计数、搜索包名/理由/内建、
    L3 过滤与排序、空结果；`npm run verify` 245 pass / 0 fail。
  - Web 验收：深色/浅色插件页、搜索 `dsh-client-ui-chat`、L3 过滤、展开判定理由；
    当前矩阵 305 包（L0 64 / L1 131 / L2 66 / L3 43 / 无代码 1，按含依赖）。
- [x] **2.4 轻引擎附件引用**（图片视觉/路径消费；与 1.3 原生收件不重复）
  - 2026-11-06：新增 `engine/light/vision.ts`：按模型名识别视觉能力（gpt-4o/Claude/Gemini/Qwen-VL…），
    图片读成 data URL；单张 8MB、合计 16MB、最多 4 张，超限或非视觉模型降级为路径并在正文明确提示。
    `ChatMessage` 只把 `imageFiles`（路径+MIME）落盘，请求前才读成 `images` data URL；
    provider 把带图消息转成 OpenAI `content` array（text + image_url），内部字段不外发。
  - 单测：`test/vision.test.ts` 5 条 + `test/provider.test.ts` content parts + `test/light-engine.test.ts`
    视觉/非视觉/超限 3 条；`npm run verify` 249 pass / 0 fail。
  - 限制：视觉模型靠模型名启发式识别，未知视觉模型暂时会降级；后续可加显式开关。
    data URL 只支持本地图片，远程 URL 输入未做；PDF/OCR 仍按原计划暂缓。
- [x] **2.5 轻引擎多提供商 + 账号模型目录**
  - [x] 轻引擎实现 `providers.list/save/discover`，设置页复用 ProvidersCard；
    2026-11-06：`providers.list` 回当前单渠道（`configured` 认 API Key 或账号 token）；
    `providers.discover` 由轻宿主实现（只收 OpenAI 兼容；同域名复用账号 token、填了 Key 用
    `Authorization: Bearer`，返回 id/name/contextWindow）；`providers.save` 在 App 侧接管
    （`engine/light/config.ts` 的 `applyProviderSave` 纯函数：只收 custom、优先保留当前模型、
    账号模式不洗掉 token、换 Base URL 必须重填 Key）→ `connectLight` 重连并写 SecureStore。
    ProvidersCard 在轻引擎下隐藏目录/新增/删除，只留单渠道编辑；`discover` 会把同域名的当前模型
    并入候选，避免「获取模型 → 保存」静默换模型。
    单测 `test/light-provider-config.test.ts` 5 条 + `test/light-catalog.test.ts` 3 条 + 轻宿主
    providers 测试；`typecheck` + `npm run verify` 全绿。
    真机：设置页显示 1 个渠道（`124-providers-light.png`）；编辑 → 获取模型出 3 个候选
    （deepseek-chat / V4.1-Flash / V4-Pro，后两个 1024K，`125-providers-discover.png`）；
    保存后日志 `[light] … model=deepseek-chat`、`auth=account(64)`，发 `hi` 正常 done
    （`126-provider-saved-chat.png`）。
  - [x] 账号模式拉 `/models`（2026-11-05）：`engine/light/catalog.ts` 用账号 token GET
    `{baseURL}/models`，`models.list` 返回目录并缓存 5 分钟；普通 API Key 渠道仍只报当前模型。
    真机：模型面板显示 `deepseek-chat`、`DeepSeek-V4.1-Flash`、`DeepSeek-V4-Pro`；
    选 V4.1-Flash 后发 `hi`，日志 `[light] … model=deepseek-flash` 三步均命中，run done。
    单测 `test/light-catalog.test.ts`（URL/解析/去重/失败回退）；`npm run verify` 213 pass。
- [x] **2.6 统一会话列表 + 跨引擎继续**
  - 抽屉合并轻/完整两套会话，行上标「轻/完整」；
  - 点另一引擎的会话先切引擎再打开（完整会话需要先起 proot）；
  - 复用 Handoff（摘要 + 最近 8 轮 + 工具结果）做“在另一引擎继续”，原会话只读。
  - 2026-11-05 第一步：`state/sessionList.ts` 合并当前列表 + 另一个引擎缓存（当前优先、按 id 去重、
    时间倒序）；`store.sessionCache` 随 `refreshSessions` 更新并进 UI cache，重启不丢；
    抽屉用 `sessionRows()`，另一个引擎的行标「轻/完整」，点击 `openSessionRow` 先 `switchEngine`
    再按原 id 打开；长按菜单只对当前引擎行开放。
    单测 `test/session-list.test.ts` 3 条；typecheck + `npm run verify` 216 pass。
    真机（2026-11-05）：完整引擎抽屉里能看到轻会话并标「轻」，点「Read the attached…」自动切回轻引擎
    并打开原会话；轻引擎抽屉里能看到完整会话并标「完整」，点「检查 python 文档库版本」切到完整引擎
    （proot）并打开。截图 `scratch/shots/85-drawer-full.png`、`86-light-opened.png`、`90-full-opened2.png`。
  - 2026-11-05 追加：只读横幅一键回到会话主动侧——`ChatScreen.resumeOnActiveSide` 里读
    `ConversationLink.activeSide`，`switchEngine` 后按逻辑 id `openSession`。真机：轻引擎打开
    「Run python3」只读会话 → 点「切到完整模式继续」→ 完整引擎起 proot 并恢复到同一会话
    （截图 `scratch/shots/110-resumed-full2.png`）。
  - 2026-11-06 Handoff 继续版完成（完整 → 轻）：完整引擎长按完整会话 →「在轻引擎继续（摘要交接）」→
    `continueFullInLight` 用 `turnDetailToHistory` + `buildHandoff` 生成摘要/最近 8 轮/工具结果 →
    切轻引擎 → 轻宿主 `sessions.import` 建带 seed 的会话（不跑模型）→ link(activeSide='light') →
    打开逻辑会话。真机：轻引擎里发「summarize this session」正确总结出三个附件（in:3772，
    `model=deepseek-chat`），seed 气泡被 strip；原完整会话在完整引擎里变只读。
    单测 `turnDetailToHistory`/`buildReverseSeedText`；`npm run verify` 218 pass。
    截图 `scratch/shots/114-reverse-handoff.png`、`115-reverse-continued.png`。
- [x] **2.7 账号 token 生命周期**
  - 轻引擎 401 时明确提示“账号登录已过期，切完整模式重新登录”；
  - 提供重登入口；不要静默失败。
  - 现状（2026-11-05）：401 横幅已能显示（真机验证 `Authentication Fails (governor)`），
    并加了「重新登录」按钮（切完整引擎 + 打开设置；账号卡已登录时也有「重新登录」= 退出后重走 OAuth）。
    真机已验证：点 401 横幅「重新登录」→ 完整引擎 ready → 设置「模型与凭据」页，
    账号卡「已登录」且有 重新登录/退出登录/查看用量，底部「当前引擎 完整引擎（本机）」。
    2026-11-05 时浏览器 OAuth 授权未真机走完；现已于 2026-11-06 在 release 完成（见下）。
    2026-11-05 新证据：**同一账号 token 在完整引擎可用**（bash python 三库返回版本），
    根因是旧保存配置缺 `authMode/authToken`，轻引擎以 `auth=none` 请求（PITFALLS I7）。
    已在 `resolveLightSetup` 自动补账号 token 并加 `[light] auth=…` 日志；真机日志已变
    `auth=account(64) base=https://api.deepseek.com/v1`。**已真机复验通过（2026-11-05 20:49）**：
    发 “hi” 得到 `[light] ttft=982ms stream=1312ms model=deepseek-chat step=1 first=content tools=0
    usage=in:2152,out:42 run=…` 且 `done`，不再 401。
    恢复入口/重登按钮保留。
    2026-11-06：新增 `withFreshAccountToken`（`engine/light/config.ts`），`resolveLightSetup`
    在账号模式每次重连都重读 `loadAccountToken()`，缓存里的旧 token 只在新 token 读不到时回退；
    浏览器 OAuth 重登后切回轻引擎不会再用旧 64 字符 token。单测 4 条；
    **2026-11-06 release 真机验收**：浏览器 OAuth 授权完成（页面显示「授权已完成」），
    回 App 已登录、模型可选（`ACCEPTANCE-2026-11-06` M2.7 行），重登闭环通过。
    token 无 refresh，过期后仍走 401 横幅「重新登录」恢复。


### M3 · 进行中

- [ ] **3.1 官方 OAuth 真机验证**（loopback + 拒绝授权）
  - [x] 正常授权 loopback：release 真机通过（2026-11-06，页面「授权已完成」、回 App 已登录）
  - [x] 用户拒绝授权：桥用 loopback 回调中继 + `account/cancelSignIn`，代码路径完成；
    真机需要再点一次「拒绝授权」验收（App 应立即显示「已取消授权」）
  - [ ] 关闭浏览器/不回调仍会走 600s 超时（可后续加前台启发式取消）
- [ ] **3.2 LAN 直连**（mDNS、E2E WS、索引同步、离线状态机）
  - [x] 第一步：桥持久化 hostId/name/fingerprint，广播 `_dsh-palm._tcp`；
    Android NSD 扫描、连接页列表、手填地址兜底、上次宿主重连
  - [x] 第一步：HostService 持有 Wi-Fi 组播锁；宿主页「局域网扫描」可在不断开当前连接时扫描；
    NEARBY_WIFI_DEVICES 运行时权限已接（Android 16 弹窗可见）
  - [ ] 真机跨设备发现未验证：本机 Windows 防火墙拒绝入站 5353/8788，手机 ping 电脑 100% 丢包；
    PC 本机 mDNS 查询能拿到 PTR/SRV/TXT/A
  - [ ] E2E WS（X25519 + 加密帧）未做；当前仍是明文 `ws://`
  - [ ] 多宿主索引/密钥分仓未做（目前只有一个 active remote host + 全局设备密钥）
  - [ ] 完整离线状态机（在线/重连/离线/配对失效 + 最后同步时间）只做了「上次宿主重连」
- [ ] **3.3 系统入口**（小组件、悬浮球、QS、通知直达、后台分享）
  - [x] QS 磁贴、桌面小组件、通知 ACTION_VIEW 直达会话/审批、常驻通知可点回 App
  - [ ] 悬浮球（overlay service）未做，设置里明确标注「暂未接入」
  - [x] 后台分享：`ShareInbox` 已有，冷启动/onNewIntent 都接

### M4 · 远期

- [ ] relay / WebRTC DataChannel
- [ ] iOS 遥控器 + Share Extension / Live Activity
- [ ] L1 插件自动转译（`phone-bundle`）

### 已知缺口（未成任务）

- follow WS 没有 `onclose/onerror` 自动重连（靠进会话重建）；
- 图片渲染未做系统真机验收；
- TTS/朗读未接（需要原生 TTS）；
- 轻引擎账号 token 读自明文 YAML，安全模型需在文档里说清；
- LAN 仍是明文 WS，E2E 加密未做；设备密钥仍只有一个全局槽，多宿主会互相覆盖；
- 悬浮球未接（SYSTEM_ALERT_WINDOW 已声明，但没有 overlay service）；
- 完整引擎搜索按需扫日志，长会话首次搜索可能受 15s 请求超时限制；
- 发布签名/正式包流程（见 E8）。

## 3. 工程债

- [ ] **E1** JS bundle 4.2MB，Metro 不拆包 → 按需资源包
- [x] **E2** 一会话一 run，无队列 → 并发上限 + 排队
  - 2026-11-06：轻宿主 `sessions.send` 在会话运行中不再报 busy，而是把消息写入历史并进
    `session.queued`，当前 run 结束（含手动停止）后自动 `startRun` 下一条，返回 `{queued:true}`。
    单测：第一条 `waitForAbort`，第二条排队，stop 后收到两次 `run.finished` 且第二轮有回复。
    局限：App 界面仍用「停止 / 插话」，没有主动「排队发送」按钮；协议层已支持。
- [x] **E3** 宿主缺会话删除/正文搜索 → 等上游或自建索引
  - 2026-11-06 夜间：完整引擎也实现 `sessions.delete` / `sessions.search`（删 dsh 会话目录 + 扫描 vN 日志；
    运行中拒绝），完整引擎侧不再是 unsupported；`test/real-bridge-parity.test.ts` 用假 dsh 覆盖
    delete/search/shell/workspace 四条链路。
  - 2026-11-06：轻引擎实现 `sessions.delete`（运行中的会话拒绝删除），抽屉长按菜单加「删除」
    + 二次确认；store 删除后关闭当前会话、清理 ConversationLink、刷新列表。mock 宿主同样支持，
    完整引擎显式 unsupported。真机删掉「Do not ask questions」测试会话，
    其他会话不受影响（`148-drawer-longpress-menu.png`、`149-drawer-after-delete.png`）；
    单测覆盖删除与运行中拒绝。
  - 仍缺：上游 FTS 的实时索引（当前完整引擎搜索按需扫日志）；删除后其他在线客户端的
    实时 `session.deleted` 事件（协议尚未加）。
- [ ] **E4** 沙箱只有 JS 层路径约束 → 文档别承诺安全边界
- [ ] **E5** 真机回归靠手跑 → 发版前跑 `scripts/device-*.ts`
  - 2026-11-06 第一步：新增 `scripts/device-regression.ts` + `npm run device:regression`：
    adb 冷启动 → 会话抽屉（筛选/全部功能入口）→ 全部功能网格 → 文件浏览根目录 → 返回首页 →
    设置首页 6 组 → 文件操作菜单（docs/weekly.docx 的重命名/分享/删除）→ 设置二级页
    （账号、引擎页）→ 引擎启停（预热到运行中，再停止 proot）→ 全文搜索（输入 python 等结果）；
    用 uiautomator 文本断言，失败自动截图。真机一次通过 10 步；键盘弹起时先 `hideKeyboard()`
    再按返回，否则第一次返回只收键盘。
  - 仍只有一条主路径；登录/审批/流式长会话/引擎启停/文件操作等还没进脚本。
  - 2026-11-06 夜间 release 0.2.0 已装，`device:regression` **8/10**：冷启动、抽屉、
    全部功能、文件根、文件操作菜单（用 `uploads/weekly.docx` fixture）、返回、设置 6 组、
    设置二级页、引擎启停均过；全文搜索在“当前轻会话列表为空 + 搜索输入焦点异常”时
    没有结果，未完成最后一步。脚本已兼容 `docs/` 和 `uploads/` fixture。
  - 2026-11-06 手工补审批路径：真机新会话发「Use the bash tool to run: echo approval-ok…」→
    审批卡（`拒绝/批准`，显示 `执行命令`/`echo approval-ok`）→ 批准 → 工具输出 `approval-ok`
    （`169-approval-card.png`、`170-approval-approved.png`）。流式与工具行同时可见；
    这条路径暂没进自动脚本（真实模型行为不稳定）。
- [ ] **E6** 文档过时 → 每次改动同步四篇文档
- [x] **E7** 无性能基准 → `scripts/bench-light.ts` 取 P50/P90
- [x] **E8 签名/发布流程**：固定 keystore、release 签名、正式包/版本号；当前设备包与本机 keystore 不一致，只能靠 Metro 验证
  - 2026-11-05：`python.bin` 已上传 `runtime-v1` release（sha256 `2cc882ce…`），`setup-android.sh` 会校验；
    `scripts/gen-release-keystore.ps1` 生成专属 release keystore + `app/android/keystore.properties`（都 gitignore），
    `assembleRelease` 走 release 签名（V2，`CN=DSH Palm`，SHA-256 `50de0609…`），版本号可用
    `DSH_PALM_VERSION_CODE/NAME` 覆盖。产物 `app-release.apk` 243.5MB，含 rootfs/payload/python.bin/index.android.bundle。
  - 仍需：keystore + 密码备份（丢了不能覆盖升级）；设备上仍是 debug 包，release 包覆盖装需先统一签名/卸载；
    正式发版前在干净设备走一次首装 + 升级。
  - 2026-11-06：新增 `scripts/release-preflight.ps1` + `npm run release:preflight`（只读检查 APK/版本/签名/
    设备/keystore 备份）；`docs/RELEASE.md` 写清首装/升级/回滚。预检 PASS：APK 243.5MB、`0.1.0 (1)`、
    证书 `50de0609…`、设备 debug `0.1.0 (1)`、两处 keystore 备份都在。
  - 关键修正（推翻旧想法）：release 默认 `debuggable=false`，装完 `run-as` 不可用；且 debug 与 release
    证书不同。所以这台设备 debug → release **必然丢 App 数据**，「卸前 tar 备份 files/shared_prefs、
    装 release 再还原」走不通。首装/升级仍等用户确认后执行（路径 A 干净首装 / 路径 B 同签名升级）。
  - 2026-11-06 夜间：versionCode bump 到 `2` / versionName `0.2.0`，重新 `assembleRelease`
    （包含完整引擎平权、深色主题、M2.1–M2.4、LAN 发现、系统入口）；APK 244.2MiB、
    sha256 `ADA52EA0…`，设备已同签名 `install -r` 升级成功（数据保留）。


## 4. 待决事项

| 项 | 选项 | 建议 |
|---|---|---|
| ASR/OCR 时机 | ASR 先进 P1 / OCR 后置 | 先 ASR，音频路由才闭环 |
| iOS 范围（D2） | 只遥控器 / 也要轻引擎 | 先遥控器 |
| 插件市场（D3） | 只启用/配置 / 下载执行 | 前者（2.5.2） |
| 多端同步（D4） | 索引+引用 / 也同步正文 | 仅索引+引用 |
| PDF（C14） | 继续暂缓 / 重启 | 继续暂缓 |

> 2026-11-06 夜间确认：PDF、OCR、LibreOffice render/recalc、旧 Office 格式、TTS
> 本轮不做，只在文档和 UI 里标注；不要为了“看起来完整”接假入口。

## 5. 分支、提交与验证规则

- 从最新 `develop` 切；一个方面的任务一个分支：
  `feat/office-python`、`feat/engine-manager`、`feat/attachment-intake`、
  `feat/capability-handoff`、`feat/webview-link`、`chore/...`、`docs/...`。
- **禁止** `git merge --ff-only` 后删分支、禁止直推 `develop`；
  推分支 → 在 cnb 建 MR → 合并 → 删分支。MR 不可用时保留分支，不直推。
- 提交信息：`<type>(<scope>): 一句话`，正文写「做了什么 / 为什么 / 怎么验」。
- 合并前必须：`npm --prefix app run typecheck` + `npm run verify` 全绿。
- 不把不相关改动塞进一个分支；发现别的坑另开分支。

> 历史例外：`128f3f8` 曾 ff 直推 develop（违规），已在 docs 中记录；不要重复。

## 6. 运行与验证命令

```bash
# 依赖（统一 npm，不要混 pnpm）
npm install
npm --prefix app install

# 验证（数量以输出为准）
npm --prefix app run typecheck
npm run verify

# 桥（改 engine/src/real 后必须）
node scripts/build-bridge.mjs

# Android
cd app/android && sh gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk

# 真机自检 / 真模型
node --import tsx scripts/device-m1-check.ts <apk>
node --import tsx scripts/device-real-check.ts <apk>
node --import tsx scripts/mock-model-server.ts 8799
MOCK_PLAN=docs node --import tsx scripts/mock-model-server.ts 8799
```

日志：`adb shell run-as cool.cnb.dshpalm tail -f files/logs/engine.log`；
JS：`adb logcat -s ReactNativeJS`；端口：桥 8788 / dsh 8787。

## 7. 文档维护规则

1. **四篇分工**：REQUIREMENTS（要什么）/ TECHNICAL（怎么做）/ PITFALLS（踩过什么）/ AI-TASKS（做什么）。
2. 任务状态**只改本文件**；TECHNICAL 只写机制，不列任务；REQUIREMENTS 不写实现细节。
3. 新坑 → 追加 PITFALLS，格式「现象 → 原因 → 处理 → 验证」。
4. 决定 → REQUIREMENTS §12 或本文件 §4；定了就删“待决”。
5. **不要写死测试条数**，统一写“以 `npm run verify` 输出为准”。
6. 旧文档只进 `docs/archive/`，不再引用；新文档互相链接只用四篇之间的相对路径。
