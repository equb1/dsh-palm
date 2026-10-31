# dsh-palm · 锦囊

> 装进口袋的智能体。有事，交给锦囊。

一个跑在手机上的 DSH 宿主。手机不是遥控器，是一台独立的、能自己干活的机器；电脑是可以互相叫得动的兄弟，不是它的上游。

---

## 三句话

1. **手机是完整宿主。** 引擎、工作区、会话、能力全部在本地，除调模型必须联网，其余离线可用。
2. **能力是契约，不是提示词。** 一个预设 = 一份工具表 + 一套权限 + 一个模型策略。模型看不见没给它的工具。
3. **跨设备只同步"身份与记忆"，不同步"文件与执行"。** 要文件就引用，要算力就委派。

## 现在长这样

<p>
<img src="docs/assets/screenshot-home.png" width="240" alt="首页" />
<img src="docs/assets/screenshot-drawer.png" width="240" alt="会话抽屉" />
<img src="docs/assets/screenshot-approval.png" width="240" alt="审批卡" />
</p>

左：首页就一个输入框 · 中：会话都在抽屉里 · 右：审批卡只看一屏就能决定

## 它不是什么

| 不是 | 为什么 |
|---|---|
| 遥控器 | 遥控器是电脑的从属端，电脑一关机就变砖。本项目的红线是「任何跨设备能力都必须有本地路径」 |
| 纯通知软件 | 通知是壳的一个子系统，不是产品。收到"跑完了"之后必须能就地决策，否则价值只兑现 10% |
| 通用聊天 App | 聊天是电脑擅长的事。手机端优化的是「从收到通知到做完决策隔几次点击」 |
| iOS 本机引擎 | iOS 没有 `fork`/`exec`，这条路物理上不存在 |
| 工作区同步盘 | 所有多端 agent 的坟场。用引用 + 委派替代复制 |

## 文档地图

| 文档 | 内容 | 什么时候看 |
|---|---|---|
| [docs/00-decisions.md](docs/00-decisions.md) | 决策台账：定了什么、为什么、否掉了什么 | 每次想改主意前 |
| [docs/01-product.md](docs/01-product.md) | 定位、场景判断、非目标、命名与词汇 | 对齐"我们到底做什么" |
| [docs/02-architecture.md](docs/02-architecture.md) | 分层、协议边界、单 writer、跨设备与降级 | 动代码结构前 |
| [docs/03-workspaces-presets.md](docs/03-workspaces-presets.md) | 工作区即能力契约、预设三级、会话级裁剪 | 做预设和插件系统时 |
| [docs/04-tech-stack.md](docs/04-tech-stack.md) | RN + Expo prebuild、三条硬规矩、依赖选型 | 开始写第一行代码前 |
| [docs/05-runtime.md](docs/05-runtime.md) | 引擎生命周期、rootfs 分层、尺寸预算 | 做运行时和打包时 |
| [docs/06-roadmap.md](docs/06-roadmap.md) | 四阶段路线、v1 范围、验收标准 | 每周对齐进度 |
| [docs/07-open-questions.md](docs/07-open-questions.md) | 尚未决定的事项 | 卡住的时候 |
| [docs/08-verification.md](docs/08-verification.md) | 一周真机验证清单（Node/体积/内存/后台） | **动手接真机引擎之前** |
| [docs/09-ui.md](docs/09-ui.md) | 界面语言：颜色、形状、排版、固定结构 | 改动任何界面前 |
| [docs/10-dsh-api.md](docs/10-dsh-api.md) | **真 dsh 引擎的接口实测**（RPC / mux 流 / 快照） | 写适配器前 |

## 跑起来

需要 **Node 22.13+**（React Native 0.88 的要求）。当前是**阶段 0**：引擎是 mock 的，UI 是真的。

> 国内网络建议先 
pm config set registry https://registry.npmmirror.com，否则装依赖会很慢。

```bash
npm install        # 根目录依赖（引擎 + 测试）
npm run engine     # 起 mock 引擎
```

终端会打印：

```
WS     ws://localhost:8787/ws
LAN    ws://192.168.x.x:8787/ws   <- 手机里填这个
```

另开一个终端起 App：

```bash
cd app
npm install
npx expo start     # 手机装 Expo Go 扫码，或按 w 在浏览器里开
```

App 里把上面那串 LAN 地址填进去，点「连接」。

### 验证协议层（不需要手机）

```bash
npm test           # 7 条端到端用例：握手 / 流式 / 审批 / 拒绝 / 预设切换 / 错误路径
npm run typecheck
```

## 连真引擎（只读）

Mock 引擎之后，有一个能连**真 dsh** 的桥：`engine/src/real/`。

```bash
# 真 dsh 启动后会打印 http://127.0.0.1:8899/?token=xxx
node --import tsx engine/src/real/main.ts http://127.0.0.1:8899 <token> 8788
```

App 里把引擎地址填成 `ws://<电脑IP>:8788/ws`，就能看到真宿主上的会话、预设（standard / ptc / minimal / cordis）和宿主版本。

发送、流式、审批还没通——卡在"隔离实例没有模型凭据，抓不到真实帧"，原因写在 [docs/10-dsh-api.md](docs/10-dsh-api.md) 第六节。

## 现在已经有的

| 模块 | 位置 | 状态 |
|---|---|---|
| 协议契约 | `app/src/protocol/` | 消息信封、能力协商、事件表、预设与能力契约 |
| 引擎客户端 | `app/src/lib/client.ts` | 请求关联、事件订阅、超时、指数退避重连 |
| Mock 引擎 | `engine/` | 能力协商、流式块、工具调用、审批、预设切换 |
| 端到端测试 | `test/e2e.test.ts` | 7/7 通过 |
| App 界面 | `app/src/ui/` | 连接页、会话列表、聊天流式、审批卡、会话内换预设 |

## 现在还没有的

- 真 dsh 引擎接入（mock 的协议是按 dsh 的形状设计的，但没对接过）
- 本机 rootfs / Node 运行时（阶段 1，见 [08-verification](docs/08-verification.md)）
- 拍照 / OCR / 分享菜单（阶段 1）
- iOS 遥控器（阶段 2）
- 推送、插件市场、桌宠、皮肤

## 当前状态

**阶段 0 完成，阶段 1 待开工。**

- [x] 产品定位与场景取舍
- [x] 命名
- [x] 架构分层与技术栈
- [x] 运行时与打包策略
- [x] 路线与验收标准
- [x] 阶段 0：协议契约 + mock 引擎 + UI 骨架
- [ ] 阶段 1：Android 宿主（先做 [08-verification](docs/08-verification.md) 的真机验证）

## 一句话记住我们和别人的区别

别人做的是「在手机上也能用你的 agent」，我们做的是「**手机上有一个属于你的 agent，它还有一台电脑可以叫**」。

---

## 许可

[AGPL-3.0](LICENSE)。

社区项目，与 DeepSeek 官方无关。基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建，"DeepSeek" 名称与标识归其所有者所有。
