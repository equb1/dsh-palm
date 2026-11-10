# 桌宠设计与实现规范 (Pet Specification)

> 参考标杆：[ccch1mneyyy/dsh-go](https://github.com/ccch1mneyyy/dsh-go)  
> 核心理念：**数据驱动（Data-Driven）、逐帧精灵表（Sprite Sheet）、完备状态机（State Machine）、全物理手势交互（EdgeSnap & Haptics）**。

---

## 一、架构全景

```
                    ┌─────────────────────────┐
                    │  App State / Host Loop  │ (任务数/思考流/审批等待/错误)
                    └────────────┬────────────┘
                                 │ updateContext()
                                 ▼
                    ┌─────────────────────────┐
                    │    PetStateMachine      │ (60s闲置休眠/任务阶梯/防抖/交互反应)
                    └────────────┬────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
    ┌────────────────────────┐      ┌────────────────────────┐
    │   App 内 CompanionPet   │      │ 原生悬浮 FloatPetService│
    │  (Composer 输入框上方)  │      │  (桌面常驻 / 全局交互)   │
    └────────────────────────┘      └────────────────────────┘
```

---

## 二、数据驱动资产包规范 (`PetPack`)

存放路径：`app/assets/pets/<id>/pack.json`

### 1. 结构字段定义

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 唯一标识符（如 `deepy`、`maid`） |
| `name` | `string` | 展示名称（如 `小章鱼 Deepy`、`鲸娘`） |
| `canvas` | `{ width, height }` | 逻辑画布标准尺寸（通常 128x128） |
| `anchor` | `{ x, y }` | 脚底对齐点归一化坐标（默认 `{ x: 0.5, y: 1.0 }`） |
| `contentBox` | `{ x, y, width, height }` | 核心包围盒（用于动态裁剪多余透明空边，避免阻挡屏幕点击） |
| `hitBoxes` | `Record<string, Box>` | 局部交互碰撞区（如 `head`、`body`，支持针对性点击/抚摸） |
| `animations`| `Record<string, Animation>` | 逐帧动画字典 |
| `states` | `Record<PetState, string>` | 状态到动画名的映射映射表 |
| `tiers` | `TiersConfig` | 并发任务阶梯规则 |
| `idlePool` | `Array<{ anim, weight }>` | 空闲动作随机池 |
| `reactions`| `Record<Reaction, string>` | 交互响应动作（轻戳、挠痒痒、被抓起） |
| `timings` | `TimingsConfig` | 各种时间阈值与调度策略 |

### 2. 精灵表动画 (`PetAnimation`)
```json
{
  "sheet": "deepy_coding.png",
  "frameW": 128,
  "frameH": 128,
  "cols": 4,
  "frames": [
    { "i": 0, "ms": 120 },
    { "i": 1, "ms": 120 },
    { "i": 2, "ms": 120 },
    { "i": 3, "ms": 120 }
  ],
  "loop": true
}
```

---

## 三、12 态完备状态机 (`PetState`)

| 状态 | 触发条件 | 视觉与动作表现 |
|---|---|---|
| `idle` | 无任务、处于活跃空闲期 | 轻微呼吸起伏、眨眼、偶尔从小动作池插播动作 |
| `thinking` | 模型正在输出思考流（thinking） | 托腮沉思、头上浮现思考小气泡 |
| `working` | **1 个任务** 正在执行（生成/工具运行） | 专注敲键盘、查看终端 |
| `juggling` | **2 个任务** 同时并发执行 | 杂耍双球、双手手忙脚乱 |
| `sweeping` | **3 个及以上任务** 超载运转 | 疯狂挥舞扫帚或狂暴敲击、满头汗水 |
| `notification` | 有新产物/文件生成完成 | 欢呼、跳起挥手 |
| `attention` | 遇到工具审批或用户提问等待作答 | 头顶感叹号警示、原地踱步 |
| `error` | 网络中断或任务报错 | 晕头转向、头顶小转转圈圈 |
| `carrying` | 正在上传大文件或处理附件 | 双手吃力搬运包裹 |
| `sleeping` | 连续 **60 秒** 无任何任务推进 | 闭眼打瞌睡、出现打鼾气泡 `Zzz…` |
| `waking` | 处于睡眠态时收到新任务 | 猛然惊醒、伸懒腰（持续 `wakeMs` 后进入工作） |
| `roam` | 空闲巡航模式 | 沿屏幕边缘走动 |

---

## 四、交互反馈与手势反应 (`Reactions`)

- **`tapLeft` / `tapRight`**：轻触左侧或右侧，触发专属微反应（偏头、眨眼、回看）；
- **`tickle`**：手指在身体区域来回滑动抚摸，触发开怀大笑动作；
- **`drag`**：手指按住拖拽时，角色呈现被拎起悬空荡腿动作；
- **`autoReturnMs`**：任何交互或插播动作播放完毕后，在设定的安全毫秒后平滑回流至所属主状态，杜绝卡动作。

---

## 五、Android 原生悬浮窗渲染规范

1. **锐利像素渲染**：
   - 严禁模糊滤镜，设置 `drawable.paint.isFilterBitmap = false` 与 `isDither = false`（Nearest Neighbor 缩放），保持像素艺术边缘的极致锐利；
2. **`PetFrames` 动态裁剪**：
   - 根据当前动作帧的实际 `contentBox` 动态更新 `WindowManager.LayoutParams`，收敛透明边界，避免透明背景误挡用户正常操作屏幕；
3. **`EdgeSnap` 物理吸附**：
   - 用户拖拽松手后，根据屏幕中轴线判定最近侧，以减速插值器（`DecelerateInterpolator`）平滑滑动贴靠至屏幕边缘（保留 16px 安全边距）；
4. **触觉反馈（Haptics）**：
   - 抓起（DOWN）、拖拽中移动、吸附贴边（SNAP）触发微秒级短震动反馈；
5. **轻量气泡（Speech Bubble）**：
   - 半透明黑色圆角气泡，实时展示执行进度片段、审批提醒或长按提示。

