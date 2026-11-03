# 12 · 模型登录

> 结论：**两条路都通了。** Key 走 `credentials/set`，账号走 `account/startSignIn` +
> 系统浏览器 + 本机回调；令牌始终落在宿主上。

## 两条路，别混

| | 绑 API Key | 登录 DeepSeek 账号（OAuth） |
|---|---|---|
| 用户动作 | 粘贴一个 `sk-…` | 点「用 DeepSeek 账号登录」，浏览器里授权 |
| 好处 | 立刻可用 | 不用申请 Key，能看余额 |
| 现状 | ✅ 已验证可用 | ✅ 已接上（本机模式下从手机直接完成） |

## 一、绑 API Key —— 已经通了

真 dsh 有一个凭据网关：

```
POST /api/credentials/set      { ref: 'DEEPSEEK_API_KEY', value: 'sk-…' }   → { ok: true }
POST /api/credentials/unset    { ref: 'DEEPSEEK_API_KEY' }                  → 无返回值
POST /api/credentials/describe { refs: ['DEEPSEEK_API_KEY'] }
   → { "DEEPSEEK_API_KEY": { "configured": true, "source": "file", "writable": true } }
```

实测（真引擎 + 我们的桥，端到端）：

```
写入前: {"configured":false}
set     → {"ok":true}
写入后: {"configured":true}
unset   → {"ok":true}
清除后: {"configured":false}
```

**两个坑：**

1. **`credentials/set` 不接受空值**——schema 要求 `value` 至少 1 个字符，传 `''` 会被 `gateway/bad-request` 拒绝。
   要删除必须用 **`credentials/unset`**（`delete` / `remove` / `clear` 都是 404，只有 `unset` 存在）。
2. 传 `' '`（一个空格）会被接受——别拿它当"清空"，它真的会把空格写成 Key。

**这条很关键**：它意味着"用户在手机 App 里填 Key"这件事，实现上就是一次 RPC。
不需要我们自己做密钥管理，也不需要用户去改配置文件。

### Key 该存在哪

| 形态 | Key 存哪 | 理由 |
|---|---|---|
| 手机自己是宿主 | **手机**（引擎的凭据库） | 手机就是那台机器，和 dsh 桌面端一模一样 |
| 连电脑 | **电脑** | 手机不该持有宿主的长命凭据；换手机也不用重配 |

**两种情况下手机都不需要长期保存 Key。** 手机只是"把 Key 交给宿主"。

## 二、账号登录（OAuth）—— 已经接入

账号是**普通 HTTP RPC 方法**（`POST /api/account/<method>`）+ 一条 mux 状态流：

```
POST /api/account/getState      {}
POST /api/account/startSignIn   { client, callbackOrigin, loginSource }
POST /api/account/cancelSignIn  { attemptId }
POST /api/account/signOut       { client }

mux: account/watch
→ { type:'open', endpoint:'account/watch', payload:{ args:{} } }
← { type:'item', value:{ status:'signed-out', attempt, links:{ usageUrl, topUpUrl } } }
```

上一版在这里写过"HTTP 层没有 `account/*`，账号子系统在 mux 里"——**那也是错的**：
当时试的 `account/describe` / `status` / `login` / `startLogin` / `deviceCode` 都是不存在的名字，
404 只说明名字不对，不说明没有 HTTP 接口。

### 登录动作是有的 —— 上一版把方法名探错了

上一版试的是 `account/login`、`account/signIn`、`account/startLogin`、`account/authorize`、
`account/oauth`、`account/deviceCode`、`account/logout`，全部返回
`gateway/invocation-unavailable`，于是得出了"没有导出登录动作"的结论。

**那个结论错了。** 真正的方法名（从宿主包里的 controller 与实测确认）：

| 作用 | 方法 | 参数 |
|---|---|---|
| 读状态 | `account/getState` | `{}` |
| 开始登录 | **`account/startSignIn`** | `{ client, callbackOrigin, loginSource }` |
| 取消 | `account/cancelSignIn` | `{ attemptId }` |
| 退出 | `account/signOut` | `{ client }` |
| 状态流 | `account/watch` | mux stream，`{}` |

`client` 是 `{ version, locale, timezoneOffsetSeconds }`；
`loginSource` 是 `'web' | 'desktop'`；
`callbackOrigin` 必须是 **http + 显式端口的 loopback**（`http://127.0.0.1:8787`），
宿主会把它当 `redirect_uri` 的基址。

`authorizeUrl` **不在 `startSignIn` 的返回值里**（那一刻还是 `initializing`），
只能从 `account/watch` 流里等 `phase: 'waiting-browser'` 那一帧。

### 手机上的完整链路

```
App ──account.signIn──▶ 桥 ──account/startSignIn{ callbackOrigin: http://127.0.0.1:8787 }──▶ 引擎
                                          │
      系统浏览器 ◀── Linking.openURL(authorizeUrl) ── account/watch 推到 waiting-browser
                                          │
      https://platform.deepseek.com/dsh/authorize?... ──用户授权──▶ 302 到 127.0.0.1:8787/oauth/callback
                                          │
                              引擎换 token，落在宿主凭据库（App 不碰）
```

为什么这条在手机上行得通：

1. **回调落在引擎自己的 webServer 上**（`/oauth/callback` 是精确注册的路由），
   不带 dsh 的登录 cookie 也能进 —— 系统浏览器直接打得中。
2. **浏览器和引擎在同一台设备**，`127.0.0.1` 是同一个 loopback。
3. 令牌留在宿主，和 API Key 同一个落点，不需要第二套存储。

**连电脑模式不成立**：浏览器在手机上、回调在电脑上。桥只在 `baseUrl` 是 loopback 时
允许 `account.signIn`，否则返回 `unsupported` + 一句人话。

### 实测记录（桌面宿主 + 我们的桥）

```
account/getState        → {status: 'signed-out', links: {usageUrl, topUpUrl}}
account/startSignIn     → {status: 'signed-out', attempt: {id, phase: 'initializing'}}
account/watch           → {attempt: {id, phase: 'waiting-browser',
                                    authorizeUrl: 'https://platform.deepseek.com/dsh/authorize?authorize_id=…'}}
account/cancelSignIn    → {attempt: {phase: 'cancelled'}}
```

`startSignIn` 真的会向 DeepSeek 的 `auth_init` 发请求，**但不会登录**，
所以可以反复测；不要拿它刷次数。

## 二点五、任意模型提供商（渠道）

API Key 不只用于 DeepSeek：设置页有一张「模型提供商」卡，可以加任何
OpenAI 兼容 / OpenAI Responses / Anthropic 协议的服务（openrouter、自建网关、公司内网……）。
这就是 dsh 官方「设置 › 模型 › 添加模型提供商」的简化版。

**界面**：列表（名称 + Base URL + 模型数 + 编辑/删除）+「添加模型提供商」。
表单和官方一样分两个 tab：

| tab | 怎么填 | 写到哪 |
|---|---|---|
| **第三方模型提供商** | 从内置目录（43 个，openai / anthropic / openrouter / google…）**下拉选** + API Key（地址可选） | `providers.<id>.apiKeyEnv` + 凭据；协议和模型由适配器提供 |
| **自定义模型 API** | 渠道 ID + 显示名 + 协议 + Base URL + Key → **获取模型** → 勾选 | `providers.<id> = {api,baseURL,models,apiKeyEnv}` |

两者都存同一张表 `llm-pi-ai.providers`，Key 都按路由 id 推导 ref（`openrouter` → `OPENROUTER_API_KEY`）。

**底层**（和官方 UI 同一套，实测于手机上的 dsh 0.2.1-rc.5）：

| 动作 | 真引擎调用 |
|---|---|
| 列已有渠道 | `settings/describe` → `llm-pi-ai.value.providers` |
| 拉模型 | `llm/discoverModels { settingsNs:'llm-pi-ai', request:{ baseURL, api, apiKey? } }` |
| 保存 | `settings/mutate { ns:'llm-pi-ai', ops:[{op:'set', path:['providers', id], value:profile}] }` + `credentials/set` |
| 删除 | `credentials/unset` + `settings/mutate { op:'unset', path:['providers', id] }` |

profile 形状：`{ displayName?, apiKeyEnv?, api, baseURL, models:[{id,name?,contextWindow?,maxTokens?}] }`；
Key 的 ref 由路由 id 推导：`OPENROUTER` → `OPENROUTER_API_KEY`。
协议标识是 `openai-completions` / `openai-responses` / `anthropic-messages`（界面显示成人话）。

桥对外只暴露四个方法：`providers.list` / `providers.discover` / `providers.save` / `providers.remove`。

## 三、所以"自由登录"成不成立

**成立，而且已经接上了。**

```
本机模式：装 App → 填 Key 或点「用 DeepSeek 账号登录」→ 系统浏览器授权 → 直接用
         全程不需要电脑，也不需要 dsh 桌面端
```

上一版写"要等本机引擎"，现在本机引擎已经在手机上了（见 [17-handoff.md](17-handoff.md)），
所以这条自动成立。配对码那条路只是"引擎在别人机器上"时的补充。

界面在设置页，**账号登录是主路径**（和 dsh 官方一致）：

- 第一张卡就是「DeepSeek 账号」，显示未登录 / 登录中 / 已登录；
  登录中给「重新打开授权页」和「取消」，已登录给「退出登录」和「查看用量」。
- 「查看用量」打开 `links.usageUrl`（`platform.deepseek.com/usage`，用量 + 余额 + 累计消费）。
  ⚠️ 早先误接成了 `links.topUpUrl`，点进去是充值页 —— 已修。
- 「DeepSeek API Key（备选）」默认**收起**，但折叠态有一个明确的「填写 API Key / 更换 API Key」
  按钮（点标题也能展开）；展开后是输入框 + 保存/清除。
  这是对齐 dsh-go 的做法：账号页里「账号登录」和「API Key」并列，
  Key 没有时直接填、已有 Key 时是「更换 / 清除」。
- 和 dsh-go 的一个差别：它能在界面上显示掩码 Key（`sk-…a3f9`），因为我们只从引擎的
  `credentials/describe` 拿到 `configured: true/false`，拿不回 Key 本身 ——
  手机不持有 Key 是有意为之，所以这里只显示「已配置 / 未配置」。

### "授权失败" 怎么排查

平台上的「授权失败」几乎都是**链接过期/已取消**，不是账号或网络问题：

1. `authorize_id` 是一次性的，App 每次点「登录」都会新建一个；旧标签页不能复用。
2. App 只在**用户在本机点登录**之后自动开浏览器，且只开未过期的尝试
   （别的设备/调试探针发起的不会自动开）。
3. 浏览器被关掉时，设置页点「重新打开授权页」——它打开的是**当前**这次尝试。
4. 真机上验证过：新鲜链接 → 点「登录」→ 回调写进 `.dsh/.credentials.yaml`，
   引擎用账号列模型成功。

## 四、下一步

1. **登录后切模型**：拿到账号后 `session/modelCatalog` 会多出 `deepseek-account` 的模型，
   界面该把「已登录」当成一个可选的渠道显示出来
2. **余额**：`account/getBalance` 已经能调，界面还没展示具体数字
3. **退出登录的并发**：`signOut` 会取消正在跑的账号任务，界面要提示"有任务被中断"
4. **真机复验**：这条只在桌面宿主上验过，手机 rootfs 里的 dsh 版本还需要跑一遍

> ⚠️ 探测时误写过一个假 Key 到**隔离实例**的 `DSH_HOME`（`artifacts/dsh-home`），
> 那个目录是丢弃的，没有碰真实 home。教训：`credentials/set` 是真的会写盘，测试要用一次性环境。
