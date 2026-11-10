# MR: `feat/settings-pages` → `develop`（已合并）

> 2026-11-06 夜间状态：**已通过 MR #4 合入 `develop`**（`98e1dbe 合并来自 feat/settings-pages 的合并请求 #4`）。
> 分支保留只作历史；深色主题、完整引擎平权、M2.1–M2.4 已在后续独立分支合入。
> 对比：https://cnb.cool/debaox3.0/test-new-technology/dsh-palm/-/compare/develop...feat/settings-pages

## 包含内容

- **U2**：审批/提问/能力门统一 `ChatCard`（20 圆角、tonal 描边、代码盒）。
- **U4**：设置 IA 6 组 + 搜索 + 账号/渠道/宿主/实验室二级页；深链 `dshpalm://light`。
- **U5**：独立引擎页（状态环、启动/停止/重启、失败卡、日志、预热档位）。
- **U6**：抽屉筛选/置顶/自定义文件夹/全文搜索、全部功能网格、文件搜索。
- **U7（部分）**：对话字号档、页面淡入、设置行按压；**深色主题未做**（方案见 `docs/DARK-THEME.md`）。
- **U8**：文件浏览/重命名/删除/分享/搜索、工作区概览、只读终端（`shell.run`）。
- **M2.5/M2.7**：单渠道 providers、账号 token 刷新、401 重登入口。
- **E2**：同会话 run 排队（协议层）。
- **E3**：会话删除 + 正文搜索（轻引擎）。
- **E5**：`npm run device:regression` 10 步真机回归（含引擎启停）。
- **E8**：`release-preflight.ps1` + `docs/RELEASE.md`；release APK 已用本分支重建。
- **1.5**：真机 401/429/断网/45s 超时；单测覆盖 20MB/魔数。

## 测试计划

```bash
npm run typecheck
npm run verify                      # 240 pass / 0 fail
npm run device:regression           # 10 步全绿
npm run release:preflight           # 只读预检
```

真机已验证：首页/抽屉/搜索、设置与二级页、文件操作、工作区、只读终端、引擎启停、
审批卡、401/429/断网/超时横幅。证据在 `scratch/shots/124`–`171`。

## 风险 / 未完成

- **深色主题**已完成（`feat/dark-theme` 合入 `develop`）；浅色真机轮次仍可补。
- **M2.7 OAuth** 正常授权已在 release 真机闭环；拒绝授权已有桥中继，待真机点一次。
- **release 首装**已通过；`0.2.0 (2)` 已 bump，同签名覆盖升级待执行。
- **完整引擎 delete/search/shell** 已完成；LAN 发现/系统入口为第一步，E2E/多宿主/悬浮球未做。
- `develop` 已同步 `origin/develop`；旧分支可清理。
