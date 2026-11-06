# 深色主题（U7）实现与验收

> 状态：2026-11-06 已实现。浅色保持 2026-11-06 之前的基线；深色按官方 Neutral 色阶。
> 运行方式、设置入口和验收命令见 [TECHNICAL §8](TECHNICAL.md)；任务状态见 [AI-TASKS](AI-TASKS.md)。

## 1. 实现形态

- `app/src/ui/theme/palette.ts`：`lightColors` / `darkColors` / `lightSemantic` / `darkSemantic`
  与 `riskTone(risk, palette)`；颜色、语法高亮、backdrop、阴影、header 半透明层都进 palette。
- `app/src/ui/theme/context.tsx`：`ThemeProvider`（按 `themeMode` + `useColorScheme()` 解析）、
  `useTheme()`、`useThemedStyles(createStyles)`；palette 和 context value 用 `useMemo` 固定。
- `AppState.themeMode`：`system` / `light` / `dark`，存在 UI cache（`dsh-palm.ui-cache`）。
  设置 → 外观 → 主题（`ui/settings/ThemeScreen.tsx`）三选一，切换即时生效。
- 所有页面把模块级 `StyleSheet.create` 改成 `createStyles(theme)` + `useThemedStyles`；
  页面内联颜色、`placeholderTextColor`、`ActivityIndicator color` 全部走 palette。
- `MarkdownView` 用 `MarkdownStylesContext` 下发「主题 + 字号」后的样式和语法高亮，
  不再使用模块级可变 `styles`；memo 子组件靠 context 更新重渲染。
- 系统层：`App.tsx` 根 View/StatusBar 按 resolved mode 切换；`LaunchOverlay` 也在 Provider 内；
  `app.json` 的 `userInterfaceStyle` 改为 `automatic`；Android `values-night/colors.xml`
  补启动窗口背景。

## 2. 迁移顺序（已完成）

1. [x] `theme.ts` 拆成 `theme/palette.ts`、`theme/context.tsx`、`theme/index.ts`；dark 按
   `#0F1115` 背景、`#151920` 面板、`#E6E8EB` 正文、`#A8B0BA` 次文字、`rgba(255,255,255,.10)` 描边。
2. [x] Chat：`ChatScreen`、`Composer`、`MarkdownView`、`chat/ChatCard`、`ApprovalCard`、
   `CapabilityCard`、`TurnView`、`JumpButton`。
3. [x] Home / Drawer / Settings + 二级页 / Features / Files / Search / Workspace / Terminal /
   Engine / ModelSheet / ProvidersCard / LightEngineScreen / GeneratedFilesSheet。
4. [x] 系统层：StatusBar、启动 Overlay、web `color-scheme`；系统查看器保持外部控制。
5. [x] 验收：浅色/深色各走设置、聊天、文件、终端、审批卡、错误横幅、Markdown 代码块。

## 3. 验收口径

- 全局搜 `#RRGGBB` / `rgba(` / `white` / `black`，只允许出现在 `theme/palette.ts`；
  `transparent` 仅用于刻意透明。
- 深色正文对比度 ≥ 4.5:1：`text #E6E8EB`、`textDim #A8B0BA`、`textFaint #8B949E`、
  `blue #7AAAFF`、`codeText #D7DBE0`；主色按钮在深色下用深色字（`onAccent #0F1115`），
  不再沿用白字。
- 切换后不重启 App；浅色模式与本轮之前的截图一致。
- `npm --prefix app run typecheck` + `npm run verify` 全绿。
- 2026-11-06 Web 验收：浅色/深色各截设置首页、主题页、聊天、审批卡、文件页；
  系统跟随在 `prefers-color-scheme` 切换时即时更新。
- 2026-11-06 真机验收（并行安装测试包 `cool.cnb.dshpalm.test`，不动 release 数据）：
  深色 `device:regression` **10/10 通过**（冷启动/抽屉/全部功能/文件/设置/引擎启停/全文搜索）；
  浅色轮次待补。

## 4. 为什么不更早做

这是跨 15+ 页面、40+ StyleSheet 的样式架构改造，不是单点开关。先前按「一轮一个可验收项」
先做字号档和动效；深色单独一轮完成，避免半迁移时两套主题混用。
