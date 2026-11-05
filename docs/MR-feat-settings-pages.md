# MR: `feat/settings-pages` → `develop`

> 2026-11-06。分支已推送：`origin/feat/settings-pages`（HEAD `026b88d` 之后）。
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

- **深色主题**未做，需按 `docs/DARK-THEME.md` 单独重构样式层。
- **M2.7 OAuth** 只差用户在浏览器完成一次授权（代码路径已就绪）。
- **release 首装**未执行：当前设备 debug 与 release 证书不同，切换会清 App 数据，需用户确认。
- release APK 的 versionCode 仍为 1；正式覆盖升级前要 bump `DSH_PALM_VERSION_CODE`。
- `develop` 与远端有历史分叉（43 个本地提交未推），合并前先确认 develop 状态。
