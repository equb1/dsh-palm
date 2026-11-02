# 25 · M1 spike 结果（2026-11-02）

> 对应 [23-requirements.md](23-requirements.md) 第 9 节的 R2 / L0。
> 环境：华为 PLR110 / Android 16 / Hermes（RN 0.88.1）/ 无线 adb（192.168.1.2:41723）。

## 测试包说明

手机上已装的是 **release 签名**的旧包（keystore 与本地 debug 不一致），直接覆盖会丢数据。
所以这次用独立 `applicationId`（`cool.cnb.dshpalm.spike`）装了个并存的测试包，
测完已卸载；你原来的 App 和数据没动。

## L1 · just-bash 在 Hermes 上 ✅

**结论：能跑，功能完整，日常命令毫秒级；重文本处理是秒级。**

前提（都已在分支里实现）：
1. `just-bash/browser`（1.2MB）+ 3 个 shim：`Buffer`、`crypto.getRandomValues`、`performance`；
2. Metro 给 `node:zlib` 一个 stub（打包产物里唯一的 `node:` 引用，用于 gzip 命令）。

真机实测（7 条命令，`docs/assets/spike-justbash.png`）：

| 命令 | 耗时 |
|---|---|
| `echo hello` | 2 ms |
| `printf ... \| grep b` | 1 ms |
| `for i in 1 2 3; do echo …; done` | 1 ms |
| `mkdir -p /tmp/d && echo hi > … && cat …` | 2 ms |
| `ls /` | 1 ms |
| `seq 1 50000 \| sed -n '1,3p'` | 273 ms |
| `seq 1 100000 \| awk '{s+=$1} END {print s}'` | 4625 ms |

解读：
- 文件系统/管道/控制流都是毫秒级，**没有出现 Hermes 上的解释器瓶颈**；
- 瓶颈在"纯 JS 处理 10 万行"这类场景（4.6s），和浏览器里跑 JS 的量级一致；
- VFS 目前是 `InMemoryFs`；要落手机真实目录，还得实现 `IFileSystem` 适配器（下一步）。

## L0 · WebView 跑官方前端 ✅

**结论：零改动成立。** `react-native-webview` 14.0.1 打开
`http://127.0.0.1:8787/?token=…`，官方 dsh web 前端完整渲染：侧栏、新建会话、
历史、插件面板、以及未登录时的"开始使用"对话框（`docs/assets/spike-websurface.png`）。

这意味着：**64 个 `dsh-client-ui-*` 插件不用改一行代码**，手机上就能用；
RN 原生界面负责快和核心操作，WebView 负责"全部旧插件"。

## 对 23 的影响

| 项 | 之前 | 现在 |
|---|---|---|
| R2 just-bash | 条件可行（静态） | **已真机验证**（功能 + 性能基线） |
| L0 WebView | 计划 | **已验证** |

剩下的集成工作（不是可行性问题）：
1. `IFileSystem` → RN 文件系统适配（让 shell 操作真实工作区）；
2. 命令覆盖与执行限额（just-bash 自带 `executionLimits`）；
3. WebView 与 RN 的会话态联动（当前是独立打开，token 从宿主日志解析）。

## 复现

```bash
cd app
npm install
npx expo install react-native-webview
cd android && ./gradlew :app:assembleDebug
```

App 里进「设置 → 实验室 · M1 spike」：
- **打开完整界面**：从宿主日志取 token，WebView 开官方前端；
- **just-bash 自检**：跑 7 条命令、逐条计时，结果同时打到 logcat（`[justbash]`）。
