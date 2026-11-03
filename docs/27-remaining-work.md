# 27 · 剩余工作清单（唯一任务来源）

> 2026-11-03 整理。M1 主链路已真机验证（见 [26](26-light-engine.md)）。
> **本文件是任务状态与优先级的唯一来源**；[28](28-engine-routing.md) 只定路由规则，
> 不再重复列任务。PDF 相关（附件与生成）按 2026-11-03 决策暂缓。
> 阶段划分沿用 [23](23-requirements.md) §8；非 UI 工程债另见 [20](20-open-work.md)。

## 0. 现在的基线

- 轻引擎：会话 / 流式 / 审批 / 提问 / 工具（bash、文件读写、docx/xlsx、生图），
  真机 PLR110 全链路通过；深链 `dshpalm://light?...` 可配置模型渠道；
- IFileSystem：Node + expo-file-system 双后端，真实 `<filesDir>/workspace`；
- 测试：`npm run verify` 全绿（**数量以命令输出为准**，文档里不再写死）；
- 包体：JS 4.2MB / APK 14.7MB（含 docx/xlsx）；
- 未完成：Office 三件套、引擎路由/加载、附件收件、真生图渠道、WebView 联动、
  账号/互联/小组件、iOS；PDF 暂缓。

## 1. P0 · 当前优先（本轮）

### 1.1 Office 三件套（proot + Python）

- **现状**：`dsh-skill-office` 在 rootfs 里，但没有 Python；轻引擎只有 docx/xlsx 的
  创建+读取（无编辑、无样式/公式），pptx 没有。
- **要做什么**：
  1. proot 里 `python3 + python-docx + openpyxl + python-pptx`；
  2. 跑通 docx / xlsx / pptx 的创建、读取、编辑；
  3. 决定打包方式（进 payload / 首次下载）。
- **验收**：三种格式各生成一份、读回、编辑一份；记录体积与耗时。
- **估时**：spike 0.5–1d + 打包 0.5–1d。

### 1.2 EngineManager + 轻引擎默认

- **现状**：`App.tsx` 启动即 `startLocalHost()`（起 proot + 桥），轻引擎只能从
  实验室或 `dshpalm://light` 手动连。
- **要做什么**：
  1. `EngineManager` 状态机：`light` 默认、`proot` 触发式；
  2. `warmLocalHost()`：只 `startHost()` 不 `connect`，UI 继续用轻引擎；
  3. 顶栏「轻/完整」角标 + 手动切换；
  4. 预热策略（触发式默认；智能预热可选）；idle 回收、`onTrimMemory` 优先停 proot。
- **验收**：冷启动到可输入 <1s；proot 不自动连接；切换有进度；失败回退不丢回合。
- **估时**：2–3d。

### 1.3 附件收件管线（原生侧）

- **现状**：proot 的 `attachments.upload` 走 base64（上限 20MB）；轻引擎不支持附件；
  分享只处理冷启动。
- **要做什么**：
  1. 原生收件（分享/相册/文件选择器）→ `<filesDir>/workspace/uploads/<hash>-<name>`；
  2. 生成路径引用（不走 base64），两个引擎都能读；
  3. 附件 chip 标注「轻/完整」；PDF 等未支持格式只保存 + 提示；
  4. 大文件（>20MB）只走路径。
- **验收**：分享图片/文档进 `uploads/`；两种引擎都能读；不出现 base64 大包。
- **估时**：1–2d。

### 1.4 预路由 + 能力门 + Handoff v1

- **现状**：没有能力路由；会话内切预设已按能力隐藏；两个引擎各一套会话。
- **要做什么**：
  1. 发送前按 28 的 R2/R3 预路由；
  2. 轻引擎工具执行前检查能力，缺能力返回 `capability_missing`（无副作用）；
  3. Handoff：摘要 + 最近 8 轮原文 + 工具结果 + 文件引用 + 待执行步骤；
  4. 一条逻辑会话（`ConversationLink`）；只重发未执行步骤；失败回退。
- **验收**：手动/能力门切换都能续跑；重复副作用 0；用户看不到两个会话。
- **估时**：3–4d。

### 1.5 M1 收尾剩余

| 项 | 现状 → 要做 | 估时 |
|---|---|---|
| 真生图渠道 | 现在用 mock 1×1 PNG；接真实 OpenAI 兼容渠道，验 `b64_json`/`url` | 0.5d |
| 真模型 ttft + 异常 | 只在假模型量过；补真模型流式、断网、401/429 | 0.5d |
| 文件名边界 | 只验 ASCII 名；补中文、空格、`#`/`%` | 0.5d |
| 文件面板 | 生成的文件没有打开/分享入口 | 1–2d |

### 1.6 PDF（暂缓，保留方案）

> 决策：PDF 附件与 PDF 生成都先不做，见 [28](28-engine-routing.md) 的 C13/C14。
> 重启这条线时再执行。

- **现状**：`pdf-lib` 没接；标准字体不含 CJK。
- **要做什么**：先拍板字体方案（见 §5 D1），再实现 `create_pdf` + `read_pdf`。
- **验收**：中文 A4 PDF 可打开；生成+读回一致；≤1.5MB/页；Hermes ≤2s。
- **估时**：字体 0.5d + 工具 1d + 真机 0.5d。

## 2. M2 · WebView + 迁移完整版 + 插件徽章

### 2.1 WebView 与 RN 的会话态联动

- **现状**：实验室能打开官方 web 前端，但 token 从日志里捞，与 RN 会话不互通。
- **要做什么**：宿主暴露 web 地址/token；RN 点会话 → WebView 直达；WebView 切会话 →
  RN 回报；前后台/登录态/清理。
- **验收**：两端同一会话互见；杀进程后状态一致。
- **估时**：3–4d。

### 2.2 会话迁移完整版

- **现状**：P0 的 1.4 只做「摘要 + 8 轮」接续，块结构不平移。
- **要做什么**：把轻引擎 turns 投影成 dsh 事件回放（或更完整的结构化交接）；
  失败回退与重复副作用校验。
- **验收**：思考/工具卡在 proot 会话里可还原；上下文保真测试通过。
- **估时**：1 周。
- **说明**：P0 已完成 v1，这里只做增强，不重复能力门。

### 2.3 插件徽章

- **现状**：`scripts/plugin-compat.ts` 能出 L0–L4 矩阵，App 没入口。
- **要做什么**：设置页插件兼容列表（内置矩阵 + 搜索 + 徽章 + 判定理由）。
- **验收**：10 个常见包徽章与矩阵一致；离线可看。
- **估时**：2–3d。

### 2.4 轻引擎附件引用（引擎侧）

- **现状**：1.3 已把文件放进 `uploads/`，但轻引擎仍不能把图片作为视觉输入。
- **要做什么**：轻引擎读取路径引用；图片按 provider 能力发 base64/URL；超限降级为
  「已收到图片 + 路径」。
- **验收**：相册发图后轻引擎会话能描述图片；无视觉能力时明确提示。
- **估时**：1–2d。
- **说明**：1.3 是原生收件，2.4 是引擎侧消费，两者不重复。

### 2.5 轻引擎多提供商

- **现状**：单文本渠道 + 单生图渠道，配置在实验室/深链。
- **要做什么**：轻引擎实现 `providers.list/save/discover`（SecureStore 多个 Key），
  设置页复用 ProvidersCard；会话选渠道。
- **验收**：配 2 个渠道并流式成功。
- **估时**：3d。

## 3. M3 · 账号 / 互联 / 系统入口

### 3.1 官方 OAuth 真机验证（R3'）

- **现状**：源码结论可行，Platform 是否接受手机 loopback 回调没实测。
- **要做什么**：App 内起 `127.0.0.1` 随机端口 + `/oauth/callback`，Custom Tabs，
  回调换 token 存 SecureStore；处理用户拒绝授权。
- **验收**：真机登录 → 能调模型；拒绝 10s 内报错而不是等 600s。
- **估时**：3–5d。

### 3.2 LAN 直连（配对 + 会话索引同步）

- **现状**：配对码/共享密钥协议已冻结（docs/11），实现是单机 WS + 手动地址。
- **要做什么**：mDNS、E2E 加密 WS、会话索引拉取、离线状态机。
- **验收**：同 Wi-Fi 扫码 5s 内看到对方会话；电脑离线不影响手机。
- **估时**：1–2 周。

### 3.3 系统入口

- **现状**：只有通知（点开回 App）+ 冷启动分享。
- **要做什么**：Android 小组件、悬浮球、QS 磁贴；通知直达会话/审批卡；后台分享。
- **验收**：锁屏「待审批」点开直达卡片；小组件 30s 内刷新。
- **估时**：1–2 周。

## 4. M4 · 远期

- relay / WebRTC DataChannel；
- iOS 遥控器（纯 JS）+ Share Extension / Live Activity；
- L1 插件自动转译（`phone-bundle`）。

## 5. 需要拍板的决策

| 编号 | 决策 | 选项 | 建议 |
|---|---|---|---|
| D1 | PDF 中文字体 | ① Noto Sans SC 子集；② 运行时下载；③ 等 LibreOffice | **暂缓（C14）**；重启时选 ① |
| D2 | iOS 范围 | 只做遥控器 / 也要轻引擎 | 先遥控器 |
| D3 | 插件市场合规 | 只做启用/配置 / 下载执行 | 前者（2.5.2 约束） |
| D4 | 多端同步范围 | 仅索引+引用 / 也同步正文 | 仅索引+引用 |

## 6. 工程债 / 质量

| # | 债 | 影响 | 建议 |
|---|---|---|---|
| E1 | JS bundle 4.2MB，Metro 不拆包 | 首启/更新成本 | M2 按需资源包 |
| E2 | 一个会话一个 run，无队列 | 同时跑抢 CPU | M2 调度器 |
| E3 | 宿主缺口：会话删除、正文搜索 | 抽屉只能改名/归档 | 等上游或自建索引 |
| E4 | 沙箱只有 JS 层路径约束 | 不是安全边界 | 文档别承诺 |
| E5 | 真机回归靠 adb 脚本 | 没有 CI 真机 | 发版前手动跑 |
| E6 | 文档过时 | 新人踩坑 | 每轮顺手修 |
| E7 | 无性能基准 | ttft 只有单次 | `scripts/bench-light.ts` P50/P90 |

## 7. 建议顺序

1. **1.1 Office 三件套 spike** 与 **1.2 EngineManager** 并行（互不冲突）；
2. **1.3 附件收件** + **1.4 路由/Handoff v1**；
3. **1.5 M1 收尾剩余**（生图/ttft/文件名/文件面板）；
4. **2.x M2**：WebView、迁移完整版、插件徽章、轻引擎附件/多提供商；
5. **3.x M3**：OAuth、LAN、系统入口；
6. **4.x M4**。

## 8. 交接：怎么跑

```bash
# 分支：从 develop 切，一个方面一个分支（见 docs/21）
git switch develop
git pull
git switch -c feat/<task>

# 验证（数量以输出为准）
npm run verify

# 真机（Android，无线 adb）
node --import tsx scripts/mock-model-server.ts 8799
MOCK_PLAN=docs node --import tsx scripts/mock-model-server.ts 8799
node --import tsx scripts/device-m1-check.ts <apk>
node --import tsx scripts/device-real-check.ts <apk>
```

构建注意：仓库路径太长会让 CMake 报 `build.ninja still dirty`，把工作区放到短路径
（如 `D:\dp`）再 `gradlew :app:assembleRelease`；`debug.keystore` 需要 `keytool` 生成一次；
真机测试包用独立 `applicationId`，验完改回并卸载。
