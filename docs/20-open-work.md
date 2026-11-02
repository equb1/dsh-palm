# 20 · 非 UI 的欠账

> 2026-11-02 盘。只列**功能/工程**上的缺口，UI 差距见 [19-ui-research.md](19-ui-research.md)。
> 每条：现象 → 影响 → 位置 → 建议。
>
> **同日已修完 P0（1–7）**，下面保留了原始描述，条目末尾加了「已修」说明。

## 第二轮（2026-11-02 下午）：P1 + 工程债

### P1 完成情况

| # | 项 | 状态 | 做法 / 限制 |
|---|---|---|---|
| 8 | OEM 保活引导 | ✅ | 设置页显示「已放行 / 受限制」，按钮走 `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`，失败退回应用详情 |
| 9 | 安全模式 | ✅ | 引擎连续失败 3 次自动标记；设置页「安全模式重启」把 `profiles` 挪成 `profiles.broken-<ts>` 后重启 |
| 10 | 老 rootfs 迁移 | ✅ **真机验证** | 伪造老布局后启动：工作区、设备密钥、`.dsh`（会话/凭据）三项都迁出并建软链；验完已恢复真机数据 |
| 11 | 会话管理 | ✅ 部分 | 宿主接口 `session/rename` + `workspace/pin/unpin/archive/unarchive`；抽屉长按 → 置顶/取消置顶/归档/改名。**删除**和**正文搜索**宿主没有开放接口，暂缺 |
| 12 | 诊断/日志导出 | ✅ | 设置页「导出日志」把最近 300 行经系统分享发出 |
| 13 | 错误文案 | ✅ | `app/src/lib/errors.ts` 把 `gateway/...`、401、超时、DNS、配对码等翻成人话 |
| 14 | 附件压缩 | ✅ | 选图 `quality: 0.7` + 8MB 上限（base64 前检查） |
| 15 | capabilities.actions | ✅ | 桥声明真实的 `approve/reject/steer/stop/create_session`；输入区按能力决定停止/插话/预设胶囊 |

### 工程债

| # | 债 | 状态 |
|---|---|---|
| 16 | 没有 CI | ✅ `.github/workflows/ci.yml`（装依赖 + app typecheck + 22 条测试） |
| 17 | `approval-card` 没进 npm test | ✅ `npm test` 跑 `test/*.test.ts`，22/22 通过 |
| 18 | docs/04、06、13 过时 | ✅ 已按现状改写 |
| 19 | 两套锁文件 | ✅ 删掉未跟踪的 pnpm 锁/工作区文件，统一 npm |
| 20 | 没有单元测试 | ✅ `test/unit.test.ts`（协议判别、事件投影、标题） |
| 21 | 诊断包 | 🟡 日志可导出；还没有打包成 zip 的「诊断包」 |

### P2 本轮未做（如实记录）

| 项 | 为什么没做 |
|---|---|
| iOS 遥控器 | 阶段 2 的独立客户端；需要 Xcode 工程、签名和真机，本轮环境做不了 |
| 多主机 / 扫码 / TLS | 多主机要动 store + 抽屉 + 设置；扫码要加相机权限与原生依赖；TLS 要桥支持 https/wss 和证书信任链，属于独立批次 |
| 远程 SSH / 中继 | 需要服务端与账号体系，不是客户端单方面能落 |
| 鸿蒙 | 平台移植，选型阶段就排除了 |
| 预设 L1/L2/L3 分享 | 还没有自定义预设的创建入口，先分享内置预设没有意义 |
| 桌宠 / 社区 / 市场 | v1 明确不做 |

## 已经能用的（先划清）

本机引擎（proot + node + dsh）、单文件桥、会话/流式/工具/审批/提问、模型与权限切换、
账号登录（浏览器 OAuth + 本机回调）、模型提供商（目录 + 自定义渠道）、工作区与设备密钥外置、
DNS 修复、首装进度、桥/引擎看门狗、真机验证（PLR110 / Android 16）。

## P0 · 会直接影响可用性

### 1. 会话内切预设会报错

- 现象：聊天页的预设胶囊调 `store.setPreset()` → `sessions.setPreset`，而真引擎桥里这是
  `unsupported('sessions.setPreset')`（`engine/src/real/server.ts:768`）。
- 影响：在真宿主上点胶囊必报错；预设切换是产品叙事的一部分（"换个锦囊"）。
- 已修：聊天页按 `capabilities.actions` 决定是否显示预设胶囊（真宿主隐藏），
  `store.setPreset` 也会先检查能力并给人话提示。真机截图确认胶囊不再出现。

### 2. 「能力契约」在真宿主上没有真正生效

- 现象：预设在我们的协议里有 `contract.tools`，但真 dsh 只有三档权限预设
  （read-only / workspace-write / danger-full-access），没有"工具白名单"（见 docs/10）。
- 影响：README/产品说的"模型看不见没给它的工具"目前是**假**的；预设只是个 `agentPreset` id。
- 已修（如实标注）：docs/03 顶部加了实现状态，设置页「当前锦囊」下方也写明
  「真宿主暂不支持工具白名单」。机制本身仍待上游或 profile 过渡。

### 3. 没有本地通知 + 通知权限没申请

- 现象：`app/package.json` 里没有 `expo-notifications`；`POST_NOTIFICATIONS` 声明了但从未请求，
  实测 `numEnqueuedByApp=354 / numPostedByApp=0` —— 前台服务通知根本没显示。
- 影响："长任务值守"这条核心叙事不成立：跑完了、要审批了，锁屏上什么也没有。
- 已修：原生 `DshPalmHost` 新增 `requestNotificationPermission` / `notifyEvent`（不引新依赖）。
  连上宿主时申请权限；App 不在前台时对 `run.finished`（非 stopped）、审批、提问发通知。
  真机验证：通道 `dsh-palm-events` importance=4，发完一轮后能看到 AUTO_CANCEL 的完成通知。
  限制：点通知只回到 App，还不能直达具体会话/审批卡。

### 4. 分享菜单没接

- 现象：`AndroidManifest.xml` 只有 MAIN/LAUNCHER 和 `dshpalm://` 的 VIEW；
  没有 `ACTION_SEND`。Runtime 的 `fs()` 接口（docs/02 的七个接口之一）没有实现。
- 影响：文档预设的入口"分享文件进来"不存在，只能从相册选图。
- 已修：manifest 加 `ACTION_SEND`（text/plain、image/*），原生 `getInitialShare` 读冷启动 Intent；
  文字直接填进首页输入框，图片存到缓存、下一条消息时上传。真机用 `am start -a SEND` 验过文字。
  限制：只处理冷启动；App 在后台时分享进来（onNewIntent）还没接。

### 5. `dshpalm://` 深链是死的

- 现象：manifest 声明了 scheme，但 `app/src` 和 `App.tsx` 里没有任何 `Linking.getInitialURL`。
- 影响：扫码/外部唤起会打开 App 但什么都不发生。
- 已修：`App.tsx` 处理 `Linking.getInitialURL` + `url` 事件，支持
  `dshpalm://pair?url=ws://…&code=123456`（填地址、填码、直接连）。

### 6. 桥在 payload 里，改桥必须重打 payload

- 现象：`/opt/dsh/bridge/dsh-palm-bridge.cjs` 是打包进 `payload.bin` 的；
  改 `engine/src/real/` 后只 `adb push` 覆盖，重装/重解压就退回旧桥。
- 影响：账号登录、提供商这些新能力在"全新安装"上会消失（我们已经踩过一次）。
- 已修（更好的做法）：桥改成 **APK 补丁**。`build-bridge.mjs` 同时把单文件桥写进
  `app/android/app/src/main/assets/patch/dsh-palm-bridge.cjs`，`RuntimeInstaller.ensurePatch()`
  每次启动同步进 `rootfs/opt/dsh/bridge/`。以后改桥只要重打 APK，不用碰 150MB payload。
  真机验证：rootfs 里的桥大小与 asset 一致（79,348 字节）。

### 7. `$HOME` 还在 rootfs 里

- 现象：会话、`.credentials.yaml`、`profiles/` 都在 `rootfs/root/.dsh`。
- 影响：换镜像（VERSION 变更）会丢掉全部会话和账号授权；工作区已经外置，但记忆没有。
- 已修：`files/home/.dsh` → `/root/.dsh` 整目录 bind，`ensureLayout()` 里把老 rootfs 的
  `.dsh` 迁出来（真机日志：「会话与凭据已迁出 rootfs（5 项）」）。新写入都落在
  `files/home/.dsh`（profiles / sessions / storages / .credentials.yaml），rootfs 里那份是空挂载点。
  限制：迁移只覆盖"宿主目录为空"的场景；从旧版升级的真机回归还没做。

## P1 · 稳定性与体验

| # | 缺口 | 现象/影响 | 位置 |
|---|---|---|---|
| 8 | OEM 保活引导 | ColorOS/EMUI 会冻结后台；docs 要求首启引导，未实现 | 设置页 |
| 9 | 安全模式 | 插件坏导致引擎起不来时没有"安全模式"入口 | 引擎卡 |
| 10 | 老 rootfs 升级迁移未真机验证 | 工作区/设备密钥迁移只跑了全新安装 | `ensureLayout()` |
| 11 | 会话管理 | 重命名/归档/删除/正文搜索都没有（桥方法也没有） | 抽屉 |
| 12 | 诊断/日志导出 | 只能看 14 行日志；没有"导出诊断包"（遥测默认关） | 设置 |
| 13 | 错误文案 | 协议错误原样抛出（`gateway/...`），用户看不懂 | `store.fail` |
| 14 | 附件 | 单条 20MB 上限、图片 base64 直传；没有压缩/进度 | `attachments.upload` |
| 15 | `capabilities.actions` 没人用 | UI 不按能力 gate，未知宿主会点到不支持的方法 | 全部 UI |

## P2 · 平台与生态

- **iOS 遥控器**（阶段 2）：纯 JS 客户端，未开始。
- **多主机 / 扫码配对 / TLS**：现在配对码是长效共享密钥、ws 明文（docs/11 已列）。
- **远程、SSH、中继**：没有。
- **鸿蒙**：没开始，且不参与当前选型。
- **预设体系 L1/L2/L3**：现在是静态内置预设，没有"收一个锦囊/分享二维码"。
- **桌宠 / 社区 / 插件市场**：v1 明确不做。

## 工程债

| # | 债 | 说明 |
|---|---|---|
| 16 | 没有 CI | 仓库没有 `.github/`；构建靠手动 |
| 17 | `test/approval-card.test.ts` 没进 `npm test` | 只跑 e2e（13 条） |
| 18 | 文档过时 | docs/04 的仓库结构、docs/06 阶段 1 验收、docs/13「未实现」都过期；README「现在还没有的」已包含已做项 |
| 19 | 锁文件混乱 | 根同时有 `package-lock.json`、未提交的 `pnpm-lock.yaml` / `app/pnpm-lock.yaml` / `pnpm-workspace.yaml` |
| 20 | 没有单元测试 | store/projection/协议校验全靠 e2e |
| 21 | 遥测/诊断 | 默认关（对的），但"手动导出诊断包"没做 |

## 现在的优先级

P0 全部完成（2026-11-02）。接下来：

1. **P1 的 8、9、12**（后台保活引导、安全模式、诊断导出）—— 决定"出问题能不能自救"。
2. **UI 三批**（见 19）—— 第 1 批不依赖 P1，可以并行。
3. 工程债里先补 CI 和 `approval-card` 用例，避免后面 UI 大改时没有护栏。
