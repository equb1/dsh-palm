# 28 · 引擎路由与加载策略

> 状态：**2026-11-03 确认稿**。需求以 [23](23-requirements.md) 为准；本文只定「什么时候用轻引擎、什么时候用 proot、怎么切、附件和 Office 怎么分流」。
> 冲突时：需求看 23，路由看本文。

## 0. 一句话

**默认轻引擎；proot 后台按需（可选预热）；原生收件、共享工作区；按能力路由，回合边界交接，一条逻辑会话；PDF 相关暂不做。**

## 1. 既定事实

| # | 事实 | 依据 |
|---|---|---|
| F1 | 手机是完整宿主，电脑是可选宿主；轻引擎默认、proot 按需 | 23 |
| F2 | 两引擎同协议，UI 只认协议；store 支持 `light` / `remote` | 26 |
| F3 | 工作区共用 `<filesDir>/workspace`，切换引擎文件连续 | 26 |
| F4 | 轻引擎进程内（Hermes），无子进程、无 Python、bash 内无网络 | `light/tools.ts` |
| F5 | proot 是 Ubuntu 24.04 + Node + dsh，有 apt 与完整插件生态 | 真机 rootfs |
| F6 | proot 拿不到 Android 原生 API；iOS 没有 proot | 23 §2 |
| F7 | 轻引擎独有：分享/通知/相机/相册/OCR/ASR/小组件/悬浮球/深链/SecureStore、秒开低内存、iOS | 23、26 |
| F8 | proot 独有：真 Python/Node/二进制、L3 插件、大文件、后台长任务 | 23 §4 |
| F9 | proot 冷启动 13.7s；node 239MB + 桥 80MB ≈ 320MB；App 自身约 320MB | 真机实测 |
| F10 | 轻引擎目标 <300ms 就绪、冷启动到可输入 <1s P90 | 23 |
| F11 | 轻引擎 10 个工具；读上限 10MB；软链 EPERM；chmod 只内存；附件上传 unsupported | 26、代码 |
| F12 | 测试基线：`npm run verify` 全绿 | 数量以命令输出为准 |
| F13 | `dsh-skill-office` 已在 rootfs；但无 Python、无 linux-arm64 LibreOfficeKit | 真机 rootfs |
| F14 | 三件套（docx/xlsx/pptx 创建/读取/编辑）可用 Python 补齐，约 50–60MB | 本机验证 |
| F15 | render / recalculate / PDF 导出 / 旧 `.doc/.ppt` 需要真 LibreOffice（约 400–600MB） | 17、23 |
| F16 | 轻引擎已有 docx/xlsx 创建+读取；无编辑、无样式/公式；pptx 没有 | 26、代码 |

## 2. 能力边界

### 2.1 交集（两边都能做）

会话 / 流式 / 审批 / 提问；工作区读写；简单 shell（ls/grep/sed/awk）；docx/xlsx 创建与读取；生图 API。

### 2.2 只有 proot 能做

- 真 Python / Node 脚本、git、ffmpeg、编译、PTY；
- LibreOffice 转换、渲染、公式重算、旧 `.doc/.ppt`；
- L3 插件、完整 dsh 插件生态、skills；
- 大文件（>10MB）、软链、chmod 持久化；
- 后台/锁屏长任务。

### 2.3 只有轻引擎能做

- Android 原生入口：分享、通知、相机、相册、OCR、ASR、小组件、悬浮球、深链、SecureStore；
- iOS（未来）；
- 秒开、低内存、无守护进程。

> 结论：**不是子集关系**。路由必须双向判定，不能假设 proot 能兜底一切。

## 3. 路由规则

### R1 启动与默认

| 条件 | 默认 | 回退 |
|---|---|---|
| 有轻引擎配置 | **轻引擎** | 起不来 → proot（提示一次） |
| 没有配置 | 引导配渠道，可跳过直接 proot | — |
| 用户点「完整模式」 | proot | 起不来 → 回轻引擎 + 错误卡 |

### R2 按预设

| 预设 | 引擎 |
|---|---|
| 文档 / 票据 / 纪要 / 日常 | 轻引擎 |
| 开发者 | proot（可预热，首次提示） |

### R3 发送前预路由（消息意图）

| 命中 | 引擎 |
|---|---|
| 跑代码/脚本、python/node/npm/git/ffmpeg、编译、测试、装依赖 | proot |
| 转 PDF、渲染、旧 `.doc/.ppt` | **默认不做**（C8）；需要时走电脑端或 proot 可选装 LibreOffice |
| 要后台/锁屏继续跑 | proot（轻引擎后台会被冻结） |
| 其余 / 不确定 | 轻引擎，失败再走 R4 |

### R4 工具能力门（兜底）

1. 轻引擎工具执行**前**检查能力；缺能力返回 `capability_missing`，**不产生副作用**；
2. 用户确认 → 启动/连接 proot → Handoff → 只重发未执行的那一步；
3. 已执行的工具结果原样带走，**绝不重放**；
4. proot 失败 → 回轻引擎原会话，保留当前回合。

### R5 原生入口（永远不走 proot）

分享、通知、相机、相册、OCR、ASR、小组件、悬浮球、深链、SecureStore：原生/轻引擎侧处理，结果作为**文件或消息**交给当前引擎。

### R6 后台与长任务

| 场景 | 规则 |
|---|---|
| 锁屏/后台继续跑 | 必须 proot |
| 轻引擎里发起长任务 | 提示「切完整模式，否则后台会停」 |
| proot 空闲回收 | 无运行回合且 idle 10min → 停止（可配置） |
| 内存压力 | 优先停 proot，轻引擎不受影响 |

### R7 附件路由

**统一收件管线**：系统分享/相册/文件选择器 → 原生复制到 `<filesDir>/workspace/uploads/<hash>-<name>` → 生成路径引用（不走 base64）。

**判定顺序（固定，避免「图片走轻、混合走重」互相矛盾）**：

1. **收件永远在原生侧**，先落 `uploads/`；
2. **原生预处理优先**：图片先 OCR/视觉，音频先 ASR/转写；
3. 预处理后，**按剩余操作**决定引擎：
   - 只是描述/摘要/读写 → **light**；
   - 需要真二进制、编辑现有 Office、pptx、视频/压缩包、>10MB → **proot**；
4. **混合附件**：先做原生预处理；只要**任一文件**在预处理后仍需 proot，就在 **proot 汇合**，
   OCR/ASR 的文本结果与文件路径一并带入；全部文件都只需轻处理时才用 light。

| 附件类型 | 首选 | 备选 / 说明 |
|---|---|---|
| 图片 / 截图 | 原生收件 + OCR/视觉（light） | proot 无相机/OCR；纯看图可由模型直接吃图 |
| docx / xlsx | light（简单读写） | 编辑/复杂版式 → proot |
| pptx | proot（Python 三件套） | light 无 |
| 音频 | 原生 ASR → light | 无 ASR 时 proot + ffmpeg/模型；先转写再选引擎 |
| 视频 | proot（ffmpeg 抽帧/抽音频） | 不直接喂模型 |
| 压缩包 | proot（unzip） | light 只有 gzip stub |
| 代码 / 文本 | 读改写 light；跑/构建 proot | 文件共用 |
| >10MB | proot 或分块 | light 单次读上限 |
| 混合附件 | 先原生预处理，有一个需 proot 就在 proot 汇合 | 全轻才用 light |
| **PDF / 未支持格式** | **原样存到 `uploads/` + 提示「暂不支持解析」** | 不建解析链路，不承诺效果 |

> 2026-11-03 决策：**PDF 附件先不做**（C13）。PDF 生成也一并延期（C14）。

### R8 Office 路由

| 操作 | 引擎 |
|---|---|
| docx/xlsx 创建、读取 | **light** |
| docx/xlsx 编辑现有文档、复杂版式/样式/公式 | **proot + Python 三件套** |
| pptx 创建/读取/编辑 | **proot + Python 三件套** |
| 旧 `.doc/.ppt` | proot 可选装 LibreOffice，或电脑端 |
| render / recalculate / 导出 PDF | LibreOffice（可选包）或电脑端；**默认不做** |

Python 三件套：`python3 + python-docx + openpyxl + python-pptx`，约 50–60MB。打包方式（进 payload / 首次下载）在 spike 后定。

### R9 会话与配置

- 会话列表：**统一列表 + 「轻/完整」badge**；两个引擎各保留自己的 `currentId`。
- 渠道配置：**共享一套 `EngineProfile`**（light ↔ dsh providers 同步），避免配两遍。

### R10 切换与交接

见第 4 节。

### R11 预热与回收

| 档位 | 行为 | 默认 |
|---|---|---|
| 触发式 | 用到才起，有进度 | ✅ 默认 |
| 智能预热 | 充电 + Wi-Fi + 前台 10s → 后台起；idle 10min 停 | 可选 |
| 常备 | 一直驻留 | 高级开关，明确提示内存成本 |

### R12 禁止/不可切

- 原生流程中（拍照/OCR/分享）不切 proot；
- proot 独有能力不自动降级回 light；
- 有待审批/待回答时不切；
- 有附件时不要「先发再切」，走 R7 预路由。

## 4. 切换与交接协议

### 4.1 时机

| 时机 | 说明 |
|---|---|
| 预路由 | 发送前按 R2/R3 直接选对引擎（最好） |
| 能力门 | 工具执行前缺能力（R4） |
| 手动 | 顶栏「轻/完整」角标，空闲时点 |

### 4.2 Handoff

```
Handoff {
  conversationId
  presetId, permission
  model { baseURL, model, apiKeyRef }
  summary
  recentTurns[8]      // 含工具调用与结果
  artifacts[]
  pendingIntent       // 触发切换的那一步
}
```

### 4.3 流程

1. 冻结轻引擎（无 streaming / 待审批 / 待回答）；
2. 确认 proot 就绪（已预热→直连；否则启动并显示进度）；
3. 在 proot 建新会话（同 preset、同模型、同权限）；
4. 注入 Handoff；
5. 只重发**未执行**的那一步工具；
6. 轻引擎会话标「已交接」，UI 用分隔线连成一条逻辑会话。

### 4.4 规则

- 只在回合边界切；
- 已执行工具**绝不重放**（避免重复写文件/重复调 API）；
- 模型/渠道必须一致；不一致时明示「模型已切换」；
- **一条逻辑会话**：`ConversationLink` 映射两个 sessionId，原会话只读保留；
- 失败回退：proot 起不来/交接失败 → 留在 light，不把这一轮标失败。

## 5. 执行顺序（任务定义见 27）

本文只排顺序；**任务内容、验收、估时统一在 [27-remaining-work.md](27-remaining-work.md)**，避免两处各写一套。

1. **27 §1.1 Office 三件套** 与 **27 §1.2 EngineManager** 并行（互不冲突）；
2. **27 §1.3 附件收件** + **27 §1.4 预路由/能力门/Handoff v1**；
3. **27 §1.5 M1 收尾剩余**（生图 / ttft / 文件名 / 文件面板）；
4. **27 §2.x M2**：WebView、迁移完整版、插件徽章、轻引擎附件/多提供商；
5. **27 §3.x M3**、**27 §4 M4**。

### 验收指标

- 冷启动到可输入 <1s P90；轻引擎就绪 <300ms；
- proot 预热后切换 <1s，冷启动 <15s 且有进度；
- 交接重复副作用 = 0；失败回退不丢回合；
- 用户可见的「两个会话」= 0；
- 后台长任务必须走 proot，轻引擎里发起要明确警告。

## 6. 决策记录

### 已确认（2026-11-03）

| 编号 | 决策 |
|---|---|
| C1 | 默认轻引擎（有配置时），proot 触发式 |
| C2 | 预热默认关；智能预热为可选开关 |
| C3 | 会话列表统一 + 轻/完整 badge |
| C4 | 渠道配置共享一套 |
| C5 | 迁移用「摘要 + 最近 8 轮 + 工具结果」；事件回放后期 |
| C6 | 原生收件 → `uploads/` → 路径引用 |
| C7 | Office 三件套补 Python；docx/xlsx 简单走 light，编辑/pptx 走 proot |
| C8 | render / recalc / 旧格式 / PDF 全部暂不做 |
| C9 | 轻引擎不补 pptx |
| C10 | 后台长任务必须 proot |
| C11 | 切换前后模型/渠道必须一致，不一致要明示 |
| C12 | 本文落点 docs/28 |
| C13 | PDF 附件：原样保存 + 提示暂不支持 |
| C14 | PDF 生成也延期 |

### 仍待定

| 项 | 说明 |
|---|---|
| Python 打包方式 | 进 payload（离线可靠，+50–60MB）vs 首次下载（包小，依赖网络） |
| ASR/OCR 时机 | ASR 先进 P1，OCR 可后置 |
| iOS 范围（D2） | 先遥控器 |
| 插件市场（D3） | 只做启用/配置，不下载执行 |
| 多端同步（D4） | 只同步索引 + 引用 |

## 7. 参考

- [23-requirements.md](23-requirements.md)：v1 需求冻结
- [26-light-engine.md](26-light-engine.md)：轻引擎与 IFileSystem
- [27-remaining-work.md](27-remaining-work.md)：剩余工作清单
- [21-git-workflow.md](21-git-workflow.md)：分支规范
