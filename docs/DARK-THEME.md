# 深色主题改造方案（U7 剩余项）

> 状态：2026-11-06。**尚未实现**。U7 的字号档、页面淡入、设置行按压已完成；深色主题是最后一项。
> 本文记录为什么不在这几轮硬做，以及后续怎么安全落地。

## 1. 现状

- `app/src/ui/theme.ts` 只有一套浅色 token（`colors` / `semantic`）；所有页面在模块加载时
  `StyleSheet.create({...})`，颜色是**字面量快照**。
- 全 App 约 15 个页面、几十个 StyleSheet，直接改 `colors` 的值不会让已创建的样式更新。
- 因此不存在“加一个开关 + 调几个颜色”就能正确切深色；硬做会出现「背景黑了、文字还是深灰」的
  半成品，比不做更糟。

## 2. 目标形态

```tsx
// theme/context.tsx
type ThemeMode = 'light' | 'dark';
const ThemeContext = createContext<{ mode: ThemeMode; colors: Palette; semantic: Semantic }>(...);
export function useTheme(): ThemeContextValue;

// 每个页面
const styles = useThemedStyles(createStyles); // createStyles(colors) => StyleSheet
```

- `createStyles(theme)` 是纯函数，按当前 palette 重建 StyleSheet；
- 页面里不再直接 import `colors`；一律走 `useTheme()`/`useThemedStyles()`；
- 根节点按 mode 切换 `StatusBar`、`bg`、`LaunchOverlay`；
- 系统深色/浅色可做「跟随系统」+ 手动覆盖，存 UI cache（与 `chatFontScale` 同一处）。

## 3. 迁移顺序（每步可独立验收）

1. `theme.ts` 拆成 `theme/light.ts`、`theme/dark.ts`、`theme/index.ts`；dark 先按官方 Neutral 色阶
   对齐（背景 #0F1115、面板 #151920、文字 #E6E8EB、次文字 #A8B0BA、边框 rgba(255,255,255,.10)）。
2. 先迁 **Chat 相关**：`ChatScreen`、`TurnView`、`MarkdownView`、`Composer`、`ChatCard` —— 阅读面最大，
   深色收益最高。
3. 再迁 **Home / Drawer / Settings + 二级页 / Features / Files / Search / Workspace / Terminal /
   Engine**。
4. 最后处理系统层：StatusBar、启动 Overlay、系统查看器（外部不可控，保持浅色即可）、图片
   （深色下加轻微提亮/降低对比度可选）。
5. 真机验收：浅色/深色各跑 `npm run device:regression` 10 步；深色下检查聊天、设置、文件、终端、
   审批卡、错误横幅、Markdown 代码块。

## 4. 验收口径

- 没有硬编码浅色残留（全局搜 `#FFF`/`#FFFFFF`/`rgba(0,0,0` 只允许出现在 token 或刻意的高光里）；
- 两套主题对比度 ≥ 4.5:1（正文）；
- 切换后不需要重启 App（样式随 context 重建）；
- 浅色模式与本轮之前的截图一致（不能为了深色改浅色）。

## 5. 为什么本轮不硬做

- 这是跨 15+ 文件的样式架构改造，不是单点功能；在当前「一轮一个可验收项」的节奏里，
  半迁会造成两套主题混用、回归面反而更大。
- 更安全的做法是单独排一轮（或几轮）按上面的顺序做，每迁完一组就跑一次 10 步回归 + 截图。

在深色主题落地前，App 保持**浅色固定**；字号档与动效已经可用。
