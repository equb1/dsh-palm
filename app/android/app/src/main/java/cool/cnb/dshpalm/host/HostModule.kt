package cool.cnb.dshpalm.host

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
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
                val uris = mutableListOf<Uri>()
                val clip = data.clipData
                if (clip != null) {
                    for (i in 0 until clip.itemCount) {
                        clip.getItemAt(i)?.uri?.let { uris.add(it) }
                    }
                } else {
                    data.data?.let { uris.add(it) }
                }
                if (uris.isEmpty()) {
                    promise.resolve(Arguments.createArray())
                    return
                }
                Thread({
                    try {
                        val arr = Arguments.createArray()
                        for (uri in uris) {
                            val item = readUriAsAttachment(uri)
                            if (item != null) arr.pushMap(item)
                        }
                        promise.resolve(arr)
                    } catch (t: Throwable) {
                        promise.reject("pick_failed", t.message ?: "读取文件失败", t)
                    }
                }, "dsh-pick-file").start()
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
            val sessionId = extractSessionIdFromTag(tag)
            val notifyId = (tag ?: title).hashCode()
            val intent = Intent(ctx, cool.cnb.dshpalm.MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
                if (!sessionId.isNullOrBlank()) {
                    putExtra(EXTRA_NOTIFY_SESSION_ID, sessionId)
                }
            }
            val pending = PendingIntent.getActivity(
                ctx,
                notifyId,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val notification = Notification.Builder(ctx, EVENT_CHANNEL)
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
     * 冷启动时读「分享到锦囊」的内容。
     * 文本直接给 JS；图片先复制到缓存，返回路径，由 JS 在下一条消息里上传。
     * 读完清掉 intent，避免回到 App 时又处理一次。
     */
    @ReactMethod
    fun getInitialShare(promise: Promise) {
        try {
            val intent = ctx.currentActivity?.intent
            if (intent == null || intent.action != Intent.ACTION_SEND) {
                promise.resolve(null)
                return
            }
            val map = Arguments.createMap()
            val text = intent.getStringExtra(Intent.EXTRA_TEXT)
            if (!text.isNullOrBlank()) map.putString("text", text)

            @Suppress("DEPRECATION")
            val uri = intent.getParcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM)
            if (uri != null) {
                val name = "share-${System.currentTimeMillis()}"
                val file = java.io.File(ctx.cacheDir, name)
                ctx.contentResolver.openInputStream(uri)?.use { input ->
                    file.outputStream().use { output -> input.copyTo(output) }
                }
                if (file.exists() && file.length() > 0) {
                    map.putString("path", file.absolutePath)
                    map.putString("name", name)
                    map.putString("mime", intent.type ?: "application/octet-stream")
                }
            }
            intent.action = null
            intent.removeExtra(Intent.EXTRA_STREAM)
            intent.removeExtra(Intent.EXTRA_TEXT)
            promise.resolve(map)
        } catch (t: Throwable) {
            promise.reject("share_failed", t)
        }
    }

    /** 把本地文件读成 base64（分享进来的图片上传用） */
    @ReactMethod
    fun readFileBase64(path: String, promise: Promise) {
        try {
            val file = java.io.File(path)
            if (!file.exists()) {
                promise.reject("no_file", "文件不存在")
                return
            }
            promise.resolve(android.util.Base64.encodeToString(file.readBytes(), android.util.Base64.NO_WRAP))
        } catch (t: Throwable) {
            promise.reject("read_failed", t)
        }
    }

    /**
     * 打开系统文件选择器（支持图片、视频、音频及任意类型文件，支持多选）。
     * 返回 [{ name, mime, size, base64 }]。
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

    private fun readUriAsAttachment(uri: Uri): WritableMap? {
        val cr = ctx.contentResolver
        val mime = cr.getType(uri) ?: "application/octet-stream"
        var displayName: String? = null
        var size: Long = -1L
        runCatching {
            cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
                        displayName = cursor.getString(nameIdx)
                    }
                    val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                        size = cursor.getLong(sizeIdx)
                    }
                }
            }
        }
        if (size > MAX_ATTACHMENT_BYTES) {
            throw IllegalArgumentException("文件「${displayName ?: "附件"}」超过 20MB 上限")
        }
        val bytes = cr.openInputStream(uri)?.use { it.readBytes() } ?: return null
        if (bytes.isEmpty()) return null
        if (bytes.size > MAX_ATTACHMENT_BYTES) {
            throw IllegalArgumentException("文件「${displayName ?: "附件"}」超过 20MB 上限")
        }
        val finalName = displayName?.takeIf { it.isNotBlank() } ?: run {
            val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: "bin"
            "attachment-${System.currentTimeMillis()}.$ext"
        }
        val base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        return Arguments.createMap().apply {
            putString("name", finalName)
            putString("mime", mime)
            putDouble("size", bytes.size.toDouble())
            putString("base64", base64)
        }
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

    companion object {
        private const val EVENT_CHANNEL = "dsh-palm-events"
        private const val EXTRA_NOTIFY_SESSION_ID = "dsh_session_id"
        private const val PICK_FILE_REQ = 4712
        private const val MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
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
