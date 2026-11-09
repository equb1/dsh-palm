# 品牌视觉与交互细节（U7 / 2026-11-07）

> 目标：去掉“AI Demo 拼贴感”，建立统一的锦囊品牌图标、首页顶栏、等待/思考/复制反馈。
> 实现不依赖图标字体：`react-native-svg` + `lucide-react-native`（线性图标）+ 自绘 BrandMark。

## 1. 图标系统

- `app/src/ui/components/BrandIcon.tsx`
  - `BrandIcon`：统一 1.8px 线性图标，26+ 语义（设置、思考、工具、操作、引擎、文件…）。
  - `BrandMark`：原生 SVG 画的“锦囊囊袋 + 抽绳”品牌主视觉，不再用汉字圆盘。
- `IconButton` 支持 `icon?: BrandIconName`，旧 `glyph` 保留兼容；新调用统一走 BrandIcon。
- 设置页按 `row.id` 映射图标（`SettingsTile.tsx` 的 `SETTING_ICONS`），全部功能页按卡片 id 映射
  （`FeaturesScreen.tsx` 的 `FEATURE_ICONS`）。
- 语言/颜色仍走 palette：图标只继承 `tone.fg`，不写死颜色；深色/浅色都能用。

## 2. 首页顶栏

旧版：菜单 + 金色“锦”字圆盘 + “锦囊” + 连接状态 + 轻/完整切换 + 模型胶囊，信息重复且两个
点击区域语义冲突。

新版（`HomeScreen.tsx`）：

```
[ ≡ ]   [ BrandMark 锦囊 ]        [ ● ⚡ 轻模式 ]
         [ 模型 chat ▾ ]
```

- 左侧只留菜单。
- 中间是 BrandMark + 品牌名，下一行是当前模型胶囊（点开 ModelSheet）。
- 右侧只有一个运行模式胶囊，点开 `运行模式` 底部弹层：
  - 轻模式：秒开、省电；
  - 完整模式：Python/Linux/Office；
  - 连接电脑宿主：进扫描/手填连接页。
- 连接状态只作为胶囊上的小圆点（绿/黄/红），不再单独堆一行。
- 底部弹层用 `BottomSheet`：遮罩淡入 + 面板弹簧滑出。

## 3. 首页问候：打字机 + 循环提示

- `components/TypewriterText.tsx`
  - `TypewriterText`：主标题“需要我做点什么？”从空逐字打出，带蓝色光标。
  - `RotatingHint`：副标题在 4 条灵感提示间循环“输入 → 停留 2.6s → 退格 → 下一句”。
- 首页处于页面栈非顶层时（进聊天/设置），`ScreenActiveContext` 会让定时器暂停，不在后台空转。
- 标题/副标题预留 `minHeight`，打字过程中不会推挤下面的最近会话。

## 4. 回到底部

- `ui/chat/JumpButton.tsx` 重做：
  - 自绘 45° 下箭头（BrandIcon `arrowDown`），去掉字符 `↓` 和粗糙蓝框。
  - 出现：弹簧 `scale 0.72→1` + `translateY 14→0` + 淡入；消失反向。
  - 流式生成中箭头做 ±2px 上下浮动，右上角 6px 蓝点提示“下面还在生成”。
  - 常驻挂载、`pointerEvents` 控制，不再硬闪/硬卸载。

## 5. 思考中

- `ui/chat/TurnView.tsx`
  - `ThinkingGlyph`：思考中四芒星匀速旋转（2.4s/圈），结束后静止灰色。
  - `ThinkingDots`：3 颗 4px 蓝点按 0/140/280ms 相位差上下跳动。
  - 展开/收起箭头改为 BrandIcon Chevron，按状态旋转。
  - 工具行按工具类型换图标（终端 / 文件 / 搜索 / 图片 / 通用）。

## 6. 长按复制

- 用户气泡（`TurnView.tsx` 的 `<Text>`）加 `selectable`。
- AI 正文（`MarkdownView.tsx` 的 `InlineText` 顶层 `<Text>`、代码块 `<Text>`）加 `selectable`；
  标题、列表、表格单元格都走 `InlineText`，所以都能长按选词复制。
- AI 回复底部操作栏从 `⧉/↗` 符号改成 `[复制] [分享]` 胶囊，复制后变绿色 `[✓ 已复制]`。

## 7. 验收

- 设置页、全部功能页、聊天页顶栏/思考/工具/回到底部真机截图检查。
- `npm --prefix app run typecheck`、`npm run verify` 全绿。
- 长按用户气泡/AI 段落能拉出系统选择手柄；复制按钮有反馈。
- 打字机/循环提示在进聊天后停止；返回首页不重排布局。
- 新增依赖：`react-native-svg`（Expo 58 兼容版本）、`lucide-react-native`。

## 8. 应用图标、落地页与展示资产（2026-11-09）

- **应用图标**：`scripts/build-icons.mjs` 生成一套「锦囊袋 + 金色抽绳 + 四芒星」图标。
  - 落地页：`site/assets/icon.svg`、`icon-512.png`、`icon-192.png`、`apple-touch-icon.png`、`favicon-32.png`。
  - Android 自适应图标：`mipmap-*/ic_launcher_foreground.png` + `ic_launcher_monochrome.png`，
    `mipmap-anydpi-v26/ic_launcher.xml` 使用 `@color/ic_launcher_background`（`#141C31`）。
  - 旧版桌面图标与启动屏：同步替换 `mipmap-*/ic_launcher*.webp`、`drawable-*/splashscreen_logo.png`；
    启动屏改用 `drawable/splash_background.xml` 居中显示，避免 bitmap 被拉伸。
  - 脚本依赖按需安装：`npm install --no-save --no-package-lock sharp qrcode`。
- **README / 落地页展示图**：`scripts/build-site-assets.mjs` 生成明暗双版 Hero（中/英）与三张功能展示图，
  同时把桌宠 sprite sheet 复制到 `site/assets/pets/` 并裁出 README 用的静态预览帧。
  GitHub 仓库 Social preview 使用 `site/assets/social-preview.png`（1280×640），在仓库 Settings → General 上传。
- **落地页**：Material Design 3 风格，支持 4 套 Material You 种子色、明暗主题、可交互手机演示
  （轻引擎 / proot / 桌宠 / 连电脑）、可点击审批卡与桌宠 12 态互动展台。
- **发布元数据**：`scripts/release-android.ps1` 构建完成后把 APK 复制到 `dist/`，
  并由 `scripts/write-release-meta.mjs` 生成 `site/assets/release.json`（版本、大小、SHA-256、直链）。
  落地页读取该文件展示下载信息；APK 仍需手动上传到 GitHub Releases。
