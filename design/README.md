# Crabstack / 蟹栈 — 品牌资产

> 冻结日期：2026-11-10。  
> 品牌：**Crabstack / 蟹栈**  
> 桌宠：**小寄**  
> Slogan：**合上就走，打开就干。**  
> 插件副线：**换个壳，继续干活。**

## 颜色

| 角色 | 色值 |
|---|---|
| 主蓝 | `#4176E6` |
| 米白 | `#F7F3EA` |
| 墨色 | `#111827` |
| 黄铜 | `#C9A46A` |

## 目录

```
design/
├── source/                  # Nano Banana 原图（JPG）
├── icons/
│   ├── icon-ios-1024.png    # 主 App 图标（米白底，iOS 1024）
│   ├── icon-512/192/144/96/72/48.png
│   ├── icon-transparent-1024.png
│   ├── icon-source-trimmed.png
│   ├── android-foreground-1024.png
│   ├── android-background-1024.png
│   ├── android-monochrome-1024.png
│   ├── notification-96.png
│   └── icon-tile-blue-1024.png  # 可选；蓝底白边未完全干净，正式用请描矢量
├── pet/
│   ├── idle/thinking/working/success/error/sleeping-1024.png
│   ├── *-512.png
│   └── contact-sheet-cream.png
└── lockup/
    ├── horizontal-cream.png
    ├── horizontal-transparent.png
    ├── horizontal-blue.png
    ├── stacked-cream.png
    └── stacked-transparent.png
```

## 使用

- **App 图标**：`icon-ios-1024.png` / `icon-512.png`；Android 用 `android-foreground-1024.png` + `android-background-1024.png`。
- **Android themed icon**：`android-monochrome-1024.png`（透明 alpha，系统染色）。
- **桌宠**：`pet/*-1024.png` 透明背景。生成 sprite sheet 用
  `python3 scripts/build-pet-sheets.py`（会去掉 `working` 右侧重复悬浮屏、alpha 预乘防白边），
  输出 `app/assets/pets/xiaoji/`；12 态动画映射见 `docs/BRAND-PET.md`。
- **Lockup**：`design/lockup/*` 是排版底稿；中文使用 Hiragino Sans GB W6、英文 Helvetica Neue Bold，最终请换品牌字库。

## 注意

- `source/` 是 Nano Banana 生成的位图，**正式发布前建议描成 SVG**；当前 PNG 是可用预览/临时资产。
- `icon-tile-blue-1024.png` 在深蓝底上仍有轻微白边（去背残留）；正式蓝底请用矢量版。
- 中文字标不要再用 AI 生成；在 Figma / Illustrator 里用真实字体排。
- `design/` 目前未提交到 git；确认后再决定是否入库（二进制素材建议单独 release/设计仓）。
