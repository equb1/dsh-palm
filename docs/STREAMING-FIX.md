# 锦囊 · 长会话流式输出修复方案

> 状态：2026-11-04 主体完成，20 分钟 soak 待补。对应 `PITFALLS.md` H7、`AI-TASKS.md` U9。
> 本文是长流式问题的实施方案与验收记录；产品需求、实现机制、任务状态仍分别以四篇主文档为准。

## 1. 问题定性

长会话流式输出不是单纯的 `ScrollView` 性能问题，而是三类问题叠加：

1. **数据一致性**：快照与实时事件的 `runId/turnId/blockId` 没有完全统一，导致重复思考、重进丢失或重复。
2. **渲染成本**：每个 token 都可能触发全聊天页更新、内容去重、字符串复制和 Markdown 尾部解析。
3. **布局与滚动竞争**：`ScrollView` 全量布局，最后一行持续长高，同时自动追底、用户滚动、键盘避让都在改位置。

不能只换 `FlatList`，也不应继续增加 `cleanTurns` 的内容猜测规则。

## 2. 代码确认到的事实

- `engine/src/real/server.ts`：`liveTurn.runId` 优先使用 `turn:<n>`，但 `run.started/run.finished` 使用 `attemptId` 形式的 `liveRunId`，同一条链路存在两套 runId。
- `sessions.get` 只按 `turn.id` 判断实时回合是否已存在，同 run、不同 id 时仍可能先追加重复回合。
- `project.ts` 会把所有没有 `turn/end` 的回合直接标成 `done`，无法区分“历史记录缺少结束事件”和“当前仍在运行”。
- `store.ts` 仍然直接修改 `block.text` 或 `turn.blocks[i]`；直接加 `React.memo` 会导致引用不变或比较成本很高。
- `ChatScreen.tsx` 的 `cleanTurns` 依赖 `state.version`，每次 token 提交都会重新执行整轮回合去重。
- `MarkdownView.tsx` 虽缓存了 stable/tail 解析结果，但每次仍重新创建全部块元素。

推荐顺序：**先统一身份和状态，再做不可变更新与 memo，最后替换列表和滚动**。否则 `FlatList` 的不稳定 key 和重复数据会继续造成重挂载、跳动。

## 3. 阶段 1：统一 run/turn/block 身份

### 3.1 桥层唯一标识

- 有宿主 `turn` 号时，统一使用 `runId = turn:<n>`；没有时使用 `attemptId` 或生成的 UUID。
- `run.started`、`block.appended`、`block.delta`、`block.updated`、`run.finished`、实时 `Turn.runId`、快照投影全部使用同一个值。
- `turnId` 由该 runId 派生并保持不变。
- 文本/思考块统一成 `runId + contentIndex`，工具块优先使用 `callId`。

修改范围：

- `engine/src/real/server.ts`
- `engine/src/real/project.ts`
- 必要时补充协议注释，但不改变协议版本。

### 3.2 快照与实时数据按 runId 合并

`sessions.get` 不得只按 `turn.id` 判断后追加：

- 相同 `runId`：合并为同一回合；
- 活跃实时块优先于快照中的前缀旧值；
- 相同 block id：保留内容更长或更新的版本；
- 不同 runId：即使都在 streaming，也绝不合并；
- 项目结束状态由 `turn/end` 和会话运行状态决定，不能无条件把未结束记录标成 `done`。

### 3.3 客户端收口重复猜测

- store 成为唯一的回合归一化位置；
- `run.finished` 按事件里的 `runId` 收尾对应回合；
- 新协议数据不再依赖“两个 streaming 就是同 run”；
- 前缀相同合并只作为旧宿主兼容兜底，并限制在相邻、同 run 或明确缺少 runId 的旧数据中；
- 删除 `ChatScreen` 每 token 执行的 `cleanTurns/dedupeBlocks`；
- 列表 key 使用稳定的 `runId ?? turn.id`，避免合并前后 key 改变导致整行重挂载。

验收：重复思考、重进丢失、跨 run 错合并归零。

## 4. 阶段 2：流式状态与 Markdown 优化

### 4.1 局部不可变更新

每次 flush：

- 只替换活跃 turn、活跃 block 及必要父数组的引用；
- 其他历史 turn/block 保持原引用；
- `block.updated` 同样不直接改数组元素；
- 保留微任务提交，**不退回 50ms 或 rAF 数据攒批**。

### 4.2 chunk 缓冲

store 私有流式缓冲使用：

```text
blockId → { chunks: string[], length: number }
```

- 收到 delta 只 push chunk；
- flush 时只物化活跃块需要渲染的内容；
- 协议和落盘模型仍使用字符串；
- `replace` 清空旧 chunks；
- thinking 的 24000 字限制继续保留。

目标描述：chunk 消除 store 追加时的重复字符串复制；活跃 Markdown 仍依靠 stable/tail 限制解析和渲染范围。

### 4.3 memo 化

- `TurnView` 使用 `React.memo`，turn 引用、相关 approval、必要回调未变时跳过；
- 回调使用稳定引用；
- Markdown 的 stable 区块和 tail 区块分开渲染；
- 稳定块使用 memo 化 `BlockView`；
- tail 才随 token 更新；
- 不使用数组下标作为长期稳定身份。

理想渲染范围：ChatScreen 浅更新 → 活跃 TurnView → 活跃 Markdown tail，其余历史内容零渲染。

## 5. 阶段 3：FlatList 与滚动状态机

第一版直接使用 RN 自带 `FlatList`，暂不引入 `KeyboardChatScrollView` 新依赖；真机验证仍不足时再评估。

### 5.1 列表虚拟化

- `data = turns`；
- `keyExtractor = runId ?? id`；
- `renderItem` 返回 memo 化的 `TurnView`；
- 空会话内容放到 `ListEmptyComponent`；
- 底部预留空间放到稳定的 `ListFooterComponent`；
- 调整 `initialNumToRender`、`windowSize`、`maxToRenderPerBatch`；
- 开启并验证 `maintainVisibleContentPosition`；
- Android 的 `removeClippedSubviews` 等选项实机验证后再决定。

### 5.2 follow 状态机

状态：

- `following`：是否允许自动追底；
- `userDragging`：用户是否正在拖动；
- `showJump`：是否显示回到底部按钮。

规则：

- 用户开始上滑后立即停止自动追底；
- 内容增长、键盘事件不能把 `following` 自动改回 true；
- 只有用户明确回到底部，或点击“回到底部”，才恢复跟随；
- 自动追底只操作滚动，不做动画，并用一次 rAF 合并滚动调用；
- 键盘只由 `SmoothKeyboardAvoid` 负责布局，列表仅在 `following` 时调整位置；
- blankSpace 尺寸只在视口变化时更新，不随 token 更新。

## 6. 验证

### 6.1 自动化

1. 同 run 的快照前缀 + 实时完整块，只生成一个 turn/block；
2. 不同 run 即使同时 streaming，也不能合并；
3. 快照与实时 turnId 不同但 runId 相同，仍能正确合并；
4. 退出重进后 live 思考保留且只有一份；
5. `run.finished` 只结束对应 run，列表与 detail 同时变为 idle；
6. append/replace 交错不会丢字或回退；
7. 大量 delta 后 chunk 物化结果与直接拼接一致；
8. 已完成 TurnView/Markdown stable 块在活跃 token 更新时不重复渲染。

### 6.2 回放与真机

增加确定性回放，覆盖多轮思考/正文、工具、快照与实时 id 不一致、多次 `sessions.get`、数万 delta、多次退出重进。CI 压缩时间执行，另保留一次真机 20 分钟 soak。

真机验收：

- 全程只有一个蓝色“思考中”；
- 上滑阅读时不被抢回底部；
- 点击回到底部后恢复跟随；
- 键盘反复弹出、收起不抖；
- 流式期间退出重进至少 3 次，不丢、不重；
- 完成后只有一个“已完成”和一个用时；
- 会话列表 preview/status 与详情一致；
- 无 duplicate key、明显长任务卡顿或 OOM。

每个阶段执行：

```bash
npm --prefix app run typecheck
npm run verify
```

桥层变更后还要执行 `node scripts/build-bridge.mjs`，并确认设备实际加载的是新桥。

## 7. 落地顺序

1. `fix/stream-run-identity`：统一 runId/blockId、快照与 live 合并、结束状态，补正确性测试。
2. `perf/stream-state-markdown`：局部不可变更新、chunk 缓冲、TurnView/BlockView memo。
3. `perf/chat-flatlist-scroll`：FlatList、blankSpace、follow 状态机和真机长任务验证。

核心原则：**先让数据唯一且 key 稳定，再减少渲染，最后解决列表布局。不要继续用内容去重掩盖身份问题，也不要用延迟攒批掩盖渲染问题。**

## 8. 实施记录

### 8.1 已完成

- [x] 阶段 1：身份统一与合并
  - 新增 `app/src/protocol/turns.ts`，桥和客户端共用 runId/blockId、同 run 合并、跨 run 隔离规则。
  - 桥层 `runId` 统一为 `turn:<n>`；assistant turn id 同步 canonical 化。
  - 快照与 live 回合按 runId 合并；活跃会话不再被投影错误标成 done。
  - `sessions.get/rename/setPermission/setModel` 都带回当前 live 回合。
  - 客户端删除 `ChatScreen` 里的逐 token `cleanTurns/dedupeBlocks`，由 store 统一归一化。
- [x] 阶段 2：状态与 Markdown
  - `block.delta` 改为 chunk 数组缓冲，flush 时只替换活跃 turn/block 引用。
  - `block.delta replace` 与 `block.updated` 全部改成不可变更新。
  - `TurnView`、`AssistantTurn`、`ThinkingRow`、`ToolRow`、`MarkdownView`、稳定 Markdown `BlockList` 已 memo 化。
  - stable/tail 分开渲染，稳定块引用不变时随 token 更新不重渲染。
- [x] 阶段 3：FlatList 与滚动
  - `ChatScreen` 从 `ScrollView` 换成 `FlatList`，加入稳定 key、footer blankSpace、虚拟化参数。
  - 追底改为 follow 状态机：触摸开始、拖拽离底冻结；回到底部或点按钮恢复。
  - 程序滚动期间的测量修正不再误判成用户拖拽。
  - 跳到底部按钮移入列表容器，键盘弹出时仍位于 Composer 上方。
- [x] 自动化验证
  - `npm run verify` 全绿（数量以命令输出为准）。
  - 新增 `test/stream-turns.test.ts`：canonical 身份、快照/live 合并、跨 run 隔离、重进、替换、收尾、2 万 delta、重复 appended。
  - 新增 `scripts/stream-replay.ts`：10 万 delta 回放通过，约 20ms。
- [x] 桥与 APK
  - `node scripts/build-bridge.mjs` 已重新生成并同步 APK asset。
  - `:app:assembleDebug` 构建成功。
- [x] 真机长流验证（PLR110 / Android 16 / 无线 adb）
  - 工具密集回合（web_search/fetch/多个 thinking）不再出现同段思考两份。
  - 流式中上滑后 6 秒内容保持不动，不再被抢回底部。
  - “回到底部”按钮在键盘上方可见，点击后隐藏并回到最新内容。
  - 退出重进后未出现重复思考。

### 8.2 实施中额外发现

1. **实时 block id 跨步骤撞车**：同一个 run 的每个 assistant-stream 步骤都从 `block index 0` 重新开始，原 id 会重复。现在实时 id 带上 step：`<runId>:live:<step>:b<index>`。
2. **程序滚动/测量修正误冻结追底**：仅靠 offset 变化判断用户上滑，会被 FlatList 动态测量修正误触发。现在必须真实触摸 + `onScrollBeginDrag` 才进入用户拖拽状态。
3. **键盘弹出时跳到底部按钮被盖住**：按钮从 `SmoothKeyboardAvoid` 的绝对定位移入列表容器，始终在 Composer 上方。

### 8.3 仍待完成

- [ ] 真机 20 分钟连续 soak（工具 + 多次重进 + 键盘反复开关）；本轮已完成 3000 字、工具密集长流验证，但未达到 20 分钟。
- [ ] 安装包统一签名后直接 `adb install -r` 验证 APK 内新桥；本轮设备旧包签名不同，按 `PITFALLS.md` E8 使用 Metro + 手动更新 rootfs 桥验证。
- [ ] 观察 `VirtualizedList` 的 slow update 警告；当前不阻塞交互，后续结合性能基准再调窗口参数。

### 8.4 验证命令

```bash
npm --prefix app run typecheck
npm run verify
npm run stream:replay -- 100000
node scripts/build-bridge.mjs
```

### 8.5 四篇主文档回写

- [x] REQUIREMENTS：补长会话流式体验验收项。
- [x] TECHNICAL：更新聊天渲染和滚动机制。
- [x] PITFALLS：更新 H7 并记录新的追底/block id 坑。
- [x] AI-TASKS：更新 U9、基线状态和剩余验证项。
