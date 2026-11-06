# 发布、首装与升级（E8）

> 状态：2026-11-06 夜间。当前设备装的是 **release** 包（签名 `55df28b9`），
> 新版 `0.2.0 (2)` 正在用同签名覆盖升级（`adb install -r`，保留数据）。
> 本文只写发布流程和已确认的签名/数据迁移事实；**卸载/安装前必须让用户确认**。

## 1. 当前制品

| 项 | 值 |
|---|---|
| APK | `app/android/app/build/outputs/apk/release/app-release.apk` |
| 大小 / sha256 | 244.2 MiB（256,049,858 B）/ `D078796D372AC0A13B62DCC86A71D15897E98F84F64B4E8E4D8F1322DF12C1BA` |
| applicationId | `cool.cnb.dshpalm` |
| versionName / versionCode | `0.2.0` / `2` |
| 签名 | V2，`CN=DSH Palm`，证书 SHA-256 `50de0609c1f781651301906c0781fe0dd039288bd5efc32883d03b9dac86628c` |
| keystore | `app/android/keystore/release.jks` + `app/android/keystore.properties`（gitignore） |
| 签名备份 | `D:\dsh-palm-backup\keystore-2026-11-05\`、`C:\Users\chenf\Desktop\dsh-palm-keystore-backup-2026-11-05\` |

构建：`cd app/android && sh gradlew :app:assembleRelease`；版本号用
`DSH_PALM_VERSION_CODE` / `DSH_PALM_VERSION_NAME` 覆盖（升级 release 必须递增 versionCode）。

> 2026-11-06 05:05 用合并后的 `feat/settings-pages`（含 U2/U4/U5/U6/U8/E2/E3/E5）重新构建，
> 新 sha256 见上表；versionCode 仍是 1，首装可用，覆盖升级前必须 bump。
>
> 2026-11-06 05:20 真机首装已执行（用户确认）：debug 卸载 → release 安装成功，首启解压
> runtime 约 46s；**发现 release 完整引擎桥卡在 95%，90 秒超时回轻引擎**。
> 根因：release 的 `android:usesCleartextTraffic` 默认 false，Java 健康检查访问
> `http://127.0.0.1:8788/health` 被系统拦掉；debug manifest 允许 cleartext，所以只在 release 复现。
> 修复：manifest 加 `android:usesCleartextTraffic="true"`，并把首启超时调到 180s。
> 修复后真机：`本机 dsh · 完整` 就绪；浏览器 OAuth 显示「授权已完成」，账号登录成功，
> 模型 V4.1-Flash 可选。release 首装链路通过。
> 2026-11-06 06:10 又修了 release 发消息报错：patch 脚本 CRLF + 完整引擎默认 provider
> `deepseek-official` 不可路由（缺 `DEEPSEEK_API_KEY`）。现在 bridge 会自动切到
> `deepseek-account`，真机完整引擎 `hi` 正常回复。当前 sha256 见上表。
>
> 2026-11-06 夜间：versionCode `2` / versionName `0.2.0`，同签名 `adb install -r`
> 覆盖升级（保留 release 数据）；包含完整引擎 delete/search/shell、深色主题、M2.1–M2.4、
> LAN 发现、QS/小组件/通知直达。升级后先跑 `npm run release:preflight` 和
> `npm run device:regression`。

## 2. 预检（只读，随时可跑）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-preflight.ps1
```

2026-11-06 夜间输出摘要：APK/元数据/签名/设备/keystore 备份全部 PASS；
设备已装 `0.2.0 (2)`（release 证书 `55df28b9`），预检仍会打一条“debug/release 证书不同”
的通用 WARN（脚本按 debug 基线比较，设备本身是 release）。

## 3. 关键事实：debug → release 不能直接覆盖（当前设备已经是 release）

- 设备当前 debug 包签名与 release 证书不同，`adb install -r app-release.apk` 会报
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE`。
- release 默认 `debuggable=false`，装完后 **`run-as` 不可用**；因此
  「卸载前 `run-as tar` 备份 files/shared_prefs → 装 release → 再 restore」这条路**不成立**。
- 结论：在这台设备上，**debug → release 的切换必然丢 App 数据**（会话、SecureStore 渠道、登录态）。
  重装后需要重新登录/配置渠道。工作区文件如果重要，先手动 `adb pull` 出来。

## 4. 路径 A：干净首装（推荐用来验证 release）

需要用户确认后执行；会清掉当前 debug 包的 App 数据。

```bash
# 0) 预检 + 记录当前版本
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-preflight.ps1
adb shell dumpsys package cool.cnb.dshpalm | findstr version

# 1) 备份还能拿到的外部资产（工作区文件；App 私有数据 release 里读不回）
adb shell "run-as cool.cnb.dshpalm tar -cf /sdcard/workspace.tar files/workspace" || true
adb pull /sdcard/workspace.tar scratch/workspace-backup.tar || true

# 2) 卸载 debug
adb uninstall cool.cnb.dshpalm

# 3) 装 release、启动
adb install -r app/android/app/build/outputs/apk/release/app-release.apk
adb shell am start -W -n cool.cnb.dshpalm/.MainActivity
```

验收清单：

- [ ] 首启 15–25s（解压 rootfs/python），之后秒开；
- [ ] 首页/会话抽屉/设置 6 组正常，`npm run device:regression` 9 步全绿；
- [ ] 轻引擎渠道需要重新配置：账号模式要在设置里重新登录（M2.7），或填 API Key；
- [ ] 文件页能列 `/workspace`（新装为空）；
- [ ] 收不到通知/后台被杀时按「保活」页处理。

回滚：`adb uninstall cool.cnb.dshpalm` 后装 debug APK（同样会清数据）。

## 5. 路径 B：保留数据的升级（release → release / 同签名 debug）

只有**签名相同**时 `adb install -r` 才能覆盖并保留数据：

- release → release：递增 `DSH_PALM_VERSION_CODE` 后 `assembleRelease`，直接 `adb install -r`；
- debug → debug：同机 debug keystore，可直接 `-r`；
- 想让这台设备以后 debug↔release 无损切换：从现在起让 debug 变体也用 release keystore
  重新构建并**卸载装一次**（这次仍会清数据），之后两者同签名即可互覆盖。

## 6. 发布检查单

1. `npm run verify` + `npm --prefix app run typecheck` 全绿；
2. `npm run device:regression` 真机 9 步全绿；
3. 版本号已递增；`scripts/release-preflight.ps1` 全 PASS；
4. keystore + 密码两处备份存在且可解密；
5. 用户确认后再执行路径 A 的卸载/安装；
6. 装完跑「验收清单」，失败按回滚步骤退回 debug。
