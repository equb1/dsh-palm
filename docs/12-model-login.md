# 12 · 模型登录

> 结论：**能做，而且已经验证了一半。** 但要分清"登录"落在哪台机器上。

## 两条路，别混

| | 绑 API Key | 登录 DeepSeek 账号（OAuth） |
|---|---|---|
| 用户动作 | 粘贴一个 `sk-…` | 点「用 DeepSeek 账号登录」，浏览器里授权 |
| 好处 | 立刻可用 | 不用申请 Key，能看余额 |
| 现状 | ✅ **已验证可用** | ⚠️ HTTP 层没有，走 mux 流 |

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

## 二、账号登录（OAuth）—— 路径存在，但要验证

真 dsh 的 HTTP 层**没有** `account/*`：

```
account/describe / status / login / startLogin / deviceCode  →  全部 HTTP 404
```

但在 WebSocket mux 上有一个 `account/watch` 流：

```
→ { type:'open', endpoint:'account/watch', payload:{ args:{} } }
← { type:'item', value:{ status:'signed-out', links:{ usageUrl, topUpUrl } } }
```

说明账号子系统**在 mux 里，不在 HTTP RPC 里**。

### 但登录动作没有导出（实测）

我把 mux 上的候选端点全开了一遍：

```
account/watch        → {"status":"signed-out","attempt":null,"links":{…}}      ✓ 存在
account/login        → gateway/invocation-unavailable
account/signIn       → gateway/invocation-unavailable
account/startLogin   → gateway/invocation-unavailable
account/authorize    → gateway/invocation-unavailable
account/oauth        → gateway/invocation-unavailable
account/deviceCode   → gateway/invocation-unavailable
account/logout       → gateway/invocation-unavailable
```

错误信息统一是 **"no active Remote method exports this endpoint"**——不是方法名写错，是**这个 profile 里根本没有导出登录动作**。

结论：**手机端没法远程触发宿主登录。** 登录是桌面宿主自己的事（Electron 主进程里），web profile 只暴露"当前状态"。

### 所以现在能做的只有两件

1. **读状态**：`account/watch` 告诉我们宿主有没有登录、余额链接在哪 —— 这个可以接
2. **写 Key**：`credentials/set` —— 这个已经接好了

要真正"从手机上完成登录"，只能等**本机引擎**：那时引擎在手机上，可以自己开系统浏览器走 OAuth，回到 App 拿令牌。见 [13-local-engine.md](13-local-engine.md)。

### 为什么"让宿主去登录"比"App 自己 OAuth"好

1. **授权在浏览器里完成**，本来就发生在有屏幕的那台机器上
2. **令牌留在宿主**，和 API Key 同一个落点，不需要第二套存储
3. **手机端零改动**：手机只看 `status`，登录态由宿主广播

如果手机自己是宿主，这条也成立——只不过"打开浏览器"变成了手机上的系统浏览器，
授权完回到 App，引擎拿到令牌。

## 三、所以"自由登录"成不成立

**成立，但前提是本机引擎。**

```
本机模式：装 App → 填 Key 或登录账号（存在手机上的引擎）→ 直接用
         全程不需要电脑，也不需要 dsh 桌面端
```

现在做不到，不是因为登录方案不对，而是因为**手机上还没有引擎**（阶段 1 未开工）。
配对码那条路只是"引擎在别人机器上"时的补充。

## 四、下一步

1. 协议加两个方法：`credentials.describe` / `credentials.set`（桥转发给宿主）
2. App 加一屏「模型」：填 Key、看状态、看余额（余额接口待探）
3. 探 `account/*` 的 mux 端点，把 OAuth 接上
4. 本机引擎落地后，这两条自动复用到手机上

> ⚠️ 探测时误写过一个假 Key 到**隔离实例**的 `DSH_HOME`（`artifacts/dsh-home`），
> 那个目录是丢弃的，没有碰真实 home。教训：`credentials/set` 是真的会写盘，测试要用一次性环境。
