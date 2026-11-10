# 品牌与桌宠交接：Crabstack / 蟹栈

> 状态：2026-11-10。  
> 用途：给接手品牌资产、App 图标、桌宠的 AI/开发者。  
> 先读 [AI-TASKS](AI-TASKS.md) 的规则与命令；本文只负责品牌与桌宠，不重复任务清单。

## 0. 一句话

- **英文名**：Crabstack
- **中文名**：蟹栈
- **桌宠**：小寄（寄居蟹）
- **主 Slogan**：Carry your stack.
- **中文 Slogan**：把整套工具，背在壳里。
- **产品 Slogan**：合上就走，打开就干。

## 1. 品牌决策（已冻结）

### 1.1 名字

`Crabstack = Crab + Stack`：

- Crab：寄居蟹，对应“背着壳走”的移动工作台；
- Stack：技术栈/工具堆/插件堆，开发者一听就懂；
- 两个词有反差，比 `Shellbench` 好记，也比“锦囊”更适合英文传播。

已废弃的品牌名：

| 名字 | 状态 | 原因 |
|---|---|---|
| 壳台 / Shellbench | ❌ 不用 | 太像说明书，没有记忆点 |
| Shellhop | ❌ 不用 | 已有网络 relay 术语 |
| Shelldock | ❌ 不用 | 已有 Snap 包/Product Hunt 产品 |
| Reshell | ❌ 不用 | 有 ReShell 项目/恶意软件同名记录 |
| Paguro | ❌ 不用 | 难拼难念，且已有 Paguro Upcycle |

### 1.2 重要：不要把「锦囊」全局替换

`锦囊` 现在仍然是一个**功能名**，指预设/playbook（例如“选择锦囊”“当前锦囊”“从锦囊里选一个”）。

- 品牌名：**Crabstack / 蟹栈**
- 功能名：**锦囊**（保留）
- 桌宠名：**小寄**
- 插件动作：**换壳**

改品牌时只改品牌位，不要批量把 `锦囊` 替换掉，否则预设功能会失去名字。

### 1.3 品牌语气

- 工具、可靠、随身、略可爱，但不幼稚；
- 社区项目，不冒充官方；
- 不复制 DeepSeek 鲸鱼、DSH Go 的鱼尾+气泡、机器人、聊天气泡、大脑、通用 sparkle。

### 1.4 颜色

| 角色 | 色值 |
|---|---|
| 主蓝 | `#4176E6` |
| 米白 | `#F7F3EA` |
| 墨色 | `#111827` |
| 黄铜 | `#C9A46A` |

## 2. 已入库资产

### 2.1 App 图标

已冻结的图标：**闭合工作台壳 + 两只眼睛 + 一只钳子 + 方形插件口 + 半插模块**。

已入库：

```
app/assets/icon.png                 # 1024，米白底，iOS/商店
app/assets/adaptive-icon.png        # 1024，透明前景
app/assets/monochrome-icon.png      # 1024，单色/主题图标
app/android/app/src/main/res/
  mipmap-mdpi..xxxhdpi/
    ic_launcher.webp
    ic_launcher_round.webp
    ic_launcher_foreground.webp
    ic_launcher_monochrome.webp
  mipmap-anydpi-v26/
    ic_launcher.xml
    ic_launcher_round.xml
  values/ic_launcher_background.xml # #F7F3EA
```

`app.json`：

```json
{
  "expo": {
    "name": "Crabstack",
    "icon": "./assets/icon.png",
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#F7F3EA",
        "monochromeImage": "./assets/monochrome-icon.png"
      }
    }
  }
}
```

验证命令：

```bash
PATH="/opt/homebrew/bin:$PATH" npm --prefix app run typecheck
PATH="/opt/homebrew/bin:$PATH" npm run verify
cd app/android && sh gradlew :app:assembleDebug
aapt2 dump badging app-debug.apk | grep '^application:'
# label='Crabstack' icon='res/mipmap-anydpi-v26/ic_launcher.xml'
```

### 2.2 设计源（未入库）

`design/` 约 11MB，目前是本地未跟踪目录：

```
design/source/    # Nano Banana 原始 JPG
design/icons/     # 主图标、单色、48..1024、adaptive 源
design/pet/       # 小寄 6 状态 1024/512 + contact sheet
design/lockup/    # horizontal/stacked，蟹栈 + CRABSTACK
design/README.md
```

注意事项：

- 设计源是**位图**，正式发布前建议描 SVG；
- `design/icons/icon-tile-blue-1024.png` 深蓝底有轻微白边，不要当正式资产；
- lockup 使用 Hiragino Sans GB + Helvetica Neue，是排版底稿，最终换品牌字库；
- 中文字标不要用 AI 生成，用 Figma/Illustrator 排版；
- 如果另一个 AI 从仓库 clone，`design/` 不存在；先用本文提示词重生成，或让维护者提供设计包。

## 3. 打包与热更新决策

### 3.1 现状：没有 OTA

项目当前：

- 没有 `expo-updates`；
- 没有自定义 JS bundle 下载/切换；
- 没有桌宠渲染代码（`app/assets/pets` 里是旧素材，不是本品牌）。

所以 **现在不能靠热更新加桌宠代码**。

### 3.2 三种桌宠形态

| 形态 | 需要什么 | 能否热更新 |
|---|---|---|
| App 内桌宠（RN 组件） | JS 组件 + 图片/Lottie/Rive | 有 OTA 才能更新代码；没有 OTA 要新 APK |
| 只换美术资源 | APK 里先有通用渲染器 + 资源加载 | 可以只下发资源包，不重装 |
| 系统悬浮桌宠 | `SYSTEM_ALERT_WINDOW` + 前台 Service + 通知 | 原生能力必须进 APK；只能远程换美术 |

### 3.3 推荐策略

**方案 A（推荐，当前节奏）**

- 现在打包：名称/图标/品牌文案已就绪；
- 桌宠下一个 APK 做；
- 简单、不阻塞发布。

**方案 B（想避免二次安装）**

- 打包前先放一个**通用桌宠 host**：
  - `PetHost` 组件；
  - `PetState` 状态机；
  - 资源清单 + 本地/远程加载；
  - 第一版可以隐藏或不启用；
- 以后只更新 PNG/Lottie 资源包，不重装 APK；
- 代码仍必须先进 APK。

### 3.4 真 OTA

以后要做：

- `expo-updates` / EAS Update，或自建 bundle 下载；
- 只能更新 JS/资源，**不能更新原生权限、Service、悬浮窗**；
- 必须处理签名、回滚、版本兼容；
- 不要为了桌宠强行上 OTA；先做数据驱动资源包更稳。

### 3.5 当前打包阻塞

- `assembleDebug` 已通过，label=Crabstack；
- **release 仍缺 `app/android/keystore.properties` / release keystore**；
- 没有 release keystore 时 Gradle 会退回 debug 签名，不能发布；
- 设备当前 `unauthorized`，未做安装验收。

## 4. 桌宠「小寄」角色圣经

### 4.1 外形

- 奶油色寄居蟹身体，两只大眼睛在短柄上；
- 壳 = **平顶便携工作台**：
  - 深蓝壳、米白描边、黄铜铆钉；
  - 顶部铰链盖，打开是米白工作台面；
  - 两个小抽屉、侧面一根米白背带 + 黄铜扣；
  - 侧面/正面一个方形插件口，半插一个蓝色模块；
- 一只奶油色钳子，常拿小扳手；
- 厚描边、平涂、有限色，3/4 视角为主。

### 4.2 不要画

- 不要宝箱锁孔、正面铰链、鼓顶（会被看成宝箱）；
- 不要机器人、鲸鱼、鱼尾+气泡；
- 不要写实纹理、渐变、阴影、3D；
- 不要在图中写中文/英文（除 `?`、`✓`、`Z` 这类符号）；
- 不要重新设计角色，只改状态/姿势。

### 4.3 六个状态

| 状态 | 画面 | 用途 |
|---|---|---|
| `idle` | 壳闭合，坐着，轻微笑，一只钳搭在壳上 | 首页/空闲 |
| `thinking` | 壳微开，钳子托腮，头顶问号 | 模型流式等待 |
| `working` | 壳完全打开成工作台，钳子插模块，另一只拿扳手，一个小屏幕 | 工具执行/审批 |
| `success` | 壳打开，双钳举起，头顶对勾 | run 完成 |
| `error` | 壳歪/裂，螺旋眼，旁边掉一颗螺丝 | 出错 |
| `sleeping` | 壳闭合，蜷缩，Z | 长时间空闲/后台 |

**重要**：现在 `design/pet/working-1024.png` 元素偏多（两个屏幕 + 工具槽 + 模块 + 扳手 + 撑杆）。缩到 256px 会糊。正式接入前先精简为：

- 一个悬浮屏；
- 一个模块；
- 一把扳手；
- 保留撑杆/工作台面。

### 4.4 资产规格

- 1024×1024 PNG，透明背景；
- 512×512、256×256 导出；
- 角色居中，四周留 5–8% 安全区；
- 单张目标 < 250KB（512）；
- 不许白底、阴影、文字；
- 状态间比例/颜色/线宽一致。

## 5. 推荐实现（App 内，数据驱动）

### 5.1 文件建议

```
app/src/ui/pet/PetHost.tsx      # 渲染器
app/src/ui/pet/states.ts        # PetState + 映射
app/assets/pets/xiaoji/
  idle.png
  thinking.png
  working.png
  success.png
  error.png
  sleeping.png
  manifest.json                 # 版本/尺寸/帧信息
```

### 5.2 类型

```ts
export type PetState =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'success'
  | 'error'
  | 'sleeping';

export interface PetPack {
  version: number;
  states: Record<PetState, {
    file: string;
    /** 可选：状态最短展示时间 */
    minMs?: number;
  }>;
}
```

### 5.3 状态映射

| 应用状态 | 桌宠 |
|---|---|
| App 启动完成 / 无会话 | `idle` |
| 用户发送 / 模型流式 | `thinking` |
| 工具执行 / 审批等待 | `working` |
| `run.finished reason=done` | `success`，2s 后回 `idle` |
| `run.finished reason=error` | `error`，点按/重试后回 `idle` |
| 空闲 > 60s / 退后台 | `sleeping` |

实现要求：

- 状态最短展示 600ms，避免抖动；
- 切换用 150–250ms 淡入淡出；
- `success/error` 是临时态，不要永久停留；
- 不在流式每个 delta 切状态，只在 run/tool 边界切。

### 5.4 渲染器原则

- 第一版用 RN `Image` + `Animated` 淡入淡出，不引新原生依赖；
- 资源优先从 bundle 读，失败回退 `idle`；
- 可选远程包：下载到 `FileSystem.documentDirectory/pets/xiaoji/`，校验 manifest 版本/hash，失败回退内置；
- **远程包只换美术，不换代码**；
- 不要把 base64 塞进会话历史。

### 5.5 悬浮桌宠（另一条线）

如果要做系统悬浮：

- Android `SYSTEM_ALERT_WINDOW` 权限 + 前台 Service + 通知渠道；
- 需要原生代码，必须进 APK；
- 不能通过 JS OTA 增加；
- 与 App 内吉祥物分开做，不要混在同一个组件里。

## 6. Nano Banana Pro 提示词

### 6.1 通用前缀

```text
Same character as the reference: cream hermit crab,
deep-blue portable workbench shell with flat top and hinged lid,
brass hardware, two eyes on stalks, one cream claw.

Flat vector, thick clean outline, limited palette:
cream #F7F3EA, deep blue #4176E6, ink #111827, brass #C9A46A.
Pure white background, no text, no labels, no gradient,
no shadow, no 3D, no extra characters, no scene.
1024x1024, character centered, 5–8% safe margin.
State:
```

### 6.2 六个状态后缀

```text
idle: sitting calmly, shell lid closed, slight smile,
one claw resting on the shell.

thinking: shell lid slightly open, one claw on its chin,
eyes looking up, a small question mark above its head.

working: shell lid fully open as a workbench,
one claw plugging a blue module into the square port,
the other claw holding a small wrench,
one small floating screen with simple lines.

success: shell lid open, both claws raised,
a small cream check mark above its head, proud expression.

error: shell lid crooked, one hinge loose, spiral eyes,
a small loose screw beside it, confused but not scary.

sleeping: shell lid closed, body curled up,
eyes closed, a small "Z" above its head, peaceful.
```

### 6.3 迭代规则

- 每次附上角色设定图作为参考；
- 每次只生成一个状态，不要六宫格一次出；
- 用“编辑这张图”，不要重新抽卡；
- 不要生成中文/英文文字；
- 生成后去白底，检查边缘无白边。

## 7. 验收标准

### 图标

- 48px 仍能读出眼睛、钳子、方口；
- adaptive 前景在 66% 安全区内；
- 单色图标为透明 alpha，系统染色正常；
- 深色背景下无明显白边；
- 桌面 label = `Crabstack`。

### 桌宠

- 6 个状态文件名/映射正确；
- 透明背景，边缘无白边；
- 256px 仍可读；
- 状态切换无闪烁、无布局跳动；
- `working` 已精简；
- 不依赖 OTA 才能运行；
- 远程资源失败可回退 bundled `idle`。

## 8. 任务清单（给下一个 AI）

- [ ] 把 `design/pet` 的 6 个状态选 512/256 版本放进 `app/assets/pets/xiaoji/`；
- [ ] 精简 `working`（一个屏幕/模块/扳手）；
- [ ] 实现 `PetHost` + `PetState` + manifest；
- [ ] 接 store 的 run/tool/error 状态；
- [ ] 首页/聊天空状态先接 `idle`；
- [ ] 单测：状态映射、资源回退、最短展示时间；
- [ ] 真机 256px/512px 验收；
- [ ] 可选：远程 pet pack（manifest/version/hash/fallback）；
- [ ] 可选：悬浮桌宠立项（原生，单独分支）。

## 9. 未决事项

| 项 | 选项 | 建议 |
|---|---|---|
| 桌面 label | `Crabstack` / `蟹栈` | 当前是 `Crabstack`；中文用户可改 `蟹栈` |
| 设计源 | 不入库 / 设计仓 / LFS | 不建议全塞 app 仓；选 512 生产图入库即可 |
| 桌宠形态 | App 内 / 系统悬浮 | 先 App 内，悬浮单独立项 |
| 热更新 | 不做 / expo-updates / 自建 | 先做数据驱动资源包，不急着 OTA |
| release 签名 | keystore 缺失 | 在 Windows/有 key 的机器出包 |

## 10. 文件地图

```
docs/BRAND-PET.md                  # 本文
docs/AI-TASKS.md                   # 任务/规则
docs/TECHNICAL.md                  # 技术
docs/PITFALLS.md                   # 坑
app/app.json                       # 名称/图标/adaptive
app/assets/icon.png
app/assets/adaptive-icon.png
app/assets/monochrome-icon.png
app/android/app/src/main/res/mipmap-*/
design/                            # 本地设计源，未入库
```
