# 08 · 一周技术验证清单

> 这份文档解决一个问题：**在写任何产品代码之前，先证明"手机能跑起引擎"这个前提成立。**
>
> 它排在整个路线的第 0.5 步——比 UI 重要，比插件重要。数字不过关，产品形态就要改。

## 为什么先做这个

整个产品的叙事建立在"手机是完整宿主"上。如果跑不起来，剩下的都是空谈。

而这件事**没法靠推演判断**：不同 SoC、不同 Android 版本、不同 ROM 的后台策略差异极大。必须在你自己的目标机型上量。

> 参考教训：dsh-go 的 issue 区里，有人用纯推理写了一篇"鸿蒙做不到"的分析，被维护者一句"实际上已经跑起来了"直接否掉。**推演在这个领域不可靠。**

## 要验证的四件事

| # | 问题 | 为什么致命 |
|---|---|---|
| 1 | Node 能不能在 PRoot 里跑起来 | 跑不起来，产品不存在 |
| 2 | 装完多大 | >300MB 首装劝退 |
| 3 | 空闲/峰值内存 | >450MB 中端机被系统杀 |
| 4 | 冷启动多久 | >5s 用户以为坏了 |

## 做法（一周）

### Day 1–2：把最小环境跑起来

不要一上来就接 dsh。先用最小闭环：

```bash
# 在电脑上准备 arm64 的 proot + node + 一个最小 rootfs
# 推到手机 /data/local/tmp 或 App 私有目录
adb push ...
adb shell
# 手动跑通：
proot -r ./rootfs -b /dev -b /proc -b /sys /usr/bin/env -i HOME=/root PATH=/usr/bin:/bin /usr/bin/node -e "console.log(process.version, process.arch)"
```

**过关标准**：打印出 `v2x.x.x linux arm64`。

**不过关怎么办**：
- 换 proot 实现（proot-rs / termux 的 proot）
- 检查 CPU 是否支持（arm64 基本都行，问题多在 exec 权限）
- 确认 targetSdk 与私有目录 exec 限制（API 29+ 禁止从可写目录 exec）

### Day 3：量体积

```
du -sh rootfs/     # 解包后
du -sh node        # 单个二进制
```

**过关标准**：`node + proot + 最小 rootfs ≤ 150MB`。

**不过关怎么办**：
- 去掉 rootfs 里不需要的包（这是最大一块，通常能砍掉 40%）
- Node 用 strip 过的构建，去掉完整 ICU（`--with-intl=small-icu`）
- 评估"原生 node 二进制 + Android 自带 toybox"（路线 C，见 05-runtime）

### Day 4：量内存

启动 node，加载一个中等规模的脚本，跑 5 分钟，用 `dumpsys meminfo` 采样。

**过关标准**：

| 指标 | 上限 |
|---|---|
| 空闲 RSS | ≤ 250MB |
| 峰值 RSS | ≤ 450MB |
| 5 分钟内无 OOM | 必须 |

**不过关怎么办**：
- 检查是不是 rootfs 里的残留进程
- 降低 Node 的 `--max-old-space-size`
- 把重活拆到子进程（子进程退出后内存会被回收）

### Day 5：量冷启动 + 后台存活

1. 从点击图标到 `dsh web` 端口可访问，计时。
2. 切后台 30 分钟，回来看进程还在不在。
3. 锁屏 1 小时，同上。

**过关标准**：冷启动 ≤ 5s（首装后可放宽到 8s）；后台 30 分钟存活。

**不过关怎么办**：
- 前台服务 + `dataSync` type
- 引导用户加电池白名单（小米/华为/OPPO/vivo 各不相同，要做引导页）
- 冷启动慢就把引擎启动和 UI 首屏解耦（UI 先出来，引擎后台起）

### Day 6–7：接真 dsh

把验证过的环境接到真的 `dsh web`，用现在的 App（改一下地址）连上去，跑一次完整对话。

**过关标准**：能在手机上完成一次带审批的完整回合，且不崩。

**不过关怎么办**：
- 记录具体报错，对照 dsh-go 的 issue 区找同类问题（它的坑基本都公开）
- 判断是"环境问题"还是"产品假设问题"

## 记录表

把结果填在这里，后面做决策全靠它：

| 项 | 目标 | 实测 | 结论 |
|---|---|---|---|
| Node 启动 | 打印版本 | | |
| 解包体积 | ≤150MB | | |
| 空闲内存 | ≤250MB | | |
| 峰值内存 | ≤450MB | | |
| 冷启动 | ≤5s | | |
| 后台 30 分钟 | 存活 | | |
| 锁屏 1 小时 | 存活 | | |
| 真 dsh 对话 | 跑通 | | |

## 如果全部不过关

产品不是死了，是**换形态**：

| 结论 | 新形态 |
|---|---|
| Node 跑不起来 | 只做遥控器（等于承认 dsh-go 的路线是对的） |
| 体积超标 | 只做文档垂直场景，rootfs 按需下载 |
| 内存超标 | 引擎常驻但闲置休眠，用时唤醒 |
| 后台必被杀 | 放弃"后台值守"，改成"打开即用" |

**任何一种结论都比六个月后才发现要好。**

---

# 实测记录 #1（Android / Termux / 2026-11-01）

第一次真机验证，用的是 **Termux + proot-distro Ubuntu**，不是我们的 App。
目的是先证明"引擎能在这台手机上跑"，不涉及原生开发。

## 环境

| 项 | 值 |
|---|---|
| 架构 | arm64 |
| 内存 | 15.8 GB |
| CPU | 8 核 |
| Node | v22.22.1（官方 arm64 tarball） |
| 环境 | Termux → `proot-distro` Ubuntu 26.04（resolute） |
| dsh | 0.2.1-rc.5（npm 全局装） |

## 结果

| 指标 | 过关线 | 实测 | 判定 |
|---|---|---|---|
| Node 能跑 | 必须 | ✅ | 过 |
| dsh 引擎能起 | 必须 | ✅ 打印 token URL，浏览器可访问 | **过** |
| 常驻内存 | ≤250MB | **178 MB**（单进程 RSS） | **过** |
| 安装体积 | ≤150MB | **1.1 GB** | ❌ 差 7 倍 |
| 冷启动 | ≤5s | 未测（首次测法有误） | 待测 |

## 过程中的坑（都要写进实现）

### 1. npm 在 proot 下装不了（换 pnpm 解决）

`npm i -g` 在三种缓存目录（默认 / `/dev/shm` / 自建目录）下都报同一个错：

```
ENOENT: no such file or directory, rename
  '_cacache/tmp/xxx' -> 'content-v2/sha256/...'
Invalid response body while trying to fetch <pkg>
```

磁盘有 257G 空闲，两个 registry 都一样 → 不是磁盘、不是网络，是 **npm 的并发缓存写入在 proot 模拟的 syscall 上失败**。

**解决**：换 pnpm（内容寻址存储 + 硬链接，机制不同），一次装完 568 个包，33 秒。

### 2. 原生模块的平台判定被 Android 骗了

pnpm 装完后 `dsh web` 报：

```
No usable native binding found for node-addon-require-builtin-linux-arm64-gnu (auto)
```

根因：`node-addon-require-builtin` 用 optionalDependencies 分发按平台预编译的 `.node`
（`...-linux-arm64-gnu`、`...-linux-arm64-musl` 等）。**pnpm 靠 glibc 版本判断该装哪个变体，
而 Android 用的是 bionic，读不到 glibc 版本**，于是所有变体都被过滤掉。

**解决**：手动下载 `node-addon-require-builtin-linux-arm64-gnu@0.1.9` 的 tarball，
解包后放进 loader 的 `node_modules` 旁边。

**这条直接决定了架构**：真机上永远不能让包管理器去猜 libc。
预构建镜像里必须直接带好 `.node` 文件。

### 3. `pkill -f "dsh web"` 杀不掉

进程的命令行是 `node .../dsh/lib/bin.js web`，**不含连续的 "dsh web"**，正则匹配不上。
结果旧进程占着端口，新的启动失败，测出来的 14 秒是"失败耗时"。

正确的模式：`pkill -f "bin.js web"`。

## 冷启动拆解：proot 的税是 10 秒

冷启动 13.7s 看着像 dsh 太重，做了对照实验才发现不是。

在 Windows 上装同一份 `@deepseek-ai/dsh@0.2.1-rc.5`（543 个包），
用同一个测量方式（`scripts/measure-boot.ts`，从 spawn 到打印 token URL）：

| 环境 | 冷启动 | 热启动 |
|---|---|---|
| Windows 11 / x64 / 无 proot | **3.40s** | **3.34s** |
| Android / arm64 / proot Ubuntu | **13.7s** | 13.7s |
| **差额 = proot 的税** | **≈ 10.3s** | |

另外两个对照：

| 项目 | 耗时 | 说明 |
|---|---|---|
| `dsh -V` | 0.54s | CLI 引导本身很快 |
| `dsh --profile web --dump-config` | 0.55s | 配置组装很快 |
| 断网启动 | 14.27s | 排除"网络超时"假设 |

**结论：慢的不是配置解析、不是网络、也不是 dsh 本身，而是"加载 543 个 ESM 模块"这件事在 proot 里被放大了 4 倍。** proot 拦截并翻译每个 `stat` / `open`，模块解析又是海量小文件访问，乘起来就是 10 秒。

### 这意味着两条路

**A. 减少模块数**（改 profile）
每个插件都是几个 ESM 包。手机端不需要 office / 语音 / web-search / hmr，
裁掉一半插件，10 秒的税可能只剩 5 秒。

**B. 绕开 proot**（原生 Node）
Android 上直接跑 Node（像 Termux 那样），没有 syscall 翻译，理应回到 3–4 秒。
代价：所有原生模块（node-pty / koffi / node-addon-require-builtin / sharp / sherpa-onnx）
都得用 bionic 重新编译——glibc 版本的 `.node` 在 Android 的 linker 下加载不了。

**短期选 A，长期看 B。** 但两条都指向同一个结论：**首个版本应当让引擎常驻**，
把 14 秒藏进"手机开机后的第一次"，而不是每次打开 App 都付。

## 体积 1.1GB 的构成（裁剪依据）

| 内容 | 大小 | 何时需要 |
|---|---|---|
| `@deepseek-ai/libreoffice-kit-wasm` | 48 MB | 文档预设 |
| `sherpa-onnx-linux-arm64` | 13.9 MB | 语音预设 |
| `@img/sharp-*` | 8.5 MB | 图像处理 |
| 非 arm64 的可选包 | 数十 MB | 永远不需要 |
| 所有平台的 prebuild | — | 只留 arm64 |
| 开发依赖 / sourcemap | 大头 | 永远不需要 |

**结论：150MB 不是痴人说梦，但必须靠"CI 预构建 + 按预设分包"，而不是在手机上装。**

## 这次验证改变了什么

1. **"手机能不能当宿主"从假设变成了事实。** 后面所有架构讨论不用再讨论这个前提。
2. **原生层的优先级下降了。** 至少能先用 Termux 跑引擎，把 App 和协议先打通。
3. **"预构建镜像"从优化项变成了必选项。** 手机上的包管理器不可靠，这是硬约束。
