# 原生层设计（本机无条件实现，只出方案）

手机要当宿主，App 必须自己把两个进程管起来：

```
App（RN 界面）
   │  Binder / 本地 socket
   ▼
ForegroundService（Kotlin）
   ├── 启动 dsh web   （proot 里的引擎）
   └── 启动 bridge     （node 单文件桥）
```

现状：这两步要人在 Termux 里手敲（见 [14-phone-self-host.md](14-phone-self-host.md)）。
本条把它变成"点一下图标就行"。

## 一、原生层要提供的 7 个能力

| # | 能力 | 为什么必须在原生层 |
|---|---|---|
| N1 | 起/停引擎进程 | 需要进程组、信号、超时杀 |
| N2 | 起/停桥进程 | 同上 |
| N3 | 前台服务保活 + 常驻通知 | 否则系统几十分钟就回收 |
| N4 | 进程状态与日志 | UI 要显示"启动中/失败原因/看日志" |
| N5 | 崩溃自动重启（带退避） | 长任务值守的基本要求 |
| N6 | 端口与 token 传递 | 引擎启动后才打印 token，桥要等它 |
| N7 | 电池/唤醒锁管理 | 不锁屏就断，锁太狠又费电 |

## 二、进程模型

```
ForegroundService(startForeground)
  ├─ EngineProcess   : proot-distro login ubuntu -- dsh web --host 127.0.0.1 --port 8787 --no-open
  └─ BridgeProcess   : node bridge.cjs http://127.0.0.1:8787 <token> 8788
```

约束（都来自实测）：

- **proot 下引擎冷启动 13.7 秒**，所以 UI 不能等它，首屏只读缓存。
- 桥启动 <1 秒，但**必须等引擎打印 token** 才能起。
- token 每次启动都变，所以桥的参数要在运行时拼。
- 两个进程都要绑 `127.0.0.1`；桥若要给局域网用，必须先开配对（P3 已实现）。

### 启动时序

```
1. Service onCreate -> 通知"正在启动引擎"
2. spawn EngineProcess，逐行读 stdout
3. 匹配到 http://127.0.0.1:8787/?token=xxx -> 拿到 token
4. spawn BridgeProcess（参数里带 token）
5. 探测 http://127.0.0.1:8788/health -> ok 才认为"就绪"
6. 通知变"已就绪"，通过 IPC 告诉 RN
7. RN 连 ws://127.0.0.1:8788/ws?key=<设备密钥>
```

失败分支：

| 症状 | 处理 |
|---|---|
| 引擎 30 秒没打印 token | 杀掉重试，最多 3 次，然后报"引擎启动失败" |
| 端口被占（EADDRINUSE） | 先杀旧进程；仍失败就换端口并把新端口写进配置 |
| 桥起不来（node 找不到） | 提示"运行时不完整"，给一键重装 |
| 运行中进程死了 | 退避重启（1s/5s/15s/60s），通知里能手动停 |

## 三、IPC

RN 和 Service 之间只需要很小的协议：

```
{RN -> Service}  start | stop | restart | status | logs?since=<n>
{Service -> RN}  state: {engine: 'starting'|'ready'|'failed', bridge: ..., port, since}
                 log:   {ts, stream: 'stdout'|'stderr', line}
```

实现选项：

- **Binder（推荐）**：`AIDL` 定义 5 个方法 + 一个回调接口，零序列化开销
- 或本地 socket + JSON：跨进程更松耦合，便于将来把引擎放到独立进程

日志环形缓冲 500 行，超出的丢最老的——手机上不落盘，避免无限长。

## 四、保活策略

| 手段 | 用不用 | 说明 |
|---|---|---|
| 前台服务 + 常驻通知 | ✅ | 基础，Android 8+ 必须 |
| `PARTIAL_WAKE_LOCK` | ⚠️ 仅在跑长任务时 | 空闲时释放，否则耗电被投诉 |
| 电池优化白名单引导 | ✅ | 只引导，不强制 |
| JobScheduler 唤起 | ✅ | 兜底：服务被系统杀了之后尽快拉起 |
| 双进程互相拉起 | ❌ | 对抗系统，长期一定输 |

**产品上必须承认**：Android 保不住"永远活着"。所以 UI 要能优雅处理"引擎不在了"——
首屏读缓存、显示"引擎已停止"、一键重启。这条在 [05-runtime.md](05-runtime.md) 里已经写死。

## 五、资源预算（实测回填）

| 指标 | 实测 | 上限 |
|---|---|---|
| 引擎常驻内存 | 178 MB | 250 MB |
| 桥常驻内存 | ~40 MB | 60 MB |
| 引擎冷启动 | 13.7 s（proot） | ≤ 15 s |
| 桥启动 | < 1 s | ≤ 3 s |
| 安装体积 | 1.1 GB（未裁剪） | 150 MB（需裁剪，见 08） |

## 六、模拟器实测结果（2026-11-01）

这台机器有 Android Studio + SDK 36/37 + AVD `Pixel_9a`，所以原生层不是文档，是**跑通的代码**。

### 已经写好的文件

| 文件 | 作用 |
|---|---|
| `android/.../host/HostRuntime.kt` | 起引擎 → 抓 token → 起桥 → 健康检查 → 看门狗退避重启；日志环形缓冲 |
| `android/.../host/HostService.kt` | 前台服务（`dataSync` 类型 + 常驻通知），命令可由 Intent extra 覆盖 |
| `android/.../host/HostModule.kt` | RN 原生模块 `DshPalmHost`：start/stop/status/logs |
| `android/.../host/HostPackage.kt` | 注册进 `MainApplication` |
| `app/src/lib/host.ts` | JS 封装，非 Android / Expo Go 自动降级 |

### 实测链路（logcat，假命令代替 proot）

```
[service] onStartCommand action=cool.cnb.dshpalm.host.START engine=sh /data/local/tmp/engine.sh
[engine] 启动（第 1 次）: sh /data/local/tmp/engine.sh
ENGINE_START pid=12328
[engine] dsh web: http://127.0.0.1:8787/?token=FAKE123      ← 从 stdout 抓到 token
[bridge] 启动: sh /data/local/tmp/bridge.sh ***             ← token 打码后传入
BRIDGE_START token=FAKE123 port=                            ← {token} 占位符替换成功
```

也验证了看门狗：脚本不可执行时按 **1s → 5s → 15s** 退避重试，日志清楚可读。

### 踩到的坑（都已记进代码注释）

1. **service 必须 `exported="false"`**——`adb shell am start-foreground-service` 是 shell uid，起不来；
   真实路径只能由 App 自己（同 uid）调用原生模块启动。
2. **`/data/local/tmp` 里的脚本不能直接执行**（SELinux 不允许 app 执行数据目录里的文件），
   要用 `sh /path/script.sh`——脚本当数据、shell 当可执行。
3. **Gradle 首次构建**：Maven Central 在国内会卡死（13 分钟无进展），
   在 `android/build.gradle` 里加阿里云镜像后 16 分钟一次通过。
4. **`bundleInDebug` 不是这个 RN 版本的属性**，要用 `debuggableVariants = []`
   才会把 JS 打进 debug APK（否则必须连 Metro）。
5. **模拟器验不了引擎本身**：AVD 是 x86_64，dsh 的 proot rootfs 是 arm64，跑不了。

### 还没验证的

- 健康检查通过后 `bridge=ready`（模拟器上没有真 HTTP 服务可探）
- `stop` 的完整清理
- 真机上的 proot + node 命令（需要 arm64 设备）
- 保活/唤醒锁在实际系统上的表现

## 七、验证清单（有真机后照这个做）

- [ ] 冷启动：点图标 → 首屏可交互 ≤ 1 s（不等引擎）
- [ ] 引擎就绪 ≤ 15 s，通知从"启动中"变"已就绪"
- [ ] 杀进程后 60 s 内自动恢复
- [ ] 息屏 30 分钟后仍在跑（唤醒锁按需）
- [ ] 连续 100 轮对话不 OOM
- [ ] 拔掉网络 → 引擎仍在（本地推理不需要网，但模型调用会失败，要给出可读错误）
