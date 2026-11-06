# 验收矩阵（2026-11-06，goal 第 20 轮收尾 + 夜间补验）

> 分支：`feat/release-0.2.0`（已推送，待 MR 合 `develop`），HEAD 见 `git log -1`；
> 基线：`npm --prefix app run typecheck` 通过、`npm run verify` 全绿（数量以输出为准）、
> `npm run device:regression` 10 步全绿。
> 证据目录：`scratch/shots/124`–`171`；发布预检：`scratch/release-preflight-2026-11-06b.txt`。
>
> 2026-11-06 夜间更新：深色主题、完整引擎文件系统、M2.1–M2.4、完整引擎 delete/search/shell、
> OAuth 取消中继、LAN 发现、QS/小组件/通知直达已合入；本表旧行的 ❌/⏸ 已按实际代码回写。

## 逐项状态

| 项 | 状态 | 证据 / 说明 |
|---|---|---|
| U2 ChatCard | ✅ | 审批/提问/能力门统一卡片；合并后真机回归通过 |
| U4 设置 IA/二级页 | ✅ | 6 组 + 搜索 + 账号/渠道/宿主/实验室；`127`–`138` |
| U5 引擎页 | ✅ | 状态环/启停/重启/失败卡/日志；`131`–`133` |
| U6 筛选/全部功能/搜索/置顶/文件夹 | ✅ | `139`–`155`、`162`–`163`；全文搜索 `153`–`154` |
| U7 字号档 | ✅ | 标准/大/特大；`166`–`168` |
| U7 动效 | ✅ | 页面淡入 + 设置行按压；10 步回归通过 |
| U7 深色主题 | ✅ | 深色 `device:regression` 10/10；浅色轮次仍可再补（`DARK-THEME.md`） |
| U7 动效重做 | ✅ | ScreenStack 页面栈、设置二级页、抽屉弹簧/手势/视差、BottomSheet；展开 5/5 0 掉帧（`ANIMATION.md`） |
| U7 品牌视觉 | ✅ | BrandIcon/BrandMark、首页顶栏+模式弹层、打字机问候、思考旋转/跳点、JumpButton、长按复制（`BRAND-UI.md`） |
| U8 文件 | ✅ | 浏览/搜索/重命名/删除/分享；`143`–`157` |
| U8 工作区 | ✅ | 概览 + 文件入口 + 新建工作区；`158` |
| U8 终端 | ✅ | 只读 `shell.run`；`164`–`165`；写操作 EACCES |
| U8 完整引擎 fs | ✅ | `engine/src/real/workspaceFs.ts` + 桥测试；真机 fs.list/delete 已验 |
| E2 run 队列 | ✅ 协议层 | 同会话排队/自动开下一轮；UI 无主动排队按钮 |
| E3 会话删除/正文搜索 | ✅ 双引擎 | 完整引擎删 dsh 会话目录 + 扫日志；运行中拒绝 |
| E5 device 回归 | ◐ 8/10 | 文件操作用 `uploads/weekly.docx` fixture；全文搜索受轻会话为空/输入焦点影响未过 |
| 1.5 401/429/断网/超时 | ✅ 真机 | `159`–`161`、`171` |
| 1.5 20MB/魔数 | ✅ 单测 | 真机未单独造 20MB 图 |
| M2.7 浏览器 OAuth | ✅ 真机 | release 上打开浏览器授权，页面显示「授权已完成」；回 App 已登录、模型可选 |
| 3.1 拒绝授权 | ⏳ 代码完成 | 桥回调中继 + cancelSignIn；待真机点一次拒绝 |
| 完整引擎 delete/search/shell | ✅ 代码/单测 | `sessions.delete` / `sessions.search` / `shell.run`；待 release 真机复核 |
| LAN 发现 | ◐ 第一步 | hostId + mDNS + NSD + 设置页扫描/重连；权限弹窗通过，跨设备被 PC 防火墙/网络隔离挡住 |
| 系统入口 | ✅ 第一步 | QS 磁贴 + 桌面小组件 + 通知直达；悬浮球未做 |
| release 首装/升级 | ✅ 覆盖升级通过 | 设备已装 `0.2.0 (2)`，同签名 `install -r`；APK sha256 `235CB1DA…`，预检 PASS |
| MR 合 develop | ✅ | `feat/settings-pages` 已经 MR #4 合入 `develop` |

## 结论

- 代码可交付质量：typecheck + 全量测试 + 10 步真机回归全绿。
- 2026-11-06 夜间已完成：深色主题、完整引擎 delete/search/shell/工作区映射、OAuth 取消中继、
  LAN 发现/重连、QS/小组件/通知直达、release `0.2.0 (2)` 重建。
- 仍未完成：E2E 加密、多宿主密钥/索引分仓、完整离线状态机、悬浮球、上游 FTS 实时索引；
  PDF/OCR/LibreOffice render/TTS 仍按决策暂缓。
- 真机待验：拒绝授权路径、release 覆盖升级、LAN 发现链路、系统入口点按。
