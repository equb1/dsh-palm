# 锦囊 · AI 维护清单

> 状态：2026-11-05。**本文件是任务状态、规则和命令的唯一来源**。
> 需求看 [REQUIREMENTS](REQUIREMENTS.md)，实现看 [TECHNICAL](TECHNICAL.md)，坑看 [PITFALLS](PITFALLS.md)，
> 长会话流式见 [STREAMING-FIX](STREAMING-FIX.md)。交接：2026-11-04 见
> [archive/29-handoff-2026-11-04](archive/29-handoff-2026-11-04.md)，2026-11-05 见
> [archive/31-handoff-2026-11-05](archive/31-handoff-2026-11-05.md)。
> **每次做完任务，必须回来勾选/更新这里**；不要另开任务文档。

## 1. 当前基线

- 真机：华为 PLR110 / Android 16 / arm64；无线 adb。
- 本机宿主：proot + Node + dsh + 单文件桥；首装解压 15–25s；桥/引擎看门狗可用。
- 轻引擎：会话/流式/审批/提问/10 个工具/docx+xlsx/生图；真机全链路通过。
- 账号：官方 OAuth 真机可用；提供商目录（43）+ 自定义渠道可用。
- 已完成的重活：工作区/设备密钥/`.dsh` 外置；通知、冷启动分享、`dshpalm://` 深链；
  会话改名/置顶/归档；日志导出；错误人话化；图片压缩；桥走 APK 补丁。
- UI token 已对齐官方 DSH 默认浅色（2026-11-04）：`#FFFFFF` 基底、`#F9FAFB` 侧栏、
  deepseek 蓝 `#4176E6`、8/12/16/20/28 圆角；深色 alias 后续按系统开关接。
- 输入区按 dsh-go 几何（2026-11-04）：单行 56 / 28 圆角、40 圆键；权限与锦囊在输入框上方，
  模型回顶栏，`+` 走附件面板；B3 前先把 Chat 的回合/思考/工具渲染拆到 `ui/chat/*`。
- 流式主链路已修（2026-11-04）：canonical run/block id、chunk 缓冲、稳定块 memo、FlatList 和 follow
  状态机已落地；真机工具密集长流、上滑冻结、回到底部、重进通过。20 分钟 soak 待补，见
  `PITFALLS.md` H7 和 [STREAMING-FIX](STREAMING-FIX.md)。
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
- 真机发现（2026-11-05）：轻引擎账号模式的 token 过期后模型调用返回 401，错误横幅已能显示
  「登录或 API Key 无效/已过期（401）」，但还没有重登入口（M2.7）。
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
    提示同上。

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

### UI 工作流（与 P0 并行）

> U1/U3/U4/U5/U6/U7（全量）/U8 依赖或强冲突于 P0 的 1.2–1.4，**先不要动**；
> 先做下面「可并行 UI 项」。U2 可先做组件抽取（B3）。

- [ ] **U1 聊天页重排**：浮动顶栏、Composer 28 圆角/40 键、错误横幅、回到底部键
  - 部分完成：Composer、回到底部、模型顶栏；浮动玻璃顶栏/错误横幅未做。
- [ ] **U2 消息层**：思考 3 行实时窗、工具行合并、整轮折叠、ChatCard 统一
  - 部分完成：思考按 block、工具行、完成摘要/整轮折叠；ChatCard 统一卡片未做。
  - 2026-11-05：思考实时窗改 3 行（只跟最后 240 字）；完整过程展开后相邻 ≥2 个工具合并成
    「N 个工具 · a · b」一行，可再展开逐条详情（`TurnView.tsx` 的 `groupProcessBlocks`）。
    真机 weekly.docx 会话验证：折叠行显示「2 个工具 create_docx · read_docx」，展开后两条工具行都在。
- [x] **U3 流式性能**：按帧合并 + 活跃 block 局部更新 + stable/tail Markdown + 空 block 修复；
  90 分钟 soak 待补
- [ ] **U4 设置 IA**：6 组、SettingsTile、右侧当前值、搜索
- [ ] **U5 引擎页**：状态环、启动/停止/重启、失败卡（重试/安全模式/日志）
- [ ] **U6 全部功能页 + 抽屉**：卡片网格、筛选胶囊、文件夹/长按菜单、整页搜索
- [ ] **U7 视觉**：浅色主题、字号档、动效 token（按压/弹层/列表）
- [ ] **U8 内容屏**：文件面板、终端、工作区（依赖后端接口）
- [x] **U9 长会话流式布局**：FlatList + blankSpace + follow 状态机；真机主要路径通过，
  20 分钟 soak 仍待补（见 `PITFALLS.md` H7）

#### 可并行 UI 项（2026-11-03，给 agent）

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

- [ ] **2.1 WebView 与 RN 会话态联动**（token 暴露、双向跳转、生命周期）
- [ ] **2.2 会话迁移完整版**（事件回放/结构化交接；P0 的 1.4 只做 v1）
- [ ] **2.3 插件徽章**（矩阵已有，App 入口 + 搜索 + 判定理由）
- [ ] **2.4 轻引擎附件引用**（图片视觉/路径消费；与 1.3 原生收件不重复）
- [ ] **2.5 轻引擎多提供商 + 账号模型目录**
  - 轻引擎实现 `providers.list/save/discover`，设置页复用 ProvidersCard；
  - 账号模式拉 `/models`，让 V4.1-Flash / V4-Pro 可选（现在只有 `deepseek-chat`）。
- [ ] **2.6 统一会话列表 + 跨引擎继续**
  - 抽屉合并轻/完整两套会话，行上标「轻/完整」；
  - 点另一引擎的会话先切引擎再打开（完整会话需要先起 proot）；
  - 复用 Handoff（摘要 + 最近 8 轮 + 工具结果）做“在另一引擎继续”，原会话只读。
- [ ] **2.7 账号 token 生命周期**
  - 轻引擎 401 时明确提示“账号登录已过期，切完整模式重新登录”；
  - 提供重登入口；不要静默失败。
  - 现状（2026-11-05）：401 横幅已能显示（真机验证 `Authentication Fails (governor)`），
    并加了「重新登录」按钮（切完整引擎 + 打开设置；账号卡已登录时也有「重新登录」= 退出后重走 OAuth）。
    真机已验证：点 401 横幅「重新登录」→ 完整引擎 ready → 设置「模型与凭据」页，
    账号卡「已登录」且有 重新登录/退出登录/查看用量，底部「当前引擎 完整引擎（本机）」。
    浏览器 OAuth 授权本身、以及重登后切回轻引擎自动用新 token 仍未走完。
    2026-11-05 新证据：**同一账号 token 在完整引擎可用**（bash python 三库返回版本），
    根因是旧保存配置缺 `authMode/authToken`，轻引擎以 `auth=none` 请求（PITFALLS I7）。
    已在 `resolveLightSetup` 自动补账号 token 并加 `[light] auth=…` 日志；真机日志已变
    `auth=account(64) base=https://api.deepseek.com/v1`。**已真机复验通过（2026-11-05 20:49）**：
    发 “hi” 得到 `[light] ttft=982ms stream=1312ms model=deepseek-chat step=1 first=content tools=0
    usage=in:2152,out:42 run=…` 且 `done`，不再 401。
    恢复入口/重登按钮保留，浏览器 OAuth 重登流程仍未走完。


### M3 · 未开始

- [ ] **3.1 官方 OAuth 真机验证**（loopback + 拒绝授权）
- [ ] **3.2 LAN 直连**（mDNS、E2E WS、索引同步、离线状态机）
- [ ] **3.3 系统入口**（小组件、悬浮球、QS、通知直达、后台分享）

### M4 · 远期

- [ ] relay / WebRTC DataChannel
- [ ] iOS 遥控器 + Share Extension / Live Activity
- [ ] L1 插件自动转译（`phone-bundle`）

### 已知缺口（未成任务）

- bridge 对非流式 `assistant/message` 可能漏转；
- follow WS 没有 `onclose/onerror` 自动重连（靠进会话重建）；
- 图片渲染未做系统真机验收；
- 历史“已回答”问题没有官方那种只读问答卡；
- TTS/朗读未接（需要原生 TTS）；
- 轻引擎账号 token 读自明文 YAML，安全模型需在文档里说清；
- 发布签名/正式包流程（见 E8）。

## 3. 工程债

- [ ] **E1** JS bundle 4.2MB，Metro 不拆包 → 按需资源包
- [ ] **E2** 一会话一 run，无队列 → 并发上限 + 排队
- [ ] **E3** 宿主缺会话删除/正文搜索 → 等上游或自建索引
- [ ] **E4** 沙箱只有 JS 层路径约束 → 文档别承诺安全边界
- [ ] **E5** 真机回归靠手跑 → 发版前跑 `scripts/device-*.ts`
- [ ] **E6** 文档过时 → 每次改动同步四篇文档
- [x] **E7** 无性能基准 → `scripts/bench-light.ts` 取 P50/P90
- [x] **E8 签名/发布流程**：固定 keystore、release 签名、正式包/版本号；当前设备包与本机 keystore 不一致，只能靠 Metro 验证
  - 2026-11-05：`python.bin` 已上传 `runtime-v1` release（sha256 `2cc882ce…`），`setup-android.sh` 会校验；
    `scripts/gen-release-keystore.ps1` 生成专属 release keystore + `app/android/keystore.properties`（都 gitignore），
    `assembleRelease` 走 release 签名（V2，`CN=DSH Palm`，SHA-256 `50de0609…`），版本号可用
    `DSH_PALM_VERSION_CODE/NAME` 覆盖。产物 `app-release.apk` 243.5MB，含 rootfs/payload/python.bin/index.android.bundle。
  - 仍需：keystore + 密码备份（丢了不能覆盖升级）；设备上仍是 debug 包，release 包覆盖装需先统一签名/卸载；
    正式发版前在干净设备走一次首装 + 升级。


## 4. 待决事项

| 项 | 选项 | 建议 |
|---|---|---|
| ASR/OCR 时机 | ASR 先进 P1 / OCR 后置 | 先 ASR，音频路由才闭环 |
| iOS 范围（D2） | 只遥控器 / 也要轻引擎 | 先遥控器 |
| 插件市场（D3） | 只启用/配置 / 下载执行 | 前者（2.5.2） |
| 多端同步（D4） | 索引+引用 / 也同步正文 | 仅索引+引用 |
| PDF（C14） | 继续暂缓 / 重启 | 继续暂缓 |

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
