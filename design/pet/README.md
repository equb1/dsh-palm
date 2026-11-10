# 桌宠「小寄」设计稿

品牌：Crabstack / 蟹栈；桌宠：小寄（寄居蟹 + 便携工作台壳）。

| 文件 | 说明 |
| --- | --- |
| `<state>-1024.png` | 原始稿（1024×1024，白底，来自 Nano Banana 生成） |
| `<state>-512.png` | 应用内使用（512×512，透明底） |
| `<state>-256.png` | 小尺寸导出（256×256，透明底） |
| `contact-sheet.png` | 排版参考 |

状态：`idle` / `thinking` / `working` / `success` / `error` / `sleeping`。

运行时素材在 `app/assets/pets/xiaoji/`（512 + pack.json），
接入说明见 `docs/BRAND-PET.md`。

重新生成透明版：`node D:\pet-tools\process-pet.cjs`（需要 sharp）。
