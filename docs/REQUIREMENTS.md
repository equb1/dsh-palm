# 锦囊 · 需求文档

> 状态：v1 冻结（2026-11-03 整理）。**本文件是产品需求的唯一来源**。
> 技术实现见 [TECHNICAL](TECHNICAL.md)；踩坑见 [PITFALLS](PITFALLS.md)；任务与规则见 [AI-TASKS](AI-TASKS.md)。
> 历史详细版：[archive/23-requirements.md](archive/23-requirements.md)。

## 1. 一句话

**手机是完整宿主**：默认跑轻量 TS 引擎（秒开），需要真环境时按需拉起完整引擎（proot），
电脑是可选的另一台宿主；三者共用一套会话 / 审批 / 工具协议。

## 2. 目标与非目标

### v1 目标

1. 手机离线可用的 agent：问答、文档、票据、会议纪要、生图、语音输入。
2. 默认体验快：冷启动到可输入 **<1s（P90）**，轻引擎就绪 **<300ms**；完整引擎按需。
3. **能跑现有 DSH 插件**：按兼容等级自动选择运行时。
4. 官方账号登录；手机与电脑的会话可聚合、可续跑、可双向委派。
5. Android 桌面小组件 / 悬浮球；iOS 小组件 / 实时活动（后续）。

### v1 非目标

- 手机端作为代码开发主场景（写代码、跑仓库让给电脑；proot 只是可选能力）。
- 在轻引擎里运行 Node 原生插件（依赖 `node:fs`/`child_process` 的旧插件）。
- iOS 全局悬浮窗（系统不允许）。
- 推送、插件市场交易、桌宠、皮肤。
- PDF 相关（附件解析与生成）——2026-11-03 暂缓。

### 体验原则

1. **首屏永远不等引擎**：先读本地缓存，引擎就绪再补齐。
2. **单手可达**：主操作在拇指区；危险操作二次确认。
3. **状态可见**：运行中/待确认/出错写在控件或行内，不堆横幅。
4. **错误可行动**：说清「发生了什么 + 怎么办」，不抛协议原文。
5. **中文优先、术语克制**：会话、锦囊、完整模式、轻模式。
6. **暗色优先**，浅色后续；动效少而短。

## 3. 用户与场景

| 场景 | 说明 | 默认运行时 |
|---|---|---|
| 随身问答/写作 | 通勤、会议间隙，打开即用 | 轻引擎 |
| 文档处理 | 纪要、周报、票据、表格 | 轻引擎（docx/xlsx）；pptx/编辑 → proot |
| 会议录音 | 录音转写 + 摘要 | 原生 ASR → 轻引擎 |
| 跑脚本/装依赖/转格式 | 真 Python/Node、ffmpeg、LibreOffice | proot |
| 长任务值守 | 锁屏继续跑 | proot（轻引擎后台会被冻结） |
| 多端接力 | 手机看电脑会话、继续跑 | 电脑宿主 / 后续 LAN |

## 4. 能力 → 运行时矩阵

| 能力 | 运行时 | 实现 |
|---|---|---|
| 问答/写作/推理/多轮 | 轻 TS | Hermes + 自带 agent loop，流式/思考/审批/提问 |
| 文档生成与解析（docx/xlsx） | 轻 TS | `docx`、SheetJS |
| 文档生成与解析（PDF） | — | **暂缓**（C14） |
| 文档格式转换/渲染（office→pdf/png） | proot / 电脑 | LibreOffice；**v1 暂缓**（C8） |
| 生成图像 | 轻 TS | 调图像模型 API + 落盘 |
| 图像理解/OCR | 原生 | ML Kit / Vision（后续） |
| 录音/转写 | 原生 | sherpa-onnx（DSH 已有 sensevoice 包） |
| 语音合成 | API/原生 | 看 provider |
| 音视频转码/剪辑 | proot | ffmpeg |
| **跑**脚本（python/node/shell） | **proot** | 真 Linux + Node 24 |
| 浏览器操作 | WebView / 电脑 | DOM 桥 |
| 旧 DSH 插件 | 分五层，见 §5 | |
| 多端互联 | 桥 + 中继 | 账号只做身份 |

## 5. 插件兼容体系

| 层 | 插件形态 | 手机端跑法 | 改动量 | 启动成本 |
|---|---|---|---|---|
| **L0** | Web UI 插件 | WebView 打开官方 web 前端 | 零改动 | 随 WebView |
| **L1** | 纯 JS 服务端插件（轻内建） | 轻引擎 + node shim | 小 | 亚秒 |
| **L2** | 需要 fs/http/net/crypto 的 Node 内建 | **当前无运行时**：按 L3 或由轻引擎重写 | 中 | — |
| **L3** | 需要真实二进制（child_process/python/git/libreoffice） | proot + 真 Linux | 零改动 | 13.7s，按需 |
| **L4** | 需要桌面能力（Electron、本地大模型） | 电脑端执行，手机远程调用 | 零改动 | 无 |

关键结论（R4，2026-11-02）：内嵌 Node 不可行——`nodejs-mobile` 停在 Node 18.20.4，
而 DSH 0.2.1 需要 Node 22.15+ API（zstd、`node:sqlite`、`Promise.withResolvers`）；
koffi/node-pty/sharp/sherpa 也没有 Android prebuild。**所以 L2 不设独立运行时**。

> 插件市场 v1 只做「启用/禁用 + 配置下发 + 内置插件」，不下载 JS 执行（App Store 2.5.2）。
> App 内提供离线兼容矩阵（M2.3）：内置快照 + 搜索 + L0–L4 徽章 + 判定理由。

## 6. 账号与多端

### 登录（官方 OAuth）

- 官方包走 browser PKCE + loopback 回调，`redirect_uri` 只认
  `http://localhost|127.0.0.1|[::1]:<显式端口>/oauth/callback`，不支持自定义 scheme。
- 手机方案：App 内起 `127.0.0.1` 随机端口 HTTP server（路由固定 `/oauth/callback`），
  用 Custom Tabs 打开授权页，回调换 token 存 SecureStore。
- 已知：token 无 refresh；state/PKCE 只在内存，App 被杀则登录尝试作废；回调不处理 `error` 参数。

### 多端（账号只做身份，不做通道）

| 层 | 通道 | 场景 |
|---|---|---|
| 1 | 同 Wi-Fi 直连（mDNS/IP + 端到端加密 WS） | 家里/办公室 |
| 2 | 自建 relay（Cloudflare Workers/DO 或 Tailscale） | 跨网 |
| 3 | WebRTC DataChannel + TURN | 低延迟，relay 兜底 |

- 语义：镜像 / 分叉 / 委派；**单 writer**；文件只同步索引，正文按 `dsh://<host>/<path>` 按需拉。
- 降级红线：电脑离线时手机全部本地功能不受影响。

## 7. 系统入口

| 平台 | 小组件 | 悬浮/快捷 |
|---|---|---|
| Android | AppWidget（RemoteViews） | overlay 悬浮球、QS 磁贴、分享目标 |
| iOS | WidgetKit | Live Activity/灵动岛、App Intents、Share Extension |

入口只承载四件事：最近会话、任务进度、一键语音、审批提醒；点击进 App，不跑长任务。

## 8. 数据与隐私

| 实体 | 归属 | 同步 |
|---|---|---|
| 账号凭据 | 账号级 | 端到端加密 |
| 设备身份/公钥 | 账号级 | 是 |
| 会话 | 宿主级 | 只同步元数据与状态，正文按需 |
| 文件 | 宿主级 | 否，靠引用 |
| 插件兼容报告 | 公共 | 可缓存 |

relay 只见密文；文件永不离家。

## 9. 预设与工作区

- **预设**（锦囊）：`standard` / `ptc` / `minimal` / `cordis`，定义 agent 的工作方式。
- **工作区**：`<filesDir>/workspace`；proot 里 bind 为 `/root/work`；两种引擎共用，切换文件连续。
- ⚠️ 真 dsh 宿主只有三档权限，没有工具白名单；预设目前映射为 `agentPreset`，
  **不要把它当安全边界**（详见 TECHNICAL）。

## 10. 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| **M0** | 四个 spike + 兼容分析器 | ✅ 2026-11-02 静态结论 |
| **M1** | LightEngine MVP：会话/流式/审批/提问 + 文档 + 生图 | ✅ 主链路真机通过；剩余见 AI-TASKS |
| **M2** | WebSurface + 完整引擎按需 + 插件徽章 | 进行中 |
| **M3** | 官方登录 + LAN 互联 + Android 小组件/悬浮球 | 未开始 |
| **M4** | relay/WebRTC + iOS + L1 自动转译 | 未开始 |

## 11. v1 验收标准

1. 冷启动到可输入 <1s（P90）；轻引擎就绪 <300ms。
2. 完整引擎首次启动 <15s，且只在需要时发生；之后可常驻。
3. 兼容矩阵覆盖 dsh 0.2.1-rc.5 全部 305 个包，人工抽检准确率 >95%。
4. 手机端可运行 L0 + L1 插件占全量 ≥60%（按包数）。
5. 断网可用：会话、文档、OCR、文件操作；联网后自动补模型调用。
6. 账号登录后，电脑在线时手机能看到并续跑电脑会话；电脑离线不影响手机。
7. 长会话流式：同一段思考/正文不重复；用户上滑后不被自动追底抢走；回到底部可恢复跟随；退出重进不丢正在输出的内容。

## 12. 已定决策

| 编号 | 决策 |
|---|---|
| D1 | PDF 中文字体：**暂缓**（重启时选 Noto Sans SC 子集） |
| D2 | iOS 先做遥控器，不做本机引擎 |
| D3 | 插件市场只做启用/配置，不下载执行 |
| D4 | 多端只同步索引 + 引用，不同步正文 |
| C1–C14 | 引擎路由/加载决策，见 [TECHNICAL](TECHNICAL.md) 第 6 节 |

## 13. 参考

- 历史需求原文：[archive/23-requirements.md](archive/23-requirements.md)
- 产品定位：[archive/01-product.md](archive/01-product.md)
- 路线：[archive/06-roadmap.md](archive/06-roadmap.md)
