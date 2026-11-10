# OTA 热更新（EAS Update）

从 0.2.4 开始接入 `expo-updates`，使用 Expo 官方 **EAS Update** 托管。

纯 JS / TS / 图片资源改动可以不走安装包，直接发布更新；改了 Kotlin、权限、原生依赖
必须提升 `runtimeVersion` 并重新打包 APK。

## 项目信息

```text
Expo 账号: npcdyc
项目:      @npcdyc/dsh-palm
Project ID: ad6383fb-4e39-4086-b79a-789f22d84eba
更新地址:  https://u.expo.dev/ad6383fb-4e39-4086-b79a-789f22d84eba
通道:      production
runtimeVersion: 0.2.4
```

地址同时写在：

- `app/app.json` → `expo.updates.url`
- `app/android/app/src/main/AndroidManifest.xml` → `expo.modules.updates.EXPO_UPDATE_URL`

## 发布热更新

改完 JS / TS / 图片后，在 `app/` 目录执行：

```powershell
cd app
npx eas-cli update --branch production --platform android --message "这次改了什么" --environment production
```

如果 EAS 的打包进程内存不够（`JavaScript heap out of memory`），在电脑上先导出再用 `--skip-bundler`：

```powershell
$env:NODE_OPTIONS='--max-old-space-size=4096'
npx expo export --platform android --output-dir dist
npx eas-cli update --skip-bundler --input-dir dist --branch production --platform android --environment production
```

发布完成后，App 启动时会自动检查（`ON_LOAD`），下载完成后下次冷启动生效；
也可以打开「设置 → 版本与更新 → 检查并更新」。

## 什么时候必须重新打 APK

- 改了 `app/android/**`（Kotlin / Gradle / Manifest / 权限 / 原生依赖）；
- 新增或升级了带原生代码的 npm 包（例如 `expo-crypto`）；
- 换了 `runtimeVersion`。

流程：

1. 提升 `app/app.json` 的 `version` 与 `runtimeVersion`；
2. 同步 `app/android/app/src/main/res/values/strings.xml` 的 `expo_runtime_version`；
3. 提升 `app/android/app/build.gradle` 的 `versionCode` / `versionName`；
4. 在 `app/android` 执行：
   ```powershell
   .\gradlew.bat :app:assembleRelease
   ```

EAS Update 会按 `runtimeVersion` 精确匹配，旧安装包不会拿到新 runtime 的包。

## 本地构建注意

`expo-updates` 的 `createReleaseUpdatesResources` 任务输入里没有源码文件，Gradle 会误判
UP-TO-DATE，导致嵌入包的 asset hash 清单过期（新图片在 release 包里显示空白）。
`app/android/app/build.gradle` 里已强制这个任务每次重新执行，不要移除。

## 排查

- **检查更新提示「连不上 Expo 更新服务器」**：手机到 `u.expo.dev` 的网络被阻断/重置；
  换网络或开代理再试。安装包和通道配置本身没问题。
- **一直显示内置版本**：开发构建 / Expo Go 默认禁用 `expo-updates`，必须安装 release APK。
- **下载后没变化**：热更新在下次冷启动生效；手动点「检查并更新」会提示立即重启。
- **runtimeVersion 不一致**：EAS 上没有当前 runtime 的更新，客户端会保持内置版本。
- **通道不对**：当前安装包使用 `production` 通道，发布时必须是
  `--branch production`（或在 EAS 控制台把分支映射到该通道）。
