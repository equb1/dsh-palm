# 交互动效方案（U7 / 2026-11-07）

> 目标：参考 WorkBuddy / 主流 AI 客户端手机端的手感，让页面切换有方向、
> 抽屉跟手、弹层不拖沓。**不引入 Reanimated / 原生 C++ 依赖**，只用 RN 内置
> `Animated` + `PanResponder` + `useNativeDriver`。

## 1. 之前为什么卡、为什么像“雪花”

1. **页面切换是单容器条件替换**
   `App.tsx` 用 `view === ... ? <A/> : <B/>` 选屏，旧页在 0ms 内卸载；`ScreenFade`
   又先在 render 阶段以 `opacity: 1` 画一帧，再在 `useEffect` 里 `setValue(0)`，
   于是出现「旧页秒没 → 新页闪一帧 → 变透明 → 淡入」。没有 Push/Pop 方向，
   重页面（聊天/设置）挂载还会和动画抢帧。
2. **点会话要等请求**
   `store.openSession()` 先 `await sessions.get`，数据回来才 `patch({detail})`；
   手指抬起后要等 IPC 才看到页面开始动。
3. **抽屉开关时整棵树同时挂载**
   抽屉关闭即卸载；展开时 129 个原生 View 的 mount/layout 与 200ms 位移动画同帧，
   还会在首帧申请整块 `renderToHardwareTextureAndroid` 纹理。
4. **每次 store patch 重算列表**
   `sessionRows()`、搜索、筛选、分组在每次渲染重算，首页和抽屉都订阅整份 store。

## 2. 现在的实现

### 2.1 页面栈：`ScreenStack` 取代 `ScreenFade`
文件：`app/src/ui/components/ScreenStack.tsx`

- 真正的页面栈：前进时新页从右侧滑入，旧页左移 24% + 18% 黑色遮罩；
  返回时当前页向右滑出，目标页从 -24% 回到 0。
- 只动 `translateX` / `opacity`，全部 `useNativeDriver: true`。
- 旧页在动画结束后用 `display: none` 隐藏（不卸载），返回时恢复，滚动位置/
  输入态不丢。
- 非当前页用 `ScreenActiveContext` 冻结 `useStore` 订阅（`app/src/ui/useStore.ts`），
  详情页流式输出时底下的首页/设置页不再跟着重渲染。
- 详情页在栈里固定为 `main:detail`，在聊天页里换会话不会反复 push。
- 动画由 `motion.spring.page` 驱动，约 300ms 收敛，无 overshoot。

### 2.2 点会话立刻进详情
文件：`app/src/state/store.ts` 的 `openSession()`

- 点击瞬间先用 `SessionSummary` 造一个 `detail` 空壳（`turns: []`）并同步
  `patch`，`ScreenStack` 立刻开始推入详情页；`sessions.get` 在转场期间并行拉。
- `AppState.detailLoading` 控制聊天页空态「正在打开会话…」，数据回来再填满。
- `ChatScreen` 顶栏初始高度固定为 `topInset + 52`，避免首帧 `onLayout` 后整体下跳；
  `FlatList` 首屏从 12 条降到 8 条，后续按批补齐。

### 2.3 抽屉：弹簧 + 跟手 + 首页视差
文件：`app/src/ui/SessionDrawer.tsx`、`HomeScreen.tsx`

- 展开/收起从 `Animated.timing(200ms)` 改为 `motion.spring.sheet`（约 300ms）。
- 抽屉与首页主体共享同一个 `Animated.Value`：抽屉滑入时首页右移 42px，
  形成“推开”而不是一块死板面板。
- `PanResponder`：打开状态下左滑跟手；松手按位移/速度决定回弹或关闭。
- 空闲 350ms 预挂载抽屉内容；关闭只移出屏幕（`pointerEvents: none`），
  不再每次展开重建 129 个 View。
- 首帧不再使用 `renderToHardwareTextureAndroid` 大纹理。
- `sessionRows`/搜索/筛选/分组用 `useMemo` 缓存。

### 2.4 设置二级页
文件：`app/src/ui/SettingsScreen.tsx`

- 设置首页与账号/引擎/提供商/宿主/实验室等二级页也走 `ScreenStack`；
  二级页从右侧推入，返回时滑回，设置首页滚动位置保留。
- 二级页关闭后 `display: none`，不再整页重挂载。

### 2.5 底部弹层
文件：`app/src/ui/components/BottomSheet.tsx`、`ModelSheet.tsx`、
`GeneratedFilesSheet.tsx`

- 遮罩原地淡入，面板单独从底部弹簧滑出；关闭时面板下滑、遮罩淡出。
- 不再使用 `<Modal animationType="slide">` 把遮罩和面板一起推上来。
- 面板挂载与首次动画错开一帧，避免首帧抢布局。

## 3. 动效 token

文件：`app/src/ui/theme/palette.ts`

| 场景 | 参数 |
|---|---|
| 页面 push/pop | `motion.spring.page`：stiffness 600 / damping 44 / mass 0.9 |
| 抽屉、底部弹层 | `motion.spring.sheet`：stiffness 700 / damping 46 / mass 0.9 |
| 轻量内容切换 | `motion.duration.fast` (100ms) + `motion.easing.decelerate` |
| 按压反馈 | 按下 `fast` 缩到 0.975，松手 spring 回 1 |

## 4. 验收与实测

- `npm --prefix app run typecheck`：通过。
- `npm run verify`：全绿（数量以命令输出为准）。
- 抽屉 8 次开合（PLR110，`dumpsys gfxinfo`）：
  - 优化前：Janky 14/218（6.42%），95th 21ms；
  - 预挂载后：Janky 8/228（3.51%），95th 16ms；
  - 加视差/弹簧后：Janky 11/304（约 3.6%），95th 14ms；
  - 单独展开 5 次：**5 次全部 0 janky frame**；关闭 5 次 4 次 0、1 次 1 帧。
- 页面 push 每次约 1 帧超时（首帧挂载聊天页），已从“闪白”降为一次小 hitch；
  继续优化可把 `ModelSheet`/附件面板延迟到转场结束挂载。
- 设置二级页进入/返回、ModelSheet、GeneratedFilesSheet 真机已手工通过。

## 5. 仍未做 / 后续

- iOS 上 `Animated.spring` 的物理参数需要单独调；当前只覆盖 Android。
- 首页左缘右滑打开抽屉、抽屉内右滑返回尚未做（只做了左滑关闭）。
- 共享元素转场（会话卡片 → 聊天页顶栏）未做；当前是页面级 push/pop。
- 页面 push 的首帧 jank 仍可继续压：延后非首屏组件、selector 化 store。
- 无障碍树已通过 `display:none` 隔离非当前页；仍需 TalkBack 真机走查。
