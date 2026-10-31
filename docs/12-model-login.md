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
POST /api/credentials/set     { ref: 'DEEPSEEK_API_KEY', value: 'sk-…' }
POST /api/credentials/describe { refs: ['DEEPSEEK_API_KEY'] }
→ { "DEEPSEEK_API_KEY": { "configured": true, "source": "file", "writable": true } }
```

实测：写进去之后 `describe` 立刻变成 `configured: true`。

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

说明账号子系统**在 mux 里，不在 HTTP RPC 里**。也就是说：

- 登录动作大概率是一个 mux 端点（`account/login` 之类）返回一个授权 URL，UI 打开浏览器，登录完成后 `account/watch` 推 `status:'signed-in'`
- 我们要复刻这条路，得先把 `account/*` 的流端点试出来

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
