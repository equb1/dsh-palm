# 13 · 本机引擎（阶段 1 的落地清单）

> 状态：**已实现（2026-11-02，真机 PLR110 跑通）。** 本文保留为当时的落地清单，
> 现状与踩坑以 [17-handoff.md](17-handoff.md) 为准；下面「为什么我做不了」是历史记录。
>
> 这一节把"要做什么"写到可以直接开工的程度，避免下次从零讨论。

## 为什么我做不了

| 需要什么 | 这台机器有吗 |
|---|---|
| Android SDK / NDK | ❌ |
| 一台 Android 设备（真机） | ❌ |
| Linux x86_64（构建 rootfs） | ❌ 这是 Windows |
| 能跑 arm64 二进制的环境 | ❌ |

`docs/08-verification.md` 里那张"一周验证清单"，**必须在一台真实的 Android 手机上做**。我在这里写的任何"应该能跑"都是猜测——而这个项目已经因为猜测翻过一次车（#107 的鸿蒙结论）。

## 先做哪一步

不要先写 App。先做一周的 spike，只回答四个数字：

| # | 量什么 | 过关线 |
|---|---|---|
| 1 | Node 能在 PRoot 里打印版本 | 必须 |
| 2 | node + proot + 最小 rootfs 解包体积 | ≤150MB |
| 3 | 空闲 / 峰值内存 | ≤250MB / ≤450MB |
| 4 | 冷启动到端口可访问 | ≤5s |

四个都过 → 按下面的清单做。任何一个不过 → 改形态（见 08 末尾的表）。

## 七个接口（Kotlin 侧）

`app/modules/host-runtime/android/` 下，全部实现这一个接口：

```kotlin
interface HostRuntime {
  fun install(): Flow<InstallProgress>        // 解包 rootfs 层，返回进度
  fun start(): Flow<EngineStatus>             // 起进程 + 前台服务，返回状态流
  fun stop()
  fun status(): EngineStatus                  // starting / ready / failed(reason)
  fun logs(): Flow<String>                    // 引擎 stdout/stderr
  fun notify(payload: NotifyPayload)          // 通知 / 进度胶囊
  fun fs(action: FsAction): FsResult          // 分享菜单进来、SAF 授权
}
```

**加起来不超过 1500 行。** 超过就说明业务逻辑漏进原生了。

## 进程与目录

```
<app-data>/
├── runtime/
│   ├── base-v1/            rootfs 基础层（只读约定）
│   ├── current -> base-v1  # 版本切换用软链
│   └── staging/           下载/解包中
└── data/                   # 可写状态，永远在层之外
    ├── home/               $DSH_HOME
    ├── workspaces/
    └── logs/
```

引擎启动：

```
proot -r <runtime/current> \
      -b /dev -b /proc -b /sys \
      -b <data/home>:/root \
      -b <data/workspaces>:/root/workspaces \
      -b /sdcard:/sdcard:ro \
      /usr/bin/env -i HOME=/root PATH=/usr/bin:/bin \
      /usr/bin/node /usr/local/lib/node_modules/@deepseek-ai/dsh/bin/dsh.js web \
        --host 127.0.0.1 --port 0 --no-open
```

然后 App 从 stdout 里抓 `http://127.0.0.1:<port>/?token=…`，把 token 交给桥接层。

## 和桥的关系

本机模式下，**桥变成进程内的**：

```
UI  →  (我们的协议, 进程内或 localhost ws)  →  本机桥  →  dsh (127.0.0.1:<port>)
```

- 地址固定 `127.0.0.1`，**不需要配对码**（同一台设备，没有网络边界）
- 会话索引、凭据、工作区都在手机上
- 只在"连另一台机器"时才出现配对码

## 交付顺序

1. **spike**（一周）：`08-verification.md` 那四个数字
2. **runtime 层**：包装 rootfs 下载、校验、解包、版本切换（CI 出层，见 05）
3. **进程管理**：前台服务、崩溃重启、安全模式（插件搞崩时不加载插件启动）
4. **桥接**：把 `engine/src/real/` 的逻辑搬进 App 的 Kotlin/Dart 侧，或者保留一个本地 Node 桥
5. **模型登录**：`credentials/set` 打到本机引擎；账号 OAuth 由引擎自己发起（见 12）

## 验收

- [ ] 冷启动 ≤3 秒到可输入
- [ ] 杀掉 App 后任务继续跑（前台服务生效）
- [ ] 引擎崩溃自动拉起，界面不崩
- [ ] 尺寸预算全部达标（05 的表）
- [ ] 拍照 → OCR → 写 xlsx → 分享，四步内完成

## 一句话

**这一步不是写代码的问题，是"先证明能跑"的问题。** 在那台手机上量完四个数字之前，任何架构讨论都是空的。
