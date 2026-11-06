package cool.cnb.dshpalm.host

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.StatusBarManager
import android.appwidget.AppWidgetManager
import android.content.ClipData
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

/**
 * RN 侧的入口：start / stop / status / logs。
 * 界面通过这些方法控制原生服务，不再需要 adb。
 */
class HostModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

    @Volatile private var pendingPickPromise: Promise? = null

    init {
        ctx.addActivityEventListener(object : BaseActivityEventListener() {
            override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
                if (requestCode != PICK_FILE_REQ) return
                val promise = pendingPickPromise ?: return
                pendingPickPromise = null
                if (resultCode != Activity.RESULT_OK || data == null) {
                    promise.resolve(Arguments.createArray())
                    return
                }
                val uris = collectStreamUris(data)
                if (uris.isEmpty()) {
                    promise.resolve(Arguments.createArray())
                    return
                }
                // 复制 + 算 hash 在后台线程做，主线程不碰文件内容
                Thread({
                    try {
                        val sources = uris.map { IntakeSource(uri = it.toString()) }
                        val (files, errors) = intakeSources(sources)
                        settleIntake(promise, files, errors)
                    } catch (t: Throwable) {
                        promise.reject("intake_failed", t.message ?: "读取文件失败", t)
                    }
                }, "dsh-intake-pick").start()
            }
        })
    }

    override fun getName(): String = "DshPalmHost"

    @ReactMethod
    fun start(engineCmd: String?, bridgeCmd: String?, port: Int, promise: Promise) {
        try {
            // 不要把默认值在这里填进去：服务端还有"配置文件 > 默认值"的优先级，
            // 这里塞了值就会把配置文件盖掉。空就传 null。
            val intent = HostService.startIntent(
                ctx,
                engineCmd?.takeIf { it.isNotBlank() },
                bridgeCmd?.takeIf { it.isNotBlank() },
                if (port > 0) port else 0,
            )
            ctx.startForegroundService(intent)
            promise.resolve(true)
        } catch (t: Throwable) {
            promise.reject("start_failed", t)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        try {
            ctx.startService(HostService.stopIntent(ctx))
            promise.resolve(true)
        } catch (t: Throwable) {
            promise.reject("stop_failed", t)
        }
    }

    @ReactMethod
    fun status(promise: Promise) {
        val s = HostRuntime.status()
        promise.resolve(toMap(s))
    }

    /**
     * JS 同步「有没有回合在跑」。
     * HostRuntime.onTrimMemory 在 moderate 档只会在没有活跃回合时停 proot，
     * 避免把正在生成的回复一起杀掉。
     */
    @ReactMethod
    fun setRunActive(active: Boolean, promise: Promise) {
        try {
            HostRuntime.setActiveRun(active)
            promise.resolve(true)
        } catch (_: Throwable) {
            promise.resolve(false)
        }
    }

    /** 智能预热用：当前是否在充电 + 是否连的是 WiFi */
    @ReactMethod
    fun deviceConditions(promise: Promise) {
        try {
            val battery = ctx.getSystemService(android.os.BatteryManager::class.java)
            val charging = battery?.isCharging == true
            val connectivity = ctx.getSystemService(android.net.ConnectivityManager::class.java)
            var wifi = false
            if (connectivity != null) {
                val network = connectivity.activeNetwork
                if (network != null) {
                    val capabilities = connectivity.getNetworkCapabilities(network)
                    wifi = capabilities?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) == true
                }
            }
            promise.resolve(
                Arguments.createMap().apply {
                    putBoolean("charging", charging)
                    putBoolean("wifi", wifi)
                },
            )
        } catch (_: Throwable) {
            // 问不到就让 JS 当成"不满足智能预热条件"
            promise.resolve(null)
        }
    }

    // ---- M3.2 LAN 发现 ----

    @Volatile private var lanDiscovery: LanDiscovery? = null

    /** Android 16 的本地网络访问权限；旧系统直接返回 true。 */
    @ReactMethod
    fun requestLanPermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT < 36) {
                promise.resolve(true)
                return
            }
            val permission = "android.permission.ACCESS_LOCAL_NETWORK"
            if (ctx.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
                promise.resolve(true)
                return
            }
            val activity = ctx.currentActivity
            if (activity == null) {
                promise.resolve(false)
                return
            }
            pendingLanPermission = promise
            activity.requestPermissions(arrayOf(permission), LAN_PERM_REQ)
        } catch (_: Throwable) {
            promise.resolve(false)
        }
    }

    /** 扫描 `_dsh-palm._tcp`；4 秒后返回当前发现的列表。 */
    @ReactMethod
    fun discoverLanHosts(timeoutMs: Double, promise: Promise) {
        try {
            lanDiscovery?.stop(null) // 旧实例先释放
        } catch (_: Throwable) {
            // ignore
        }
        val discovery = LanDiscovery(ctx)
        lanDiscovery = discovery
        discovery.start(if (timeoutMs > 0) timeoutMs.toLong() else 4_000L, promise)
    }

    @ReactMethod
    fun stopLanDiscovery(promise: Promise) {
        try {
            lanDiscovery?.stop(promise) ?: promise.resolve(true)
            lanDiscovery = null
        } catch (_: Throwable) {
            promise.resolve(false)
        }
    }

    // ---- M3.3 系统入口 ----

    @ReactMethod
    fun requestPinWidget(promise: Promise) {
        try {
            val activity = ctx.currentActivity
            if (activity == null || Build.VERSION.SDK_INT < 26) {
                promise.resolve(false)
                return
            }
            val manager = AppWidgetManager.getInstance(ctx)
            if (!manager.isRequestPinAppWidgetSupported) {
                promise.resolve(false)
                return
            }
            val provider = ComponentName(ctx, cool.cnb.dshpalm.system.DshWidgetProvider::class.java)
            promise.resolve(manager.requestPinAppWidget(provider, null, null))
        } catch (_: Throwable) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun requestAddTile(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT < 33) {
                promise.resolve(false)
                return
            }
            val manager = ctx.getSystemService(StatusBarManager::class.java)
            if (manager == null) {
                promise.resolve(false)
                return
            }
            val component = ComponentName(ctx, cool.cnb.dshpalm.system.DshTileService::class.java)
            val icon = Icon.createWithResource(ctx, cool.cnb.dshpalm.R.drawable.ic_dsh_tile)
            manager.requestAddTileService(component, "锦囊", icon, ctx.mainExecutor) { result ->
                promise.resolve(
                    result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED
                        || result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED,
                )
            }
        } catch (_: Throwable) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun getSystemEntryStatus(promise: Promise) {
        try {
            val manager = AppWidgetManager.getInstance(ctx)
            val widgetCount =
                manager.getAppWidgetIds(ComponentName(ctx, cool.cnb.dshpalm.system.DshWidgetProvider::class.java)).size
            val overlay = android.provider.Settings.canDrawOverlays(ctx)
            promise.resolve(
                Arguments.createMap().apply {
                    putInt("widgetCount", widgetCount)
                    putBoolean("overlayAllowed", overlay)
                },
            )
        } catch (_: Throwable) {
            promise.resolve(null)
        }
    }

    /**
     * 请求通知权限（Android 13+）。
     * 结果是异步的：这次返回当前状态，用户点完「允许」后下次调用才变 true。
     */
    @ReactMethod
    fun requestNotificationPermission(promise: Promise) {
        try {
            val activity = ctx.currentActivity
            if (activity == null) {
                promise.resolve(false)
                return
            }
            val manager = ctx.getSystemService(NotificationManager::class.java)
            if (manager.areNotificationsEnabled()) {
                promise.resolve(true)
                return
            }
            if (Build.VERSION.SDK_INT >= 33) {
                activity.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 4711)
            }
            promise.resolve(false)
        } catch (t: Throwable) {
            promise.reject("perm_failed", t)
        }
    }

    /** 发一条本地通知（任务完成 / 待审批 / 提问）。tag 相同会覆盖同一条。 */
    @ReactMethod
    fun notifyEvent(title: String, body: String, tag: String?, promise: Promise) {
        notifyEventInternal(title, body, tag, null, promise)
    }

    /**
     * 带目标路由的通知（M3.3）：点通知直接回到具体会话/审批卡。
     * 保留 notifyEvent 旧签名，老 JS 仍可工作。
     */
    @ReactMethod
    fun notifyEventEx(title: String, body: String, tag: String?, route: ReadableMap?, promise: Promise) {
        notifyEventInternal(title, body, tag, route, promise)
    }

    private fun notifyEventInternal(
        title: String,
        body: String,
        tag: String?,
        route: ReadableMap?,
        promise: Promise,
    ) {
        try {
            // 原生层强校验：如果当前 Activity 正在前台且拥有焦点，绝不弹系统通知（防止刚切回前台瞬间误弹）
            val activity = ctx.currentActivity
            if (activity != null && activity.hasWindowFocus()) {
                promise.resolve(false)
                return
            }
            val manager = ctx.getSystemService(NotificationManager::class.java)
            if (!manager.areNotificationsEnabled()) {
                promise.resolve(false)
                return
            }
            ensureEventChannel(manager)
            val tagSessionId = extractSessionIdFromTag(tag)
            val sessionId = readString(route, "sessionId") ?: tagSessionId
            val approvalId = readString(route, "approvalId") ?: extractApprovalIdFromTag(tag)
            val engine = readString(route, "engine")
            val notifyId = (tag ?: title).hashCode()
            val uri = Uri.parse("dshpalm://session").buildUpon().apply {
                if (!sessionId.isNullOrBlank()) appendQueryParameter("id", sessionId)
                if (!engine.isNullOrBlank()) appendQueryParameter("engine", engine)
                if (!approvalId.isNullOrBlank()) appendQueryParameter("approval", approvalId)
                appendQueryParameter("source", "notification")
            }.build()
            val intent = Intent(ctx, cool.cnb.dshpalm.MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                action = Intent.ACTION_VIEW
                data = uri
                if (!sessionId.isNullOrBlank()) putExtra(EXTRA_NOTIFY_SESSION_ID, sessionId)
                if (!approvalId.isNullOrBlank()) putExtra(EXTRA_NOTIFY_APPROVAL_ID, approvalId)
                if (!engine.isNullOrBlank()) putExtra(EXTRA_NOTIFY_ENGINE, engine)
            }
            val pending = PendingIntent.getActivity(
                ctx,
                notifyId,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(ctx, EVENT_CHANNEL)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(ctx)
            }
            val notification = builder
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(Notification.BigTextStyle().bigText(body))
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build()
            manager.notify(notifyId, notification)
            promise.resolve(true)
        } catch (t: Throwable) {
            promise.reject("notify_failed", t)
        }
    }

    /** 读取点击通知带过来的目标会话 ID（读一次即清除） */
    @ReactMethod
    fun getInitialNotificationSession(promise: Promise) {
        try {
            val intent = ctx.currentActivity?.intent
            val sessionId = intent?.getStringExtra(EXTRA_NOTIFY_SESSION_ID)
            if (!sessionId.isNullOrBlank()) {
                intent.removeExtra(EXTRA_NOTIFY_SESSION_ID)
                promise.resolve(sessionId)
            } else {
                promise.resolve(null)
            }
        } catch (t: Throwable) {
            promise.resolve(null)
        }
    }

    private fun extractSessionIdFromTag(tag: String?): String? {
        if (tag.isNullOrBlank()) return null
        // 支持 "run:<sessionId>" 或 "approval:<sessionId>:<approvalId>"
        val parts = tag.split(":")
        return if (parts.size >= 2 && parts[1].startsWith("session-")) parts[1] else null
    }

    private fun extractApprovalIdFromTag(tag: String?): String? {
        if (tag.isNullOrBlank()) return null
        val parts = tag.split(":")
        return if (parts.size >= 3 && parts[1].startsWith("session-")) parts[2] else null
    }

    private fun ensureEventChannel(manager: NotificationManager) {
        if (Build.VERSION.SDK_INT < 26) return
        if (manager.getNotificationChannel(EVENT_CHANNEL) != null) return
        manager.createNotificationChannel(
            NotificationChannel(EVENT_CHANNEL, "锦囊提醒", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "任务完成、需要确认、有问题要回答"
                setShowBadge(true)
            },
        )
    }

    /** 后台保活：系统是否已经把本应用排除在省电限制之外 */
    @ReactMethod
    fun isBatteryWhitelisted(promise: Promise) {
        try {
            val pm = ctx.getSystemService(android.os.PowerManager::class.java)
            promise.resolve(pm?.isIgnoringBatteryOptimizations(ctx.packageName) == true)
        } catch (t: Throwable) {
            promise.resolve(false)
        }
    }

    /** 打开系统的电池优化设置（先尝试直接申请，再退到应用详情） */
    @ReactMethod
    fun openBatterySettings(promise: Promise) {
        try {
            val direct = Intent(
                android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                android.net.Uri.parse("package:${ctx.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(direct)
            promise.resolve(true)
        } catch (t: Throwable) {
            runCatching {
                val fallback = Intent(
                    android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    android.net.Uri.parse("package:${ctx.packageName}"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(fallback)
            }
            promise.resolve(false)
        }
    }

    /** 标记"下次启动用安全模式"（设置页的按钮用） */
    @ReactMethod
    fun setSafeModeNext(enabled: Boolean, promise: Promise) {
        prefs().edit().putBoolean("safeModeNext", enabled).apply()
        promise.resolve(true)
    }

    /**
     * 收件一批附件：每项 `{uri?, path?, name?, mime?}`。
     * 只返回 `FileRef[]`（路径引用），文件已经落在 workspace/uploads。
     * 单个失败不拖垮整批；一个都没成功时 reject 中文原因。
     */
    @ReactMethod
    fun intakeFiles(sources: ReadableArray, promise: Promise) {
        val list = mutableListOf<IntakeSource>()
        for (i in 0 until sources.size()) {
            val map = runCatching { sources.getMap(i) }.getOrNull() ?: continue
            list.add(
                IntakeSource(
                    uri = readString(map, "uri"),
                    path = readString(map, "path"),
                    name = readString(map, "name"),
                    mime = readString(map, "mime"),
                ),
            )
        }
        if (list.isEmpty()) {
            promise.resolve(Arguments.createArray())
            return
        }
        Thread({
            try {
                val (files, errors) = intakeSources(list)
                settleIntake(promise, files, errors)
            } catch (t: Throwable) {
                promise.reject("intake_failed", t.message ?: "读取附件失败", t)
            }
        }, "dsh-intake-files").start()
    }

    /**
     * 取走系统分享进来的内容：`{text?, files: FileRef[]}`；
     * 没有待处理的分享时返回 null。支持 ACTION_SEND 与 ACTION_SEND_MULTIPLE。
     */
    @ReactMethod
    fun intakeShare(promise: Promise) {
        val intent = ShareInbox.take()
        if (intent == null) {
            promise.resolve(null)
            return
        }
        // 先把轻量信息取出来，再把 Intent 标记成已消费：
        // Activity 因配置变化重建时，同一个 share Intent 不会再被收一次。
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        val uris = collectStreamUris(intent)
        intent.action = null
        intent.removeExtra(Intent.EXTRA_STREAM)
        intent.removeExtra(Intent.EXTRA_TEXT)
        Thread({
            try {
                val sources = uris.map { IntakeSource(uri = it.toString()) }
                val (files, errors) = intakeSources(sources)
                val hasText = !text.isNullOrBlank()
                if (files.size() == 0 && !hasText) {
                    if (errors.isNotEmpty()) promise.reject("intake_failed", errors.first())
                    else promise.resolve(null)
                } else {
                    if (errors.isNotEmpty()) Log.w(TAG, "部分分享附件失败：" + errors.joinToString("；"))
                    val map = Arguments.createMap()
                    if (hasText && text != null) map.putString("text", text)
                    map.putArray("files", files)
                    if (errors.isNotEmpty()) {
                        map.putArray("errors", Arguments.createArray().apply { errors.forEach { pushString(it) } })
                    }
                    promise.resolve(map)
                }
            } catch (t: Throwable) {
                promise.reject("intake_failed", t.message ?: "读取分享内容失败", t)
            }
        }, "dsh-intake-share").start()
    }

    /** 丢掉还没消费的分享 Intent（例如用户清空了待发附件） */
    @ReactMethod
    fun clearShare(promise: Promise) {
        ShareInbox.clear()
        promise.resolve(true)
    }

    /**
     * 打开系统文件选择器（ACTION_OPEN_DOCUMENT，多选）。
     * 选中的文件直接由原生收件进 uploads，返回 `FileRef[]`。
     */
    @ReactMethod
    fun pickAttachments(mimeType: String?, promise: Promise) {
        val activity = ctx.currentActivity
        if (activity == null) {
            promise.reject("no_activity", "当前界面不可用")
            return
        }
        pendingPickPromise?.resolve(Arguments.createArray())
        pendingPickPromise = promise
        try {
            val targetMime = mimeType?.takeIf { it.isNotBlank() } ?: "*/*"
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = targetMime
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
            activity.startActivityForResult(intent, PICK_FILE_REQ)
        } catch (t: Throwable) {
            try {
                val targetMime = mimeType?.takeIf { it.isNotBlank() } ?: "*/*"
                val fallback = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = targetMime
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
                activity.startActivityForResult(Intent.createChooser(fallback, "选择附件"), PICK_FILE_REQ)
            } catch (e: Throwable) {
                pendingPickPromise = null
                promise.reject("pick_failed", e.message ?: "无法打开文件选择器", e)
            }
        }
    }

    /* --------------------------- 收件内部实现 --------------------------- */

    private data class IntakeSource(
        val uri: String? = null,
        val path: String? = null,
        val name: String? = null,
        val mime: String? = null,
    )

    /**
     * content:// 走 ContentResolver，file:// 或无 scheme 的路径直接读文件。
     * 每个文件独立结算，返回（成功数组, 失败原因列表）。
     */
    private fun intakeSources(sources: List<IntakeSource>): Pair<WritableArray, List<String>> {
        val files = Arguments.createArray()
        val errors = mutableListOf<String>()
        for (source in sources) {
            val uri = source.uri
            val path = source.path
            val result = try {
                if (!uri.isNullOrBlank()) {
                    val parsed = Uri.parse(uri)
                    val scheme = parsed.scheme
                    if (scheme == null || scheme == "file") {
                        Intake.intakePath(ctx, java.io.File(parsed.path ?: uri), source.name, source.mime)
                    } else {
                        Intake.intake(ctx, parsed, source.name, source.mime)
                    }
                } else if (!path.isNullOrBlank()) {
                    Intake.intakePath(ctx, java.io.File(path), source.name, source.mime)
                } else {
                    IntakeResult.fail("附件来源为空")
                }
            } catch (t: SecurityException) {
                IntakeResult.fail("没有读取这个文件的权限；请重新分享或重新选择")
            } catch (t: Throwable) {
                IntakeResult.fail("读取附件失败：${t.message ?: "未知错误"}")
            }
            val ref = result.ref
            if (ref != null) files.pushMap(fileRefMap(ref)) else errors.add(result.error ?: "读取附件失败")
        }
        return files to errors
    }

    /** 全失败才 reject；部分成功时把失败写日志，不打断用户 */
    private fun settleIntake(promise: Promise, files: WritableArray, errors: List<String>) {
        if (files.size() == 0 && errors.isNotEmpty()) {
            promise.reject("intake_failed", errors.first())
            return
        }
        if (errors.isNotEmpty()) Log.w(TAG, "部分附件失败：" + errors.joinToString("；"))
        promise.resolve(files)
    }

    private fun fileRefMap(ref: FileRef): WritableMap = Arguments.createMap().apply {
        putString("path", ref.path)
        putString("relPath", ref.relPath)
        putString("name", ref.name)
        putString("displayName", ref.displayName)
        putString("mime", ref.mime)
        putDouble("bytes", ref.bytes.toDouble())
        putString("hash", ref.hash)
    }

    private fun readString(map: ReadableMap?, key: String): String? {
        if (map == null || !map.hasKey(key) || map.isNull(key)) return null
        return runCatching { map.getString(key) }.getOrNull()
    }

    /** 分享 Intent 的单/多附件都在这里：clipData 优先，其次 EXTRA_STREAM */
    private fun collectStreamUris(intent: Intent): List<Uri> {
        val uris = mutableListOf<Uri>()
        val clip = intent.clipData
        if (clip != null) {
            for (i in 0 until clip.itemCount) {
                clip.getItemAt(i)?.uri?.let { uris.add(it) }
            }
        }
        if (uris.isEmpty()) {
            when (val extra = intent.extras?.get(Intent.EXTRA_STREAM)) {
                is Uri -> uris.add(extra)
                is ArrayList<*> -> extra.forEach { item -> (item as? Uri)?.let { uris.add(it) } }
                is Array<*> -> extra.forEach { item -> (item as? Uri)?.let { uris.add(it) } }
            }
        }
        intent.data?.let { if (uris.isEmpty()) uris.add(it) }
        return uris
    }

    /** 读取本地 UI 缓存（首屏秒开会话列表） */
    @ReactMethod
    fun readUiCache(promise: Promise) {
        try {
            val file = java.io.File(ctx.filesDir, UI_CACHE_FILE)
            if (!file.exists()) {
                promise.resolve(null)
                return
            }
            promise.resolve(file.readText(Charsets.UTF_8))
        } catch (_: Throwable) {
            promise.resolve(null)
        }
    }

    /** 写入本地 UI 缓存 */
    @ReactMethod
    fun writeUiCache(json: String, promise: Promise) {
        try {
            val file = java.io.File(ctx.filesDir, UI_CACHE_FILE)
            file.writeText(json, Charsets.UTF_8)
            promise.resolve(true)
        } catch (_: Throwable) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun logs(promise: Promise) {
        promise.resolve(Arguments.createArray().apply { HostRuntime.logs().forEach { pushString(it) } })
    }

    /**
     * 分享一个工作区文件（P0 1.5 补齐）。
     *
     * `contentUri` 由 expo-file-system 的 `File.contentUri` 生成
     * （authority `${applicationId}.FileSystemFileProvider`，覆盖 filesDir/workspace），
     * 这里只负责发 ACTION_SEND；必须带 ClipData + FLAG_GRANT_READ_URI_PERMISSION，
     * 否则接收方拿不到读权限。
     */
    @ReactMethod
    fun shareFile(contentUri: String?, mime: String?, title: String?, promise: Promise) {
        try {
            val raw = contentUri?.trim().orEmpty()
            if (raw.isEmpty()) {
                promise.reject("share_failed", "文件路径为空")
                return
            }
            val uri = Uri.parse(raw)
            val type = mime?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
            val label = title?.takeIf { it.isNotBlank() } ?: "文件"
            val send = Intent(Intent.ACTION_SEND).apply {
                this.type = type
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TITLE, label)
                clipData = ClipData.newUri(ctx.contentResolver, label, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(send, "分享「$label」").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val activity = ctx.currentActivity
            if (activity != null) activity.startActivity(chooser) else ctx.startActivity(chooser)
            promise.resolve(true)
        } catch (t: Throwable) {
            promise.reject("share_failed", t.message ?: "分享失败", t)
        }
    }

    companion object {
        @Volatile private var pendingLanPermission: Promise? = null

        /** MainActivity 转发权限结果；只处理本地网络权限。 */
        fun onLanPermissionResult(granted: Boolean) {
            val promise = pendingLanPermission ?: return
            pendingLanPermission = null
            promise.resolve(granted)
        }

        private const val TAG = "DshPalmHost"
        private const val EVENT_CHANNEL = "dsh-palm-events"
        private const val EXTRA_NOTIFY_SESSION_ID = "dsh_session_id"
        private const val EXTRA_NOTIFY_APPROVAL_ID = "dsh_approval_id"
        private const val EXTRA_NOTIFY_ENGINE = "dsh_engine"
        private const val PICK_FILE_REQ = 4712
        private const val LAN_PERM_REQ = 4713
        private const val UI_CACHE_FILE = "ui-cache.json"
    }

    private fun toMap(s: HostRuntime.Status): WritableMap = Arguments.createMap().apply {
        putString("engine", s.engine)
        putString("bridge", s.bridge)
        putInt("port", s.port)
        putString("error", s.error)
        putDouble("since", s.since.toDouble())
        putString("phase", s.phase)
        putInt("progress", s.progress)
        putString("pairCode", s.pairCode)
    }

    private fun prefs() = ctx.getSharedPreferences("dsh-palm", android.content.Context.MODE_PRIVATE)

    private fun defaultEngineCmd(): String =
        prefs().getString("engineCmd", null)
            ?: "proot-distro login ubuntu -- dsh web --host 127.0.0.1 --port 8787 --no-open"

    private fun defaultBridgeCmd(): String =
        prefs().getString("bridgeCmd", null)
            ?: "cd ~ && node dsh-palm-bridge.cjs http://127.0.0.1:8787 {token} {port}"
}
