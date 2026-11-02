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
- 分支合入后删除；`main` 只在发版时从 `develop` 合并并打 tag。

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
3. CI 必须绿（`.github/workflows/ci.yml`：app typecheck + 22 条测试）；
4. 合并方式用 **squash**，标题沿用提交标题；
5. 合并后删分支。

## 这一轮的说明

2026-11-02 的三轮改动（提供商目录、P0、P1+工程债）是在同一份未提交工作区里连续改的，
多个文件被三轮同时改过（`store.ts`、`protocol/index.ts`、`SettingsScreen.tsx` 等），
**无法无损拆成三个独立分支**。所以本轮合成一个分支 `feat/providers-and-stability` 落库；
从下一轮开始，严格按「一次改动一个分支」执行。
