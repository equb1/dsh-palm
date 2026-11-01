package cool.cnb.dshpalm.host

import android.content.Intent
import com.facebook.react.bridge.Arguments
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

    @ReactMethod
    fun logs(promise: Promise) {
        promise.resolve(Arguments.createArray().apply { HostRuntime.logs().forEach { pushString(it) } })
    }

    private fun toMap(s: HostRuntime.Status): WritableMap = Arguments.createMap().apply {
        putString("engine", s.engine)
        putString("bridge", s.bridge)
        putInt("port", s.port)
        putString("error", s.error)
        putDouble("since", s.since.toDouble())
    }

    private fun prefs() = ctx.getSharedPreferences("dsh-palm", android.content.Context.MODE_PRIVATE)

    private fun defaultEngineCmd(): String =
        prefs().getString("engineCmd", null)
            ?: "proot-distro login ubuntu -- dsh web --host 127.0.0.1 --port 8787 --no-open"

    private fun defaultBridgeCmd(): String =
        prefs().getString("bridgeCmd", null)
            ?: "cd ~ && node dsh-palm-bridge.cjs http://127.0.0.1:8787 {token} {port}"
}
