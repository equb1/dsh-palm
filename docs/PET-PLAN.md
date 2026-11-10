# 桌宠插件实施方案（待确认）

> 状态：**方案稿，等确认后再写代码**。  
> 关联：[PET-SPECIFICATION](PET-SPECIFICATION.md)（数据格式与 12 态定义）、
> [UNFINISHED-REQUIREMENTS](UNFINISHED-REQUIREMENTS.md)（悬浮窗转盘/截图等后续需求）。  
> 目标不是兼容 DSH Web 插件，而是先做**锦囊自己的桌宠插件体系**。

## 1. 目标与非目标

### 目标

1. **灵动**：任何时候都有微动（呼吸、眨眼/歪头、待机小动作），不是换一张静态图。
2. **有反应**：点左/右、挠痒、拖拽、长按都有不同动作和气泡反馈。
3. **跟状态**：思考、干活、并发、审批、报错、完成、搬运、睡觉、醒来、闲逛都要有对应表现。
4. **双端一致**：App 内 Composer 上方的宠物和 Android 桌面悬浮窗使用**同一套 pack、同一套状态名、同一套时间参数**。
5. **可扩展**：桌宠是数据包（`.dshpet`），内置 deepy/maid，用户可导入第三方 pack；不改代码即可换角色。
6. **不打扰**：透明窗口不挡触摸、可拖动/吸附/隐藏、后台暂停渲染、低配降级。

### 非目标（本期不做）

- 不直接加载 DSH 的 Cordis/Web 插件（DOM/PixiJS/Live2D 运行时）。
- 不做 Live2D；先用 sprite sheet / 帧动画。
- 不做语音、养成、AI 生图（放到后续阶段）。
- 不做插件市场交易；先支持本地文件导入。

## 2. 现状与差距

### 已有

- `app/src/pet/types.ts`：`PetPack` / `PetAnimation` / 12 态 / reactions 类型。
- `app/src/pet/PetStateMachine.ts`：12 态雏形、tiers、sleep/wake、idlePool、reaction。
- `app/assets/pets/deepy/pack.json`、`maid/pack.json`：数据驱动 pack 雏形。
- `CompanionPet.tsx`：气泡、点击 reaction、长按 HUD、状态机接入。
- `FloatPetService.kt`：EdgeSnap、haptics、气泡、长按；但仍静态换图。
- `docs/PET-SPECIFICATION.md`：数据格式与状态定义。

### 关键差距

| 差距 | 现状 | 影响 |
|---|---|---|
| 没有帧动画 | 所有 pack 的 animations 都只有 1 帧；RN/悬浮窗只换 PNG | 仍然像贴纸 |
| 状态事件不完整 | 只有 running/waiting/thinking/error 轮询；done/notification/carrying/roam 没有真实事件 | 12 态是“名义上的” |
| 状态机计时器不可靠 | 延迟 transition 没有取消；idlePool 直接改 anim 不经过状态机 | 可能卡动作/闪回 |
| 双端不同步 | RN 用状态机，悬浮窗只收 state 字符串；动画帧各做各的 | 桌面和 App 内不一致 |
| 没有插件装载 | pack 是内置 import；没有 manifest/校验/安装/选择 | 无法导入第三方角色 |
| 没有设置页 | 尺寸、帧率、开关、悬浮窗、气泡都不可配 | 体验不可调 |
| 没有 hit test | 点击统一随机 reaction；没有 head/body 分区 | 互动不精准 |

## 2.5 竞品研究（2026-11-08）

翻了目前能搜到的 DSH 桌宠插件，按“美术路线 / 动画机制 / 交互物理 / 状态联动”整理：

| 插件 | 美术 / 动画 | 机制亮点 | 不适合直接照搬 |
|---|---|---|---|
| [dsh-go](https://github.com/ccch1mneyyy/dsh-go) | Android 原生 sprite sheet；`pack.json` 定义帧、hitbox、idlePool、reactions | 12 态、并发 tiers、60s 睡眠、EdgeSnap、haptics、动态窗口 | 它是 Android 原生实现，不能直接给 RN/DSH 用 |
| [dsh-live2d-pets](https://github.com/cyanfish-x/dsh-live2d-pets) | Live2D Cubism + PixiJS；模型自带呼吸/眨眼/物理/待机 motion | 鼠标视线跟随、分部位触摸、SSE 状态镜像、人设台词、30/60fps 限帧 | Live2D SDK/模型许可、DOM/PixiJS 依赖，移动端重 |
| [dsh-pet](https://github.com/song-423/dsh-pet) / [dsh-pet-to-family](https://github.com/zi-O1/dsh-pet-to-family) | **100+ 段透明 WebM（VP9-alpha）**，640×360；AI 生成素材管线 | 动画链按权重首尾相接（idle 10 / turn 5 / move 5）、屏幕漫游、拖拽甩抛/反弹/挤压、多开、触屏重力/摇一摇、余额档位、待办、记忆/对话/语音 | 素材巨大、Electron/Web 运行时；手机装不下也不该装 |
| [dsh-dafeiyu-pet](https://github.com/lilulj/dsh-dafeiyu-pet) | 104 个动作、11 组；Qt helper 独立窗口；msedge-tts 语音 | 右键动作菜单、待机活跃度（12–22s/45–90s）、动作延时、系统语音 | 首次下载约 580MB；Windows x64 helper，移动端不可用 |
| [dsh-dfy](https://github.com/D70w/dsh-dfy) | **1280×1280 分层 Canvas**：头发/呆毛/眼/眉/耳/身体/裙/腿/尾巴/附件分别驱动；16 种情绪；粒子特效 | 呼吸/眨眼/视线/关节/次级部件持续运动；抓取点物理；思考分等待/分析/整理三阶段；工具类型→语义道具；离线台词/LLM | 分层 rig 需要美术拆分；实现复杂度高 |
| [@asahimoon/dsh-desktop-pet](https://github.com/AsahiMoon/dsh-desktop-pet) | Electron 透明置顶窗；鲸鱼娘动画表；Codex/petdex 角色兼容 | 状态表：工作/庆祝→睡 25s→待机、错误惊吓、思考、等待批准、新会话欢迎；5s 心跳；任务进度黑框；宠物内聊天；成长 XP；鼠标穿透 | Electron 桌面窗口，不是移动端 |
| [dsh-desktop-companion](https://github.com/JiayiXie-jpg/dsh-desktop-pet) | 像素/GIF 或 AI 生成透明动画（Seedream→Seedance→色键） | 养成（6 种族/5 稀有度/XP/心情/饱食/亲密度）、TTS、事件气泡 | 依赖火山引擎凭据；移动端生图/视频成本高 |

### 2.5.1 美术上的共同结论

1. **没有一个是“状态→一张静态图”**：最差也是 GIF/WebM 循环，主流是 sprite sheet 或分层 rig。
2. **分层 rig 最适合移动端**：dsh-dfy 把角色拆成十几个部件，呼吸/眨眼/视线/尾巴/头发都是 transform，素材小、动作可组合、情绪可换眼眉嘴；这比 100 段视频更适合手机。
3. **spritesheet 适合像素风**：dsh-go 的 128×128 帧 + pack 元数据，体积可控，适合我们现在的 Deepy/鲸娘像素资产。
4. **透明视频质量最高但最重**：100+ 段 640×360 WebM 在 PC 上没问题，手机上包体/解码/耗电都不可接受。
5. **AI 素材管线可借鉴**：dsh-pet 的“提示词→源视频→透明动画”、companion 的“照片→图→视频→色键”，可用于后续生产，不是运行时方案。

### 2.5.2 机制上的共同结论

1. **动画链（Animation Chain）**：每个动作播完按权重选下一个；idle 也参与链，不是“待机图 + 偶尔插播”。
2. **事件状态机**：思考/工具/审批/完成/错误/新会话，全部有专属动作；`done/error` 是瞬态，播完回主状态。
3. **中断与回退**：点击/拖拽/审批等 one-shot 可打断 idle，播完 `autoReturn` 回主状态，不能卡动作。
4. **物理交互**：Q 弹、阻尼拖拽、甩抛、边缘反弹、落地挤压、震动；有的还做多屏漫游、碰撞。
5. **语义反馈**：dsh-dfy 把“读文件/搜索/命令/写入”映射到不同道具和表情；asahimoon 用黑框显示当前工具/文件/进度。
6. **安静模式**：睡觉时随机动作、碎碎念、余额、待办全部静默；通知只在该出现时出现。
7. **人格/记忆/语音**是差异化，不是灵动感的必要条件；先把动画和交互做好。

### 2.5.3 对我们的选型结论

- **主路线：分层 rig + sprite sheet 双支持**：
  - 像素角色用 sprite sheet（我们现有资产可直接扩帧）；
  - 高质量角色用分层 rig（Rive/Skia 实现呼吸/眨眼/视线/尾巴），不引 Live2D/Electron；
  - pack 里用 `renderer: "sheet" | "rig"` 区分。
- **不采用**：100+ 段 WebM、Qt/Electron helper、Live2D（至少 v1 不）。
- **机制按优先级借鉴**：动画链 > 事件状态机 > 物理交互 > 语义进度 > 人格/语音。
- **移动端预算**：单个角色包目标 < 10MB；12 态 × 8 帧 × 128² 像素图约 1–2MB，可行；视频方案直接排除。

## 3. 总体架构

```text
┌─────────────────────────────────────────────────────────────┐
│ App State / Engine Events                                    │
│  run 开始/思考/工具/审批/完成/错误/附件/空闲                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ PetEventAdapter（事件→信号）
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ PetStateMachine（纯 TS，可单测）                             │
│  12 态 + 优先级 + minDisplay + autoReturn + sleep/wake       │
└───────────────┬──────────────────────────────┬──────────────┘
                │ currentState/anim/bubble      │ reaction
                ▼                              ▲
┌──────────────────────────────┐   ┌───────────────────────────┐
│ PetRuntime（帧时钟，纯 TS）   │   │ 交互层                     │
│  animation queue / frame     │   │  tap/tickle/drag/长按      │
└───────────────┬──────────────┘   └───────────────────────────┘
                │ frame(0..N)
      ┌─────────┴─────────┐
      ▼                   ▼
┌───────────────┐   ┌─────────────────────────────────────────┐
│ RN Renderer   │   │ Android PetOverlay                      │
│ PetCanvas     │   │ PetSpriteView + FrameClock + EdgeSnap   │
│ (App 内)      │   │ + Haptics + Bubble + 动态窗口           │
└───────────────┘   └─────────────────────────────────────────┘
```

### 关键决策

1. **状态机放在 JS**，因为 App 的会话/审批/错误状态都在 store 里；悬浮窗只接收
   `state + animation + bubble + packPath`，自己跑帧时钟，不逐帧走 JS bridge。
2. **动画运行时纯 TS + 原生各一份**：RN 用 `requestAnimationFrame`/定时器；
   Android 用 `Choreographer`。两边都按 pack 的 `frames[].ms` 计算，保证节奏一致。
3. **内置 pack 走 assets，外部 pack 走 app files**；原生悬浮窗通过绝对路径读同一个 pack。
4. **插件 v1 只允许数据**（JSON + PNG），不执行 JS，避免权限和安全问题。

## 4. PetPack v2 规范

在现有 `types.ts` 基础上升级，保持向后兼容（v1 只有 1 帧也能跑）。

```jsonc
{
  "schema": 2,
  "id": "deepy",
  "name": "小章鱼 Deepy",
  "version": "2.0.0",
  "author": "...",
  "license": "...",
  "canvas": { "width": 128, "height": 128 },
  "anchor": { "x": 0.5, "y": 1.0 },
  "contentBox": { "x": 16, "y": 24, "width": 96, "height": 96 },
  "hitBoxes": {
    "default": { "x": 16, "y": 24, "width": 96, "height": 96 },
    "head":    { "x": 24, "y": 24, "width": 80, "height": 48 },
    "body":    { "x": 16, "y": 72, "width": 96, "height": 48 }
  },
  "animations": {
    "idle": {
      "sheet": "sheets/idle.png",
      "frameW": 128, "frameH": 128, "cols": 8,
      "frames": [
        { "i": 0, "ms": 120 }, { "i": 1, "ms": 120 },
        { "i": 2, "ms": 120 }, { "i": 3, "ms": 120 }
      ],
      "loop": true
    },
    "blink": { "...": "..." }
  },
  "states": {
    "idle": "idle",
    "thinking": "thinking",
    "working": "working",
    "juggling": "juggling",
    "sweeping": "sweeping",
    "notification": "notification",
    "attention": "attention",
    "error": "error",
    "carrying": "carrying",
    "sleeping": "sleeping",
    "waking": "waking",
    "roam": "roam"
  },
  "tiers": {
    "working":  { "min": 1, "max": 1, "anim": "working" },
    "juggling": { "min": 2, "max": 2, "anim": "juggling" },
    "sweeping": { "min": 3, "max": 99, "anim": "sweeping" }
  },
  "idlePool": [
    { "anim": "idle-look", "weight": 40, "minGapMs": 6000, "maxGapMs": 12000 },
    { "anim": "idle-stretch", "weight": 20 }
  ],
  "bonus": {
    "working": { "anim": "working-hum", "chance": 0.1 }
  },
  "reactions": {
    "tapLeft": "react-left",
    "tapRight": "react-right",
    "tickle": "react-tickle",
    "drag": "react-drag"
  },
  "timings": {
    "minDisplayMs": 400,
    "autoReturnMs": 1500,
    "wakeMs": 600,
    "sleepAfterMs": 60000,
    "roamAfterMs": 120000
  },
  "bubbles": {
    "thinking": ["让我想想…", "正在梳理思路"],
    "attention": ["等你确认一下", "这里需要你拍板"],
    "error": ["出错了，我检查一下"],
    "done": ["搞定！", "这一轮完成"]
  }
}
```

### 校验规则

- `frameW === contentBox.width * scale`、`frameH === contentBox.height * scale`
  （或允许 `scale` 字段，像素风整数倍）。
- `sheet` 只能是相对路径、不能 `..`、不能绝对路径；只允许 png/webp。
- `states` 的每个值必须在 `animations` 中存在；缺失动画降级到 `idle`。
- `idlePool` / `reactions` / `bonus` 引用的动画必须存在。
- 单包大小上限（建议 10MB）、sheet 尺寸上限（4096×4096）、帧数上限（256）。
- 安装时校验失败给出具体字段错误，不覆盖已安装版本。

## 5. 状态与事件模型

### 5.1 事件适配

新增 `PetEventAdapter`，从 store/engine 订阅，不再用 `updateContext` 轮询整个 detail：

| 信号 | 来源 | 进入状态 |
|---|---|---|
| `RUN_STARTED` | 当前会话开始 run / sessions 出现 running | `working` / `thinking` |
| `THINKING_DELTA` | 最新 turn 有 streaming thinking block | `thinking` |
| `TOOL_STARTED` | tool block 运行中 | `working` |
| `APPROVAL_WAITING` | approvals 非空 / status waiting_approval | `attention` |
| `RUN_DONE` | turn/end ok / 最后 assistant 完成 | `notification`（2s）→ `idle` |
| `RUN_ERROR` | run error / store.error | `error`（4.8s）→ `idle` |
| `ATTACHMENT` | pendingAttachments / 上传中 | `carrying` |
| `IDLE` | 无 run/审批/附件 | `idle`，60s 后 `sleeping` |
| `WAKE` | idle/sleep 中收到新信号 | `waking` → 当前状态 |
| `ROAM` | 空闲超过 `roamAfterMs` | `roam`（仅悬浮窗） |

### 5.2 优先级

`error > attention > notification > carrying > sweeping > juggling > working > thinking > waking > idle > sleeping > roam`

- 高优先级可打断低优先级，但受 `minDisplayMs` 保护；
- `notification/error` 是**瞬态**：显示 `minDisplayMs` 后自动回主状态；
- `attention` 保持到审批被处理；
- `sleeping` 只在 idle 持续 `sleepAfterMs` 后进入；
- `waking` 是过渡态，`wakeMs` 后进入当前主状态。

### 5.3 修复现有状态机

- 所有 `setTimeout` transition 必须可取消；用 `revision`/`clearTimeout`。
- `idlePool` 不要直接改 `currentAnim`，走 `playTransient(anim, autoReturnMs)`。
- `setPack` 时重置计时器，不重复 schedule。
- `destroy` 清理全部 timer。
- 增加 `pushSignal(event)` 单元测试：done/error/approval 瞬态、minDisplay、wake。

## 6. 动画运行时

### 6.1 `PetRuntime`

```ts
class PetRuntime {
  play(name: string, opts?: { loop?: boolean; priority?: number; minMs?: number }): void;
  tick(now: number): { sheet: string; frame: number; finished: boolean } | null;
  stop(): void;
}
```

- 帧时间取 pack 的 `frames[].ms`，不依赖固定 fps；
- `play` 支持打断/排队：reaction 优先，瞬态播完回主状态；
- 跨动画切换：像素风默认硬切；可选 80–120ms opacity 过渡；
- 只重绘宠物小组件，不触发整页 re-render。

### 6.2 RN 渲染

- `PetCanvas`：固定 `contentBox` 大小，内部 `overflow: hidden`，放整张 sheet，
  按 `frameIndex` 平移 `translateX/-Y`，用整数像素；
- 像素风：`resizeMode="stretch"` + 整数倍尺寸（避免插值）；
- 微动层：`Animated.View` 做呼吸 `scaleY 1→1.025`（2.4s）、
  随机歪头 `rotate ±1.5°`、待机小跳；帧动画和 transform 可叠加。
- 没有新美术时，M0 先用 transform 让现有 8 张图“活”起来。

### 6.3 Android 悬浮窗

- 自定义 `PetSpriteView`（Canvas）+ `Choreographer` 帧时钟；
- `paint.isFilterBitmap = false`、`isAntiAlias = false`、整数倍缩放；
- 按当前帧 `contentBox` 动态 `updateViewLayout`，窗口只包住角色，透明区不挡触摸；
- 边缘吸附、拖动惯性、震动反馈、气泡沿用现有实现；
- 点击/长按/拖动通过 `PetOverlayListener` 回传；reaction 在原生本地播放，
  不依赖 App 在前台。

## 7. 插件化（自有格式）

### 7.1 包结构

```text
deepy.dshpet (zip)
├─ manifest.json
├─ pack.json
├─ sheets/*.png
├─ preview.png
└─ persona.jsonc (可选)
```

`manifest.json`：

```json
{
  "schema": 1,
  "id": "deepy",
  "name": "小章鱼 Deepy",
  "version": "2.0.0",
  "author": "...",
  "license": "...",
  "minAppVersion": "0.2.0",
  "entry": "pack.json",
  "preview": "preview.png"
}
```

### 7.2 安装与生命周期

- 设置 → 桌宠 → 「导入桌宠包」：文件选择器选 `.dshpet`；
- 解压到 `appData/pets/<id>/`，校验 manifest + pack + 图片；
- 安装后出现在角色列表，可预览/启用/卸载；内置 deepy/maid 只读；
- 不执行任何 JS；v1 只支持数据包；
- 后续如要 JS 插件，走独立 QuickJS 沙箱，不在本期。

### 7.3 与现有插件页的关系

- `PluginsScreen` 继续是“DSH 插件兼容目录”，桌宠 pack 作为**内置/本地扩展**单独管理；
- 不把 `.dshpet` 混进 `@dsh/*` npm 插件列表，避免概念混淆。

## 8. 设置与可访问性

设置 → 桌宠：

- 总开关（App 内 / 桌面悬浮窗分开）
- 角色选择（内置 + 已安装 pack）
- 尺寸：小/中/大（或 40–120dp）
- 帧率：12 / 24 / 30
- 气泡：开/关
- 减少动态效果（跟随系统 `prefers-reduced-motion`，关闭 idle 小动作）
- 睡眠时间：30s / 60s / 5min / 永不
- 长按菜单：打开会话 / 截图提问 / 隐藏 / 设置（后续）
- 无障碍：`accessibilityLabel` 描述当前状态；悬浮窗可隐藏；不拦截全屏触摸。

## 9. 资源生产

### 9.1 先不换美术（M0）

用现有 8 张 PNG + transform 做：

- 呼吸：scaleY 1.00↔1.025，2.4s；
- 待机：每 3–6s 随机歪头/左右看/小跳；
- working：快速上下 2px“敲键盘”；
- waiting：左右轻晃；
- sleeping：慢呼吸 + Zzz 气泡；
- done：一次空翻/跳起；
- 点击：左右抖动 + 气泡。

### 9.2 真正的 sprite sheet（M1/M2）

每个角色至少：

| 状态 | 帧数 | 循环 |
|---|---|---|
| idle | 8–12 | 是 |
| blink / idle-look | 4–6 | 否/插播 |
| thinking | 8 | 是 |
| working | 8 | 是 |
| juggling | 8 | 是 |
| sweeping | 8 | 是 |
| attention | 8 | 是 |
| error | 8 | 是 |
| carrying | 8 | 是 |
| sleeping | 6 | 是 |
| waking | 6 | 否 |
| done/notification | 8 | 否 |
| reactions（4） | 4–6 | 否 |

- 128×128/帧，横排 sheet；像素风整数倍缩放；
- 制作：Aseprite/脚本切帧；命名与 pack 一致；
- 先生成 deepy 一套核心状态，maid 复用同一套帧结构。

### 9.3 分层 rig（M1.5，推荐给非像素角色）

借鉴 dsh-dfy：不画 100 段视频，而是把角色拆成可驱动的部件：

- 部件：身体、头、头发/呆毛、左右眼、眼睑、眉毛、嘴、耳朵、尾巴、裙子、腿、手持道具；
- 持续运动：呼吸（胸腔/整体 scale）、眨眼（眼睑）、视线（瞳孔位移）、
  头发/尾巴次级摆动（spring）、身体轻微摇摆；
- 情绪：换眼眉嘴组合 + 身体姿态 + 粒子（爱心/怒气/问号/汗滴/Z）；
- 物理：抓取点越远，部件惯性摆动越大；
- 运行时：Rive 状态机（`react-native-rive`）或 Skia 分层 Canvas；
  包体通常几百 KB–几 MB，远比 WebM 小。

`PetPack` 用 `renderer: "sheet" | "rig"` 区分；`rig` 包引用 `.riv` 或部件图 +
`rig.json`（部件层级/锚点/绑定/表情表）。M1 先 sheet，M1.5 再接 rig。

## 10. 分阶段实施

### M0 · 灵动化最小闭环（0.5–1 天）

- 修状态机 timer/transient；
- 加 `PetRuntime`（纯 TS 帧时钟）；
- 现有 8 张图 + transform 呼吸/待机/点击反应；
- 包内 `animations` 仍 1 帧也能跑；
- App 内先上线，悬浮窗同步同一状态。

**验收**：idle 无静止超过 1s；点击有反应；不崩；typecheck/单测通过。

### M1 · 状态/双端/气泡（2–3 天）

- `PetEventAdapter`：12 态真实可达；
- `PetRuntime` 接 sprite sheet（先做 deepy idle/working/thinking）；
- 悬浮窗帧时钟 + 同一 pack；
- 设置页（开关/角色/尺寸/帧率/气泡/睡眠）；
- 点击分区（head/body）与 reaction。

**验收**：12 态都能手工触发；App 内/悬浮窗动画一致；审批/完成/错误有气泡。

### M1.5 · 分层 rig（可选，2–3 天）

- 选一个角色做 rig：呼吸/眨眼/视线/尾巴次级运动/4 种表情；
- Rive（优先）或 Skia 分层 Canvas 接入 `PetRuntime`；
- 证明“即使 idle 没有新帧，也有连续运动”；
- 为后续非像素角色/换装打基础。

**验收**：rig 角色待机 10 秒内可见眨眼/呼吸/视线变化；包体 < 5MB。

### M2 · 插件化（3–4 天）

- `.dshpet` manifest/pack 校验、导入/卸载/选择；
- 外部 pack 在 RN + 悬浮窗都能加载；
- deepy/maid 完整 sprite sheet；
- EdgeSnap/惯性/长按菜单/动态窗口裁剪打磨；
- 性能：悬浮窗 idle <3% CPU、无触摸阻挡。

**验收**：导入一个第三方 pack 可用；30 分钟挂机无内存/耗电异常；开关/隐藏正常。

### M3 · 可选增强（2–3 天）

- roam/闲逛、notification/carrying 完整动画；
- 人设台词/更多气泡；
- Live2D/GIF 适配层（只作为 pack 类型，不接 DSH 插件运行时）；
- 桌面长按转盘/截图提问（依赖 `UNFINISHED-REQUIREMENTS`）。

## 11. 测试与验收

### 单测

- `PetStateMachine`：优先级、minDisplay、transient 回退、sleep/wake、timer 清理；
- `PetRuntime`：帧序列、循环、打断、autoReturn；
- pack 校验：缺字段、坏路径、坏动画引用、尺寸超限；
- 现有 `npm run verify` 必须全绿（先修 5 个 e2e）。

### 真机

- 12 态逐项触发截图；
- 点击左/右/挠痒/拖动/长按；
- 悬浮窗拖动吸附、点击回 App、气泡、震动；
- 切后台/锁屏/回前台状态保持；
- 30 分钟挂机 CPU/内存/PSS；
- 像素边缘无模糊、透明区不挡点击。

### 性能目标

- App 内 24fps，悬浮窗 24fps（可配置 12/24/30）；
- 悬浮窗 idle CPU < 3%，内存增量 < 30MB；
- 页面不可见/App 后台暂停帧循环；
- 切换状态无 >200ms 空白。

## 12. 风险与待确认

1. **美术资源**：真正灵动需要 sprite sheet；先用 transform 过渡，是否接受？
2. **双端状态机**：状态机放 JS，App 被杀后悬浮窗只能保持最后状态；是否接受 v1？
3. **插件安全**：v1 只允许数据包，不做 JS；是否需要更早支持 JS？
4. **Live2D**：本期不做；如果一定要，需要单独评估 native Cubism SDK/WebView。
5. **悬浮窗权限**：Android 各家 ROM 对 `TYPE_APPLICATION_OVERLAY` 限制不同，需要真机回归。
6. **包体积**：每个角色 12 态 × 8 帧 × 128² PNG，需压缩/图集，避免 APK 膨胀。

## 13. 建议先确认的四件事

1. 先做 **M0（不换美术，transform 灵动化）**，还是直接等 sprite sheet 再一起做？
2. 美术主路线是否接受 **sprite sheet + 分层 rig 双支持**（M1.5 先拿一个角色试 Rive/Skia）？
3. 桌宠插件 v1 是否坚持**纯数据、不执行 JS**？
4. 双端是否接受“App 内状态机 + 悬浮窗本地帧时钟，App 被杀后悬浮窗保持最后状态”？
