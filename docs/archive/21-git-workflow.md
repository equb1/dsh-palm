# 21 · 分支与提交规范

> 一句话：**一切从 `develop` 开分支，一次改动一个分支，PR 合回 `develop`；`main` 只放发版。**

## 分支模型

```
main                发布分支：只接受从 develop 合入的发版（tag 打在这里）
 └ develop          集成分支：所有功能/修复的基线
    ├ feat/<topic>   新功能
    ├ fix/<topic>    修 bug
    ├ docs/<topic>   只动文档
    └ chore/<topic>  构建、依赖、CI
```

- **基线永远是 `develop`**：开分支前先 `git fetch origin && git checkout develop && git pull`，再从最新 `develop` 切。
- **一个分支只做一件事**：一次功能、一轮修复、一篇文档。不要把不相关的改动塞进同一个分支。
- **不直接提交 `develop` / `main`**：本地可以改，但落库必须走分支 + PR。
- **禁止用 `git merge --ff-only <分支> && git push` 后再删分支**：远端只会看到一条直提，
  没有分支、没有 PR、没有 review 记录。合并必须由 PR/MR 完成（在 cnb 上点合并）。
- 分支合入后删除；`main` 只在发版时从 `develop` 合并并打 tag。

## 按任务分支（2026-11-03 起）

后续开发**直接从最新 `develop` 切**，并且**一个方面的任务建一个分支**：

| 方面 | 分支示例 |
|---|---|
| 引擎路由 / 加载 | `feat/engine-manager`、`feat/engine-routing` |
| 附件收件 | `feat/attachment-intake` |
| Office 三件套 | `feat/office-python` |
| 能力门 / 交接 | `feat/capability-handoff` |
| 会话 / 配置 | `feat/session-badge`、`feat/engine-profile` |
| UI 改版 | `ui/chat-refactor`、`ui/settings-ia` |
| 账号 / 互联 | `feat/oauth-loopback`、`feat/lan-pairing` |
| 构建 / CI | `chore/ci-tests`、`chore/payload-python` |
| 文档 | `docs/engine-routing`、`docs/readme` |

规则：

1. 开分支前：`git fetch origin && git switch develop && git pull`；
2. 一个分支只做一个方面的任务；大任务可以拆子分支，但合并顺序要写清楚；
3. 每个分支必须能编译、`npm run verify` 绿；
4. 推到 `origin` → PR 到 `develop` → squash 合并 → 删分支；
5. 不要在一个分支里顺手改别的方面；发现了就另开分支；
6. **MR 没合并前不要删分支、不要把分支本地合进 develop 再推送**；如果 MR 工具不可用，
   就保留分支并请有权限的人合并，**不要直推 develop**。

## 命名

| 前缀 | 用途 | 例子 |
|---|---|---|
| `feat/` | 新功能 | `feat/provider-catalog`、`feat/session-manage` |
| `fix/` | 修 bug | `fix/p0-notifications`、`fix/preset-crash` |
| `docs/` | 文档 | `docs/ui-research` |
| `chore/` | 构建/CI/依赖 | `chore/ci-and-tests` |

小写、连字符、不超过 4 个单词；不要用中文和日期。

## 提交信息

```
<type>(<scope>): <一句话>

- 做了什么
- 为什么
- 怎么验证的
```

- `type` 用 `feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `perf`。
- `scope` 用模块名：`app`、`engine`、`bridge`、`android`、`docs`。
- 正文写**验证方式**（真机型号、测试条数、截图），方便 review。
- 一个提交尽量只做一件事；大改动拆多个提交，每个提交都可编译。

## PR

1. 分支推到 `origin`，开 PR 到 `develop`；
2. PR 描述里贴：改了什么、怎么验的、有什么已知限制；
3. CI 必须绿：cnb.cool 用 `.cnb.yml`（develop 的 PR/push、main 的 push），
   GitHub 镜像用 `.github/workflows/ci.yml`，两边跑同一套（app typecheck + `npm run verify`，
   测试数量以命令输出为准）；
4. 合并方式用 **squash**，标题沿用提交标题；
5. 合并后删分支。

## 这一轮的说明

2026-11-02 的三轮改动（提供商目录、P0、P1+工程债）是在同一份未提交工作区里连续改的，
多个文件被三轮同时改过（`store.ts`、`protocol/index.ts`、`SettingsScreen.tsx` 等），
**无法无损拆成三个独立分支**，所以合并成了一个 `feat/providers-and-stability`。这是唯一一次例外。

**2026-11-03 的违规记录**：`docs/engine-routing`（commit `128f3f8`）是在本地提交后用
`git merge --ff-only` 合进 `develop` 并删除分支的，远端只留下一条直提，**没有 MR**；
这违反了本节规则。从 `docs/consistency-fix` 起按正确流程执行：推分支 → 在 cnb 建 MR →
合并 → 删分支。
