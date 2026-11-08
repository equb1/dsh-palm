# 跨设备会话：现状、可行性与同步方案

> 状态：2026-11-09 凌晨。本文回答「手机和电脑的会话能不能实时同步」，记录实测边界和分阶段方案。
> 相关：[archive/43](archive/43-handoff-2026-11-09.md)（来源分离/推送）、[archive/44](archive/44-handoff-2026-11-09.md)（推送打通/标题/角标）。

## 1. 现状（已实现）

| 方向 | 入口 | 行为 |
|---|---|---|
| 手机 → 电脑 | 抽屉「在电脑继续（复制历史）」 | `buildHandoff` → 电脑 `sessions.create` → `sessions.send(seed)` → `sessions.rename` |
| 电脑 → 手机 | 抽屉「在手机继续（摘要交接）」 | `buildHandoff` → 切轻引擎 → `sessions.import`（重建历史 + seed，不触发模型） |

两条都是**复制/接管**，不是同步：

- 复制完成后两边各自独立，一侧新增消息不会回写另一侧；
- 电脑侧（`pushSessionToComputer`）会真跑一轮模型；手机侧（`continueComputerInPhone`）走 import，不跑模型，
  用户自己接着问；
- seed 作为一条可见的 user 消息留在新会话首轮（和现有 M2.6 反向 handoff 用 ConversationLink 隐藏 seed 的做法不同，
  copy 语义不建 link）。

## 2. 实测：DSH 侧有什么能力（2026-11-09）

对运行中的 DSH（0.2.1-rc.5，`http://127.0.0.1:57497`）逐个探测 RPC：

```text
OK   session/fork        { sessionId }
404  session/import  session/export  session/duplicate  session/attach  session/resume
404  session/copy    session/share   session/branch     session/log     session/read
404  session/records workspace/import session/migrate   session/snapshot session/history
```

`session/fork` 语义（用 2 轮的会话实测）：

- 返回新 `sessionId`；快照带 33 条 `event` 记录（原会话历史真的复制过去）；
- `header.parentSession` 指向源会话、`isSeeded: true`、`agentPreset` 继承；
- 列表里标题/步骤数一致，之后可独立继续。

**没有 import/export**：跨设备搬历史只能靠「seed 文本」或「直接写会话日志」。
桥协议里 `sessions.import` 在完整引擎侧仍是 `unsupported`（`engine/src/real/server.ts`），只有轻引擎实现。

会话存储布局（读写都绕不开）：

```text
~/.dsh/sessions/<projectKey>/<sessionId>/session.v4.jsonl.zstd
```

- v4 事件流：每行 `{ type, seq, time, data }`，投影出 turns/title/stats；
- 落盘是 zstd **多帧**追加（每次 flush 一帧），Node `zlib.zstdDecompressSync` 只解第一帧，要按 magic 逐帧解；
- `session/follow` 的快照带 `cursor`（事件 seq），可以做增量。

## 3. 四种方案

### A. 共享存储（两端指同一个 session 目录）

- 做法：手机与电脑挂同一个 DSH_HOME（SMB/WebDAV/同步盘），DSH 直接读同一份日志。
- 问题：DSH 是单进程追加日志 + 内存索引，两端同时打开会重复 seq / 覆盖 / 索引不一致；
  Android 上没有可靠的 POSIX 网络 FS；冲突没有仲裁。
- 结论：**不做**（除非 DSH 以后支持多客户端追加 + 锁）。

### B. 事件镜像（cursor 增量搬运）

- 做法：一端把 `seq > cursor` 的事件转成对端的 v4 记录追加进日志；对端重载投影。
- 需要：v4 schema 稳定、DSH 能发现外部追加（重启或 reload）、两端 seq 命名空间协商。
- 现状：DSH 没有 import RPC，只能写盘；桥的 `sessions.delete` 证明可以直接操作 session 目录，
  但**运行中写日志 + 让 DSH 看见**没有验证过，风险高（可能损坏会话）。
- 结论：**先做只读镜像**（电脑能看手机会话历史，不写入）再评估写路径。

### C. 单向接力（现状，两步都已完成）

- 手机 → 电脑、电脑 → 手机都可用；用户心智是「复制一份过去继续」，不是「同步」。
- 优点：不碰 DSH 存储，风险低，今天就能用。
- 缺点：回不去（除非再复制一次）；同一会话会分裂成两条。

### D. 等 DSH 原生能力

- 实测只有 `session/fork`（同机分叉）。如果以后有 `session/import|export|attach`，直接切过去。
- `session/fork` 现在可以考虑的产品用法：电脑侧「从这个会话分一个新分支」——和跨设备无关。

## 4. 推荐路线

1. **C 已落地**（本轮补了反向），先让 UI/文案把「复制，不是同步」说清。
2. **B-只读**：电脑的会话列表里能看见手机的会话（只读镜像，点开看历史，不能发）。
   需要先验证「外部追加日志 → DSH 重载」是否可行；不可行就停在只读缓存。
3. **真正的双向**：等 DSH 提供 import/export/attach，或把事件搬运做成 DSH 插件（桥侧插件）。
4. **A 不做**。

## 5. 反向接力实现要点（本轮）

`app/src/state/store.ts`：

```ts
async continueComputerInPhone(remoteSessionId: string): Promise<boolean> {
  // 1. 必须当前在电脑引擎上
  // 2. sessions.get 拿电脑侧完整 detail
  // 3. buildHandoff(reason:'continue_in_light', limit:8) + buildReverseSeedText
  // 4. switchToLightForHandoff()
  // 5. 轻引擎 sessions.import({ presetId: 'light', title, text, handoffId, seedMarker, replay })
  // 6. sessions.get(imported.id) → patch currentId/detail → refreshSessions
}
```

抽屉：电脑 tab 的行长按 →「在手机继续（摘要交接）」+ 二次确认（文案说明两边之后独立）。

单测：`test/handoff-reverse.test.ts` 新增两条（预设落 `light`、标题/seed 标记/replay、不建 link；
不在电脑引擎上时拒绝且不调 import）。

## 6. 待验证

- 外部追加 `session.v4.jsonl.zstd` 后 DSH 是否可见（决定 B 是否可行）；
- `session/fork` 在长会话上的耗时/体积（33 条记录/2 轮，暂未压测）；
- 轻引擎 `sessions.import` 的 replay 上限（大会话是否要截断）；
- 电脑侧 seed 会触发一轮模型回合：费用/上下文要提示（44 §2）。
