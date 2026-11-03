# 04 · 技术栈

## 结论

**RN + Expo prebuild（CNG）+ TypeScript。不用 Expo Go，不用纯托管。**

不是因为它最优，是因为"一个人 + 熟悉 RN + 必须跨端"这组约束下，它最可能活到发布。

## 三条硬规矩

RN 的死法只有一个：原生模块越写越多，最后变成一个"用 RN 写的 Android 应用"，跨端优势归零。守住这三条就不会。

### 规矩一：引擎是独立进程，UI 是纯客户端

所有业务逻辑在 Node 侧，RN 只通过本地 HTTP + WS 说话。

一次解决三件事：UI 可跨端、逻辑可单测、引擎崩溃不带走界面。

### 规矩二：每个平台原生代码 ≤ 1500 行

只实现那七个接口（见 [02-architecture](02-architecture.md)）。任何"顺便在这里算一下"的念头都要掐掉。

### 规矩三：难的东西让本地 Node 干，但只在宿主侧

这是 RN 方案里最省力的一招：手机上本来就跑着一个完整的 Node，它就是"原生逃生舱"。

| 难活 | 谁干 |
|---|---|
| SSH | `ssh2`（npm） |
| Noise 握手、密钥交换 | Node 里做，RN 只拿结果 |
| PDF 转换、docx 解析、OCR 后处理 | Node + rootfs 里的 Python |
| 文件监控、批量重命名 | Node 的 `fs` |

**RN 侧一行加密、一行 SSH 都不用写。**

⚠️ 但这条**只在宿主侧成立**。iOS 上没有 Node，所以 iOS 遥控器必须纯 JS（`@noble/curves` + `@noble/ciphers` 够用），且可以先只支持 DSH Remote、不做 SSH。

## 为什么不是别的

| 方案 | 否掉的原因 |
|---|---|
| **Expo 托管 / Expo Go** | 原生模块一个都跑不了。这个项目一半以上的工作量本来就在原生层 |
| **Kotlin + Compose** | 无法覆盖 iOS（用户明确除外的约束） |
| **Flutter** | 要学 Dart；且会走上 dsh-go 完全相同的路径，包括它的坑 |
| **纯 WebView 壳** | 失去原生插件面板、无障碍差、性能差。只适合做"网页版逃生舱" |

> **现状（2026-11-02）**：实际依赖只有 `expo` 58 / `react-native` 0.88 / `react` 19 /
> `react-native-web` / `expo-secure-store` / `expo-image-picker`（+ 构建期 `@babel/core`、`babel-preset-expo`）。
> 路由是 `App.tsx` 里一个 `view` 状态切换；状态管理是手写的 `app/src/state/store.ts`（version 计数触发重渲染）；
> 没有 Zustand / TanStack Query / SQLite / FlashList / xterm。下表是当初的**选型意向**，落地时按需再加。

## 依赖选型

| 层 | 选择 | 备注 |
|---|---|---|
| 框架 | Expo SDK（prebuild / CNG） + TypeScript | `android/` 当生成物，自定义代码放 `modules/` |
| 路由 | Expo Router | 文件路由，够用 |
| 服务端状态 | TanStack Query | 会话列表、历史分页天然适配 |
| 本地状态 | Zustand | 别上 Redux |
| 传输 | 原生 WebSocket + fetch，类型从 OpenAPI 生成 | 不手写 interface |
| 本地库 | expo-sqlite（FTS5） | 会话索引 + 搜索；中文分词要自己处理 |
| 密钥 | expo-secure-store（Keystore / Keychain） | 别自己存 |
| 通知 | expo-notifications（本地）+ 自写 Kotlin 模块（前台服务、ProgressStyle） | Android 16 胶囊必须原生 |
| 聊天渲染 | FlashList + 自研流式 Markdown | 见下方"已知坑" |
| 终端 | **xterm.js 跑在 WebView 里** + 原生 PTY | 比原生终端省 80% 工作量 |
| 原生模块 | Expo Modules API（Kotlin / Swift） | 比 RN 老式 module 好写 |
| 崩溃监控 | Sentry | 加一个自建诊断包 |
| CI | EAS Build（iOS）+ GitHub Actions 自建 runner（Android） | Android 自建更快更便宜 |

## 仓库结构

```
dsh-palm/
├── app/                     # RN + Expo 应用
│   ├── App.tsx              # 入口：启动宿主、深链、自动连接、页面切换
│   ├── src/
│   │   ├── lib/             # 引擎客户端、host/notify/share 的原生封装
│   │   ├── protocol/        # 协议契约（客户端与桥的唯一约定）
│   │   ├── state/store.ts   # 手写 store（事件落地、请求关联）
│   │   └── ui/              # 首页/聊天/抽屉/设置/输入区…
│   └── android/             # Expo prebuild 产物 + 原生宿主（host/*.kt）
├── engine/                  # mock 引擎 + 真 dsh 桥（engine/src/real/）
├── test/                    # e2e / 审批卡 / 单元测试
├── scripts/                 # 探针、建桥、安卓构建准备
├── runtime/                 # rootfs 分层与 profile
└── docs/
```

`packages/mock-engine/` 是阶段 0 的关键：**在笔记本上跑一个假引擎，让 UI 先做完，一行 Kotlin 都不写。**

## 已知坑（现在就定对策）

### 流式长文本 + 长列表

JS 线程一卡，用户看到"卡住了"，但 agent 其实在跑——在这种产品里是致命误判。

1. **增量修复放到引擎侧做**，RN 只收"已经修好的块"，不做字符串拼接
2. FlashList + **限制同时渲染的回合数**（只渲染最近 N 轮，往上翻再加载）
3. **引擎状态与 UI 状态分离**：进度、审批、运行中走独立事件通道，不跟消息流挤在一个 `setState` 里

### Expo prebuild 的维护

- `android/` / `ios/` 当**生成物**，不进版本控制（或进但只读）
- 每次加原生依赖都要重新 prebuild，所以**自定义代码只放 `modules/`**，永远不手改根目录
- 升级 Expo SDK 前先跑一遍 prebuild，看 config plugin 有没有断

### OTA 的边界

EAS Update 只能更新 JS。**80% 的改动会落在原生和引擎侧，那些必须发版。** 为 OTA 选 Expo 是赚的，但别指望它解决所有问题。
