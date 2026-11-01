# 手机自连（App 连本机引擎）

目标：把电脑从链路里摘掉。

```
手机                          ┌──────────────────────────────┐
┌───────────┐   ws 127.0.0.1   │ Termux / proot Ubuntu        │
│  App      │ ───────────────▶ │  dsh web  :8787（引擎）      │
│           │                  │  bridge   :8788（协议桥）    │
└───────────┘                  └──────────────────────────────┘
```

## 为什么桥要单独跑

引擎说的是 dsh 自己的协议（HTTP RPC + `/api/remote.mux` 多路流 + `$events` 远程事件）。
App 说的是我们的协议（`sessions.*` / `approvals.*` / `questions.answer`）。
桥就是这两套协议之间的翻译层，现在它是**单文件 JS**，不需要 tsx、不需要 node_modules。

## 打包

```bash
node scripts/build-bridge.mjs
# -> dist/dsh-palm-bridge.cjs   约 66 KB
```

- 输出是 **CJS**：`ws` 这类依赖里有 `require('events')`，打成 ESM 会报
  `Dynamic require of "events" is not supported`
- 目标 `node20`，Node 22 也能跑

## 手机上跑

### 1. 把文件弄进手机

任选一种：

- **USB 拷贝**：把 `dist/dsh-palm-bridge.cjs` 放进手机存储，Termux 里
  `cp /sdcard/Download/dsh-palm-bridge.cjs ~/`
- **局域网下载**（电脑手机同一 Wi-Fi）：
  电脑上 `python -m http.server 8899 --directory dist`，
  手机上 `curl -O http://<电脑IP>:8899/dsh-palm-bridge.cjs`

### 2. 起引擎

```bash
dsh web --host 127.0.0.1 --port 8787 --no-open
# 记下打印出来的 token
```

### 3. 起桥

```bash
node dsh-palm-bridge.cjs http://127.0.0.1:8787 <token> 8788
```

看到这些就对了：

```
  已连上真 dsh：N 个会话，M 个宿主预设
  dsh-palm 真引擎桥
  WS     ws://localhost:8788/ws
```

### 4. App 里连

地址填 `ws://127.0.0.1:8788/ws`。

> 现在桥默认**没有鉴权**（`DSH_PALM_NO_PAIR=1`）。只在本机回环上用是安全的，
> 一旦桥监听 0.0.0.0 给局域网用，就必须先做配对（见 docs/11-pairing.md 的待办）。

## 验证

```bash
# 桥活着
curl http://127.0.0.1:8788/health
# {"ok":true,"bridge":"real","host":"host-real-dsh"}
```

App 里应该能看到会话列表、能发消息、能收流式、审批和提问会弹卡片。

## 已知代价

| 项 | 数值 | 说明 |
|---|---|---|
| 引擎冷启动 | 13.7s（proot） | 只在开机后第一次 |
| 桥启动 | <1s | 单文件，无依赖解析 |
| 常驻内存 | 引擎 178MB + 桥 ~40MB | 桥比引擎轻 |
| 额外延迟 | 本机回环，可忽略 | 比现在"手机→电脑"低一个数量级 |

## 还没做

- 原生层把这两个进程管起来（现在要手动在 Termux 里起）
- 桥的配对鉴权
- 引擎崩溃后的自动重启
