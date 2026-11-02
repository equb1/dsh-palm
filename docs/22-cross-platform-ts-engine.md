# 22 · 双端统一内嵌引擎调研（纯 TS 核心 + 虚拟 Shell / WASI 沙箱）

> 状态：**架构预研方案（2026-11-02）**。不改动现有阶段 1 代码，为下一代「0.1 秒秒开 + iOS/Android 双端完整独立宿主」提供技术选型与检索地图。

## 一、背景：为什么要重新审视本机引擎？

阶段 1 我们通过 `proot + Ubuntu 24.04 rootfs + Node 22 + @deepseek-ai/dsh + dsh-palm-bridge` 在 Android 真机上跑通了完整闭环（见 [17-handoff.md](17-handoff.md)）。但真机实测暴露出两个由底层路线决定的天花板：

1. **冷启动物理下限高（9 ～ 14 秒）**
   - `@deepseek-ai/dsh` 是面向桌面端设计的 Cordis 插件系统，启动时 Node 模块加载器需对 `/opt/dsh/node_modules` 下数百个包发起上万次 `stat` / `openat` / `readlink` 系统调用。
   - 在 Android 非 Root 环境下，`proot` 通过 `ptrace` 拦截每一次系统调用（每次拦截伴随两次上下文切换），导致仅 `import` 完引擎模块就要消耗 **~9 秒**（对比：打成单文件的 `dsh-palm-bridge.cjs` 在 `proot` 下仅需 **0.18 秒**）。
   - 同时还要背负 **~150 MB** 压缩镜像体积、**200 MB+** 额外常驻内存，以及 Android SELinux `link()` 限制、孤儿进程清理、各厂商后台强杀等维护成本。

2. **iOS 端本机完全不可用（[00-decisions.md](00-decisions.md) 中 `D17` 的历史妥协）**
   - **内核限制**：iOS XNU 沙箱严禁第三方 App 调用 `fork()` / `execve()` / `posix_spawn()` 拉起子进程，`proot`、`bash`、独立 `node` 二进制在非越狱 iOS 上物理不可行。
   - **无主进程 JIT**：iOS 强制执行 `W^X`（写与执行互斥），App 主进程无法动态分配可执行内存页，常规 V8 JIT 无法运行。
   - **App Store 审核条款 2.5.2**：禁止下载并执行原生机器码；**但苹果明确允许「内置自包含解释器或 WebAssembly 沙箱，用于处理用户本地文档与脚本」**（App Store 长期在架的 `a-Shell`、`Pythonista`、`Carnets` 均基于此合规路径）。

3. **上游 `dsh` 反而在卡「锦囊」的核心设计**
   - 如 [03-workspaces-presets.md](03-workspaces-presets.md) 与 [20-open-work.md](20-open-work.md) 记录：真 `dsh` 至今没有开放「会话删除」「正文全文检索」，也不支持「单会话级工具白名单（能力契约 `D09`/`D10`）」。

---

## 二、五种候选方案全景对比

得益于 `D26` 的分层边界——**前端 UI 完全不感知 `dsh`，只认项目自有的 [`app/src/protocol/index.ts`](../app/src/protocol/index.ts) 协议**——我们可以在不动 UI 的前提下替换本机引擎实现，同时保留 `dsh-palm-bridge` 用于连接桌面端真 `dsh`。

| 维度 | 现状：`proot` + Ubuntu + 真 `dsh` | 方案 A：`nodejs-mobile` 静态嵌入真 `dsh` | **方案 B（推荐）：纯 TS 内嵌引擎 + 虚拟 Shell / Wasm 沙箱** | 方案 C：Rust 原生核心（`UniFFI/JSI`）+ WASI | 方案 D：端云混合（本地轻量大脑 + 云端微沙箱 E2B） |
|---|---|---|---|---|---|
| **冷启动耗时** | 9 ～ 14 s | 1.5 ～ 2.5 s | **< 0.1 s（字节码直映，真秒开）** | **< 0.03 s** | **< 0.1 s**（云端命令 ~0.2 s） |
| **安装包增量** | +150 MB | +45 MB | **+2 ～ 5 MB**（重型库按需下发） | +6 ～ 10 MB | +1 MB |
| **常驻内存增量** | +200 ～ 300 MB | +100 ～ 150 MB | **+15 ～ 30 MB** | **+10 MB** | +15 MB |
| **Android 独立宿主** | ✅ | ✅ | **✅ 100%** | ✅ 100% | ✅ 100% |
| **iOS 独立宿主 & 上架** | ❌ 不可用 | ⚠️ 半残（`--jitless` 可跑 JS，但 `child_process` 全崩） | **✅ 100% 可用且符合 2.5.2 上架规范** | **✅ 100% 可用且合规** | ✅ 100% |
| **离线可用性** | ✅（除调模型） | ✅ | **✅** | ✅ | ⚠️ 重度命令依赖联网 |
| **会话级能力契约** | ❌ 上游未支持 | ❌ 上游未支持 | **✅ 原生支持** | ✅ 原生支持 | ✅ 原生支持 |
| **研发与维护成本** | 高（系统兼容泥潭） | 中高（需魔改上游去子进程） | **低～中（全栈 TS，单人可控）** | 高（双语言栈维护） | 低（但引入云端成本） |

> **为什么淘汰方案 A（`nodejs-mobile`）？**
> `nodejs-mobile` 虽然能用 V8 `--jitless` 模式在 iOS 跑起 JS，但 `@deepseek-ai/dsh` 内部大量工具（如 `tool-bash`）强依赖 `child_process.spawn`。在 iOS 上一调工具依然报 `EPERM`，最终还是得重写整套工具层，白白多背 45 MB 包体积和双 JS 引擎内存开销。

---

## 三、推荐架构拆解：纯 TS 内嵌引擎 + 虚拟 Shell / WebAssembly 沙箱

React Native 在 Android 与 iOS 上均内置了 **Hermes 引擎**。发版构建时，TypeScript 代码会被提前编译（AOT）为 `.hbc` 字节码文件，App 启动时通过 `mmap` 直接映射进内存执行——**不需要 JIT、不拉起外部进程、启动耗时在 50ms 以内**。

整套架构自上而下分为四层：

```
┌───────────────────────────────────────────────────────────────────┐
│  UI 层（React Native：HomeScreen / ChatScreen / SettingsScreen）  │
├───────────────────────────────────────────────────────────────────┤
│  统一协议客户端 EngineClient                                      │
│   ├─ 本机模式：InMemoryTransport（进程内直连，0 端口、0 毫秒延迟） │
│   └─ 远程模式：WebSocketTransport（连电脑 dsh-palm-bridge）       │
├───────────────────────────────────────────────────────────────────┤
│  本机纯 TS 引擎 PalmCore（跑在 Hermes，约 2500～3000 行 TS）       │
│   ├─ LLM 适配：DeepSeek 账号 OAuth + OpenAI / Anthropic 兼容 SSE  │
│   ├─ Agent 循环：多步工具流式调度、审批拦截、提问挂起、上下文压缩 │
│   ├─ 能力契约：按会话 Preset 动态裁剪暴露给模型的 Tool Schema     │
│   └─ 存储引擎：SQLite（会话持久化、秒级删除、FTS5 全文检索）      │
├───────────────────────────────────────────────────────────────────┤
│  双端无子进程工具与沙箱层（Android & iOS 100% 同构）               │
│   ├─ 文件/网络：原生 FS 读写改 + ripgrep 搜索 + Web Search/Fetch  │
│   ├─ 办公文档：纯 TS 读写 xlsx / docx / pdf + 端侧离线 OCR         │
│   ├─ 虚拟 Shell：just-bash（纯 TS 实现 Bash AST + 管道 + 常用命令）│
│   └─ 算力沙箱：隐藏 WebView 独立进程跑 WebAssembly（Pyodide/WASI）│
└───────────────────────────────────────────────────────────────────┘
```

### 1. 核心大脑层（可直接检索调研的开源方案）

你可以重点搜索以下两个现成的纯 TS Agent 核心库作为参考或底座：

- **`@mariozechner/pi-ai` 与 `@mariozechner/pi-coding-agent`（仓库：`badlogic/pi-mono`）**
  - **值得看的原因**：`@deepseek-ai/dsh` 自身的模型渠道层（`llm-pi-ai`）底层用的就是 `pi-ai`！`pi-mono` 是极简纯 TypeScript 编写的跨提供商 LLM 统一接口与 Coding Agent 循环参考实现，代码极其干净，几乎没有 Node 专属耦合。
- **`Vercel AI SDK`（npm 包：`ai`，文档：`sdk.vercel.ai`）**
  - **值得看的原因**：工业级纯 TS 流式状态机（`streamText` + `stopWhen` 多步工具循环），全部基于标准 Web `fetch` / `ReadableStream` 构建，支持 React Native / Expo 环境。

### 2. 虚拟 Shell 沙箱（解决 iOS/Android 无 `bash` 子进程问题）

大模型经过海量训练，非常习惯用 `ls`、`grep`、`sed`、`awk`、`jq`、`find`、`sort`、`head`、`tail` 和管道 `|` 探索文本与处理数据。在没有 `fork()` 的手机端，最佳替代品是：

- **`just-bash`（仓库：`vercel-labs/just-bash`，官网：`justbash.dev`）**
  - **原理**：Vercel 实验室专门为 AI Agent 打造的**纯 TypeScript 模拟 Bash 环境**。内置完整的 Bash 语法解析器（支持管道 `|`、重定向 `>` / `>>`、环境变量、循环与条件分支）、虚拟文件系统（可挂载并桥接到手机沙箱的工作区目录）以及数十个标准 Unix 工具（`grep`、`sed`、`awk`、`jq`、`find`、`tar`、`curl` 等）。
  - **优势**：零原生依赖、毫秒级执行、iOS 与 Android 表现 100% 一致，且天然具备目录边界隔离，AI 绝对无法越权碰触宿主系统文件。
- **`BusyBox-WASI` / `uutils coreutils`（WebAssembly 路线）**
  - 将标准 Unix 工具集编译为 `.wasm` 模块，通过轻量 WASI 运行时加载，作为纯 TS 命令行的补充。

### 3. 代码执行与 Python 沙箱（合法利用 iOS 独立进程 WebAssembly JIT）

处理复杂表格统计、科学计算或生成图表时，Agent 往往需要运行脚本（JS 或 Python）：

- **轻量级脚本沙箱：`QuickJS`（`quickjs-emscripten` / `react-native-quickjs`）**
  - Fabrice Bellard 编写的超轻量 C 语言 JS 引擎（仅 ~600 KB，无 JIT，完全符合 iOS 审核），支持设置**最大内存上限**和**CPU 指令步数中断**，几毫秒内安全执行 AI 生成的数据转换脚本。
- **完整 Python 沙箱：`Pyodide`（官网：`pyodide.org`，跑在隐藏的 `WKWebView` / Android `WebView` Worker 中）**
  - **关键合规与性能技巧**：虽然 iOS 禁止 App 主进程使用 JIT，但 **iOS 系统自带的 `WKWebView` 运行在苹果系统签名的独立 `WebContent` 进程中，合法拥有完整的硬件级 WebAssembly JIT 加速**（这也是众多 iOS 离线编程工具过审的通用做法）。
  - 在后台挂载一个 `0×0` 隐藏 `WebView` 作为算力协处理器按需唤醒，即可运行 `Pyodide`（完整 CPython 3.12 + `numpy` + `pandas` + `matplotlib` + `python-docx` + `openpyxl`）：
    1. **真正的多进程隔离**：契合 [05-runtime.md](05-runtime.md)「重活必须离开主进程」的原则——Python 即使跑满 CPU 或死循环，UI 主线程依然 60fps 丝滑，超时直接销毁重建 WebView 即可；
    2. **按需扩展包**：核心 App 只有 20～30 MB，用户启用「数据分析 / Python 锦囊」时再下载缓存 Pyodide 运行层到本地。
- **纯 JS Git 客户端：`isomorphic-git`（官网：`isomorphic-git.org`）**
  - 无需原生 `git` 二进制，纯 JS 在 iOS/Android 本地完成仓库 `clone`、`status`、`diff`、`commit`、`push`。

### 4. 存储与办公文档工具链（纯 TS + 原生硬件能力）

彻底告别为了转换一个文档去拉起 `pandoc` 子进程：

| 能力领域 | 推荐库 / 原生接口 | 双端表现与优势 |
|---|---|---|
| **会话与检索存储** | `expo-sqlite` 或 `@op-engineering/op-sqlite` | 开启 SQLite `FTS5` 全文索引，毫秒级搜遍历史对话正文、支持单条会话秒删与文件夹归档 |
| **Excel / CSV 表格** | `xlsx`（SheetJS） / `exceljs` | 纯 TS 解析与生成多 Sheet、公式、样式表格，耗时 < 20ms |
| **Word 文档（`.docx`）** | `mammoth`（读取提取） + `docx`（排版生成） | 纯 TS 读写 Word 文档，无需 Python / LibreOffice / Pandoc |
| **PDF 解析与批注** | `pdf-lib` + `pdfjs-dist` + 系统 `PDFKit` / `PdfRenderer` | 本地提取文本、拆分合并页面、渲染缩略图 |
| **离线拍照 OCR** | iOS `Vision` 框架 / Android `ML Kit Text Recognition` | 零流量、端侧 NPU 硬件加速，发票/板书/说明书秒级提取文字 |

---

## 四、对现有架构决策（`00-decisions.md`）的影响评估

如果采纳本方案，原决策台账中绝大多数原则不仅得以保留，反而能真正落地：

- **真正兑现的决策**：
  - `D01`（手机是完整宿主，不是遥控器）—— **首次在 iOS 和 Android 双端同时兑现**；
  - `D09` / `D10`（会话级能力契约，在工具注册层裁剪）—— 摆脱上游限制，**原生直接生效**；
  - `D11` / `D12`（聚焦 L1 声明式锦囊与 L2 技能包）—— 纯配置 + 工具表裁剪天然契合内嵌引擎。
- **被升级替换的阶段性妥协**：
  - 废止 `D17`（*“iOS 只做遥控器”*）→ 升级为 **iOS 与 Android 对等独立宿主**；
  - 升级 `D24` / `D27`（*“精简 rootfs + 忍受 13s 冷启动靠常驻掩盖”*）→ 升级为 **< 0.1s 字节码直启，无需后台高耗电常驻保活**（空闲即休眠，打开即就绪，只有正在跑任务时才申请后台短时保活 / Live Activity）。
- **唯一的边界与兜底**：
  - 手机本机不再直接运行桌面端 `dsh` 的 L3 任意 npm 插件或 `apt install` 原生 Linux 编译链（如本地跑 `gcc` / `docker` / `ffmpeg` 重编码）；
  - 这类重度桌面开发需求，通过已有的 **WebSocket 远程连接电脑 `dsh-palm-bridge`**（或可选挂载 E2B / Daytona 云端微沙箱）无缝承接，完全符合「手机独立干活，重活随时叫电脑兄弟」的产品定位。

---

## 五、平滑演进路径（不推倒重来，分三步走）

因为前端 UI 与引擎之间隔着清晰的 [`EngineClient`](../app/src/lib/client.ts) 与协议层，迁移可以按增量分支推进，随时可回退：

1. **阶段 A：增加进程内传输层（`InMemoryTransport`）**
   - 让 `EngineClient` 支持不经过 WebSocket 端口、直接与内存中的引擎实例收发协议消息；保留 `ws://` 给远程连接电脑宿主使用。
2. **阶段 B：实现 `PalmCore` 纯 TS 最小完备核心（跑通双端秒开）**
   - 基于现有 [`engine/src/server.ts`](../engine/src/server.ts) 骨架，接入真实 LLM 流式驱动（DeepSeek 账号与自定义渠道）、SQLite 会话持久化、审批/提问挂起状态机，以及基础文件读写与联网工具。
   - **里程碑**：此时 Android 与 iOS 即可同时达成 **< 0.1 秒冷启动** 与日常对话/文件/联网能力。
3. **阶段 C：接入 `just-bash` 虚拟 Shell、纯 TS 办公套件与隐藏 WebView Python 沙箱**
   - 补齐内置五大锦囊（文档助手、票据管家、读图问答、生图、会议纪要）所需的全部本地工具链；
   - 验证稳定后，将 Android 端的 `proot + rootfs.bin` 从主包剥离（移除 150MB 载荷），完成轻量化收敛。

---

## 六、检索关键词速查表（供进一步调研使用）

- **纯 TS 跨模型与 Agent 底座**：`@mariozechner/pi-ai`、`badlogic/pi-mono`、`Vercel AI SDK streamText`
- **纯 TS 虚拟 Bash 环境**：`vercel-labs/just-bash`、`justbash.dev`
- **移动端无 JIT 安全脚本引擎**：`quickjs-emscripten`、`react-native-quickjs`
- **WebAssembly Python 沙箱**：`pyodide`、`WKWebView WebAssembly Pyodide iOS`
- **iOS 终端合规先例参考**：`holzschuch/a-shell`（参考其如何用 WASI 在 App Store 合规提供命令行工具）
- **RN 高性能 SQLite（含 FTS5）**：`expo-sqlite`、`op-engineering/op-sqlite`
- **纯 JS Git 与文档处理**：`isomorphic-git`、`SheetJS`、`exceljs`、`mammoth.js`、`docx`、`pdf-lib`

