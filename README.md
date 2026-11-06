# 锦囊 · dsh-palm

把 DeepSeek Harness 装进口袋：**手机是完整宿主**，默认跑轻量 TS 引擎（秒开），
需要真 Linux 时按需拉起 proot 里的完整引擎；电脑是可选的另一台宿主。

## 现在能做什么

- 手机本机跑 dsh：对话、流式、思考、工具、审批、提问、模型/权限切换；
- 官方账号 OAuth 登录；模型提供商（43 个目录 + 自定义渠道）；
- 轻引擎：10 个工具、docx/xlsx、生图、`dshpalm://light` 深链；
  账号模式自动拉模型目录（`deepseek-chat` / `DeepSeek-V4.1-Flash` / `DeepSeek-V4-Pro`）；
- 会话抽屉统一展示轻/完整两个引擎的会话（跨引擎行先切引擎再打开，M2.6 第一步）；
- 工作区/设备密钥/`~/.dsh` 都在 rootfs 外，换镜像不丢；
- 通知（完成/审批/提问）、冷启动分享、会话改名/置顶/归档、日志导出；
- Android APK 自带运行时，不需要电脑。

## 架构

```
RN App（UI，只认协议）
 ├─ EngineClient（WS）── 单文件桥 :8788 ── proot 里的 dsh web :8787
 ├─ LocalEngineClient（进程内）── LightHost（TS 引擎）
 ├─ 原生宿主：HostService（前台服务）→ proot / Node / 桥
 └─ 原生能力：分享/通知/相机/OCR/ASR/SecureStore（轻引擎侧）
```

- 两种引擎同一套会话/审批/工具协议；工作区共用 `<filesDir>/workspace`。
- proot 冷启动约 14s、常驻约 320MB；轻引擎目标 <300ms、冷启动到可输入 <1s。
- 路由：默认轻引擎；跑代码/后台任务/pptx/编辑 Office 时切 proot。详见技术文档。

## 快速开始

需要 **Node 22.13+**；打安卓包还需要 JDK 21 与 Android SDK。

```bash
npm install
npm --prefix app install
npm run verify        # typecheck + 全部测试（数量以输出为准）
```

### A. 只看界面（mock 引擎，不需要手机）

```bash
npm run engine            # HTTP http://localhost:8787/health
                          # WS   ws://localhost:8787/ws
npm --prefix app run web  # 浏览器打开 http://localhost:8081
```

手机预览：`npm --prefix app start`，用 Expo Go 扫码，引擎地址填 `npm run engine`
打印的 LAN 地址（同一 Wi-Fi）。

### B. 连电脑上的真 dsh

```bash
npm i -g @deepseek-ai/dsh
dsh web --host 127.0.0.1 --port 8899 --no-open     # 打印带 token 的 URL

# 另开终端，仓库根目录：
node --import tsx engine/src/real/main.ts http://127.0.0.1:8899 <token> 8788
```

桥会打印 `ws://localhost:8788/ws` 和六位配对码；App / Expo web 连
`ws://<电脑IP>:8788/ws` + 配对码，就能用电脑上的真 dsh。

### C. 打 Android APK（手机自带运行时）

```bash
bash scripts/setup-android.sh      # keystore + proot + rootfs/payload（校验 sha256）
cd app/android && sh gradlew :app:assembleDebug
```

`gradlew` 没有可执行位，用 `sh gradlew`。镜像/`.so` 都不进 git。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | **需求**：定位、v1 目标/非目标、能力矩阵、插件分层、里程碑、验收 |
| [docs/TECHNICAL.md](docs/TECHNICAL.md) | **技术**：架构、协议、dsh API、proot/轻引擎、路由、登录配对、UI、构建 |
| [docs/PITFALLS.md](docs/PITFALLS.md) | **踩坑**：现象 → 原因 → 处理 → 验证 |
| [docs/AI-TASKS.md](docs/AI-TASKS.md) | **给 AI 的清单**：任务、工程债、待决、分支/提交规则、命令 |
| [docs/STREAMING-FIX.md](docs/STREAMING-FIX.md) | **专项方案**：长会话流式的根因、改动、验证与剩余项 |

旧文档在 [docs/archive/](docs/archive/)（只读，2026-11-03 归档）。

## 目录

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
docs/                   四篇主文档 + 专项方案 + archive/
```

## 约定

- **分支**：从 `develop` 切，一个方面的任务一个分支，走 MR 合并；不直推 `develop`。
  具体见 [docs/AI-TASKS.md](docs/AI-TASKS.md) §5。
- **文档**：任务状态只改 AI-TASKS；技术只改 TECHNICAL；新坑进 PITFALLS；
  需求只改 REQUIREMENTS；长流专项记录进 STREAMING-FIX。不要写死测试条数。
- 依赖统一用 **npm**，不要混 pnpm（会破坏 autolinking）。

## License

AGPL-3.0，见 [LICENSE](LICENSE)。
