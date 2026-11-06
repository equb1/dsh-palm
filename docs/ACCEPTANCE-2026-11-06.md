# 验收矩阵（2026-11-06，goal 第 20 轮收尾）

> 分支：`feat/settings-pages`（已合并 `feat/chat-card`），HEAD 见 `git log -1`；
> 基线：`npm run typecheck` 通过、`npm run verify` 240 pass / 0 fail、
> `npm run device:regression` 10 步全绿。
> 证据目录：`scratch/shots/124`–`171`；发布预检：`scratch/release-preflight-2026-11-06b.txt`。

## 逐项状态

| 项 | 状态 | 证据 / 说明 |
|---|---|---|
| U2 ChatCard | ✅ | 审批/提问/能力门统一卡片；合并后真机回归通过 |
| U4 设置 IA/二级页 | ✅ | 6 组 + 搜索 + 账号/渠道/宿主/实验室；`127`–`138` |
| U5 引擎页 | ✅ | 状态环/启停/重启/失败卡/日志；`131`–`133` |
| U6 筛选/全部功能/搜索/置顶/文件夹 | ✅ | `139`–`155`、`162`–`163`；全文搜索 `153`–`154` |
| U7 字号档 | ✅ | 标准/大/特大；`166`–`168` |
| U7 动效 | ✅ | 页面淡入 + 设置行按压；10 步回归通过 |
| U7 深色主题 | ❌ 未做 | 方案 [DARK-THEME](DARK-THEME.md)，需跨 15+ 页样式重构 |
| U8 文件 | ✅ | 浏览/搜索/重命名/删除/分享；`143`–`157` |
| U8 工作区 | ✅ | 概览 + 文件入口；`158` |
| U8 终端 | ✅ | 只读 `shell.run`；`164`–`165`；写操作 EACCES |
| U8 完整引擎 fs | ❌ | 完整引擎未实现，UI 显式提示 |
| E2 run 队列 | ✅ 协议层 | 同会话排队/自动开下一轮；UI 无主动排队按钮 |
| E3 会话删除/正文搜索 | ✅ 轻引擎 | 完整引擎显式 unsupported |
| E5 device 回归 | ✅ | 10 步脚本 + 手工审批路径；release 上只做登录/发消息 smoke |
| 1.5 401/429/断网/超时 | ✅ 真机 | `159`–`161`、`171` |
| 1.5 20MB/魔数 | ✅ 单测 | 真机未单独造 20MB 图 |
| M2.7 浏览器 OAuth | ✅ 真机 | release 上打开浏览器授权，页面显示「授权已完成」；回 App 已登录、模型可选 |
| release 首装/升级 | ✅ 首装通过 | release 签名 `55df28b9`，首启解压 46s；cleartext/CRLF/默认模型修复后完整引擎发消息正常 |
| MR 合 develop | ⏸ 待操作 | 描述见 [MR-feat-settings-pages](MR-feat-settings-pages.md) |

## 结论

- 代码可交付质量：typecheck + 240 项测试 + 10 步真机回归全绿。
- 未完成只有两类：
  1. **U7 深色主题**（架构级样式重构，非单点开关，已写迁移方案）；
  2. **需要用户操作**：浏览器 OAuth 授权、release 首装确认（会清数据）、建 MR。
- 因此本 goal **不能标完成**；剩余工作与阻塞点已分别写进 `DARK-THEME.md`、`RELEASE.md`、
  `MR-feat-settings-pages.md` 与 36 交接。
