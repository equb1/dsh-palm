package cool.cnb.dshpalm.host

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * 前台服务：把引擎和桥挂在一个常驻通知下面。
 *
 * 命令从 Intent extra 里来（engineCmd / bridgeCmd / port），
 * 这样同一份代码在真机（proot + node）和模拟器（假命令）上都能跑。
 */
class HostService : Service() {

    companion object {
        const val CHANNEL_ID = "dsh-palm-host"
        const val NOTIFICATION_ID = 4701
        const val ACTION_START = "cool.cnb.dshpalm.host.START"
        const val ACTION_STOP = "cool.cnb.dshpalm.host.STOP"

        const val EXTRA_ENGINE_CMD = "engineCmd"
        const val EXTRA_BRIDGE_CMD = "bridgeCmd"
        const val EXTRA_PORT = "port"

        fun startIntent(context: Context, engineCmd: String?, bridgeCmd: String?, port: Int): Intent =
            Intent(context, HostService::class.java).apply {
                action = ACTION_START
                if (engineCmd != null) putExtra(EXTRA_ENGINE_CMD, engineCmd)
                if (bridgeCmd != null) putExtra(EXTRA_BRIDGE_CMD, bridgeCmd)
                if (port > 0) putExtra(EXTRA_PORT, port)
            }

        fun stopIntent(context: Context): Intent =
            Intent(context, HostService::class.java).apply { action = ACTION_STOP }
    }

    private var engineCmd = ""
    private var bridgeCmd = ""
    private var port = 8788
    /** 上一次写进通知的文字，避免每 2% 进度都重画一遍 */
    private var lastNotification = ""
    /** startForeground 之后才允许 notify()：之前发通知会被系统当成后台通知 */
    private var foregroundStarted = false

    /** 进度/状态变化就更新常驻通知：锁屏上也能看到"解压 42%"这种话 */
    private val statusListener: (HostRuntime.Status) -> Unit = { s ->
        updateNotification(statusText(s))
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        HostRuntime.addListener(statusListener)
    }

    override fun onDestroy() {
        HostRuntime.removeListener(statusListener)
        super.onDestroy()
    }

    private fun statusText(s: HostRuntime.Status): String = when {
        s.engine == "failed" || s.bridge == "failed" -> s.error ?: "启动失败"
        s.engine == "ready" && s.bridge == "ready" -> "已就绪"
        s.phase.isNotEmpty() ->
            s.phase + if (s.progress in 1..99) " · ${s.progress}%" else ""
        else -> "引擎启动中…"
    }

    private fun updateNotification(text: String) {
        if (!foregroundStarted || text == lastNotification) return
        lastNotification = text
        runCatching {
            getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(text))
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        android.util.Log.i("dsh-palm", "[service] onStartCommand action=" + (intent?.action ?: "null") + " engine=" + (intent?.getStringExtra(EXTRA_ENGINE_CMD) ?: "null"))
        if (intent?.action == ACTION_STOP) {
            HostRuntime.stop()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        // 命令来源优先级：Intent extra > 外部配置文件 > 默认值
        // 配置文件放 getExternalFilesDir(null)/host.json，adb 可以直接推，
        // 联调时不用在手机上敲长命令。
        val cfg = readConfigFile()
        android.util.Log.i("dsh-palm", "[service] externalDir=" + (getExternalFilesDir(null)?.absolutePath ?: "null") + " cfg=" + (cfg != null))
        engineCmd = intent?.getStringExtra(EXTRA_ENGINE_CMD)
            ?: cfg?.optString("engineCmd")?.takeIf { it.isNotBlank() }
            ?: defaultEngineCmd()
        bridgeCmd = intent?.getStringExtra(EXTRA_BRIDGE_CMD)
            ?: cfg?.optString("bridgeCmd")?.takeIf { it.isNotBlank() }
            ?: defaultBridgeCmd()
        port = intent?.getIntExtra(EXTRA_PORT, 0)
            ?: cfg?.optInt("port", 0)?.takeIf { it > 0 }
            ?: 8788

        startInForeground()
        applySafeModeIfRequested()
        val runtimePaths = RuntimeInstaller.paths(applicationContext)
        HostRuntime.start(
            context = applicationContext,
            engineCmd = engineCmd,
            bridgeCmd = bridgeCmd,
            bridgePort = port,
            prepare = {
                RuntimeInstaller.install(
                    applicationContext,
                    { line -> HostRuntime.note(line) },
                    { label, pct -> HostRuntime.progress(label, pct) },
                ) &&
                    RuntimeInstaller.ensureExecutable(applicationContext) &&
                    RuntimeInstaller.ensureLayout(applicationContext) { line -> HostRuntime.note(line) } &&
                    RuntimeInstaller.ensurePatch(applicationContext) { line -> HostRuntime.note(line) } &&
                    RuntimeInstaller.ensureShims(applicationContext) { line -> HostRuntime.note(line) }
            },
            env = mapOf(
                "PROOT_LOADER" to runtimePaths.loader,
                "LD_LIBRARY_PATH" to runtimePaths.libDir.absolutePath,
                // 关键：不覆盖 PATH 的话，引擎继承的是 Android 的 PATH（/system/bin…），
                // 客体里的 dash 按它去找 head/sleep 一律 not found。
                "PATH" to "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                "HOME" to "/root",
                "TERM" to "dumb",
                "LANG" to "C.UTF-8",
                // 桥的设备密钥放在 bind 进来的 /bridge 上：换镜像不会把配对状态冲掉
                "DSH_PALM_DEVICES" to "/bridge/devices.json",
            ),
        )
        return START_STICKY
    }

    /**
     * 安全模式：把 profiles 目录挪走，让引擎用默认 profile 重新起。
     * 只在"连续失败 3 次"或用户在设置里主动点「安全模式重启」时触发，一次性。
     */
    private fun applySafeModeIfRequested() {
        val prefs = getSharedPreferences("dsh-palm", MODE_PRIVATE)
        if (!prefs.getBoolean("safeModeNext", false)) return
        prefs.edit().putBoolean("safeModeNext", false).apply()
        val profiles = java.io.File(applicationContext.filesDir, "home/.dsh/profiles")
        if (!profiles.exists()) {
            HostRuntime.note("[host] 安全模式：profiles 不存在，直接按默认启动")
            return
        }
        val backup = java.io.File(profiles.parentFile, "profiles.broken-${System.currentTimeMillis()}")
        val ok = profiles.renameTo(backup)
        HostRuntime.note("[host] 安全模式：profiles → ${backup.name}（ok=$ok）")
    }

    /** 外部配置文件（可选）：{ "engineCmd": "...", "bridgeCmd": "...", "port": 8788 } */
    private fun readConfigFile(): org.json.JSONObject? {
        return try {
            val dir = getExternalFilesDir(null) ?: return null
            val file = java.io.File(dir, "host.json")
            if (!file.exists()) return null
            org.json.JSONObject(file.readText())
        } catch (_: Throwable) {
            null
        }
    }
    private fun startInForeground() {
        val text = "引擎启动中…"
        lastNotification = text
        foregroundStarted = true
        val notification = buildNotification(text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, "锦囊引擎", NotificationManager.IMPORTANCE_LOW).apply {
            description = "引擎和桥的运行状态"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("锦囊")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setOngoing(true)
            .build()
    }

    /** 真机默认：proot 里跑 dsh web */
    private fun defaultEngineCmd(): String {
        val home = getSharedPreferences("dsh-palm", MODE_PRIVATE).getString("engineCmd", null)
        if (!home.isNullOrBlank()) return home
        // 首装时 node 还没解压出来，hasNode 一定是 false —— 但 APK 里带着 payload 就说明
        // 装完就有 node。只按 hasNode 判断会在「全新安装的第一次启动」选错成冒烟脚本。
        return if (RuntimeInstaller.hasNode(this) || hasPayloadAsset()) {
            RuntimeInstaller.engineCmd(this)
        } else {
            RuntimeInstaller.smokeEngineCmd(this)
        }
    }

    /** APK 的 assets 里有没有运行时载荷（决定装完能不能跑真 dsh） */
    private fun hasPayloadAsset(): Boolean =
        runCatching { assets.list("")?.contains(RuntimeInstaller.PAYLOAD_ASSET) == true }.getOrDefault(false)

    /** 真机默认：跑桥（token 和 port 由运行时替换） */
    private fun defaultBridgeCmd(): String {
        val saved = getSharedPreferences("dsh-palm", MODE_PRIVATE).getString("bridgeCmd", null)
        if (!saved.isNullOrBlank()) return saved
        // 桥和引擎跑在同一个 rootfs 里（/opt/dsh/bridge），不能落到 Android 的 node 上
        return RuntimeInstaller.bridgeCmd(this)
    }
}
