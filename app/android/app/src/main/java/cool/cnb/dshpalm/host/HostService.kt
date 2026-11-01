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

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
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
        RuntimeInstaller.ensureExecutable(applicationContext)
        val runtimePaths = RuntimeInstaller.paths(applicationContext)
        HostRuntime.start(
            context = applicationContext,
            engineCmd = engineCmd,
            bridgeCmd = bridgeCmd,
            bridgePort = port,
            prepare = {
                RuntimeInstaller.install(applicationContext) { line -> HostRuntime.note(line) } &&
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
            ),
        )
        return START_STICKY
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
        val notification = buildNotification("引擎启动中…")
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
                return if (RuntimeInstaller.hasNode(this)) RuntimeInstaller.engineCmd(this) else RuntimeInstaller.smokeEngineCmd(this)
    }

    /** 真机默认：跑桥（token 和 port 由运行时替换） */
    private fun defaultBridgeCmd(): String {
        val saved = getSharedPreferences("dsh-palm", MODE_PRIVATE).getString("bridgeCmd", null)
        if (!saved.isNullOrBlank()) return saved
        // 桥和引擎跑在同一个 rootfs 里（/opt/dsh/bridge），不能落到 Android 的 node 上
        return RuntimeInstaller.bridgeCmd(this)
    }
}
