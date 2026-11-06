package cool.cnb.dshpalm.host

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import java.util.ArrayDeque

/**
 * M3.2：局域网宿主发现。
 *
 * 只发现 `_dsh-palm._tcp`，不自动配对；调用方拿到 host/port/name/指纹后
 * 仍然要让用户确认配对码。组播被系统过滤时返回空列表，手动地址仍可用。
 */
class LanDiscovery(private val ctx: Context) {
    companion object {
        const val SERVICE_TYPE = "_dsh-palm._tcp"
        private const val TIMEOUT_MS = 4_000L
    }

    private val main = Handler(Looper.getMainLooper())
    private var nsd: NsdManager? = null
    private var listener: NsdManager.DiscoveryListener? = null
    private var promise: Promise? = null
    private val queue = ArrayDeque<NsdServiceInfo>()
    private val found = LinkedHashMap<String, WritableMap>()
    private var resolving = false
    private var finished = false

    fun start(timeoutMs: Long = TIMEOUT_MS, promise: Promise) {
        stopInternal()
        this.promise = promise
        finished = false
        val manager = ctx.getSystemService(Context.NSD_SERVICE) as? NsdManager
        if (manager == null) {
            promise.resolve(Arguments.createArray())
            return
        }
        nsd = manager
        val discovery = object : NsdManager.DiscoveryListener {
            override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) {
                finish()
            }

            override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) {
                finish()
            }

            override fun onDiscoveryStarted(serviceType: String?) = Unit

            override fun onDiscoveryStopped(serviceType: String?) = Unit

            override fun onServiceFound(serviceInfo: NsdServiceInfo?) {
                if (serviceInfo != null) {
                    queue.add(serviceInfo)
                    drain()
                }
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo?) = Unit
        }
        listener = discovery
        runCatching { manager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery) }
            .onFailure { finish() }
        main.postDelayed({ finish() }, timeoutMs)
    }

    fun stop(promise: Promise? = null) {
        finish()
        promise?.resolve(true)
    }

    private fun drain() {
        if (resolving || finished) return
        val info = queue.pollFirst() ?: return
        val manager = nsd ?: return
        resolving = true
        runCatching {
            manager.resolveService(info, object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
                    resolving = false
                    drain()
                }

                override fun onServiceResolved(serviceInfo: NsdServiceInfo?) {
                    if (serviceInfo != null) add(serviceInfo)
                    resolving = false
                    drain()
                }
            })
        }.onFailure {
            resolving = false
            drain()
        }
    }

    private fun add(info: NsdServiceInfo) {
        val attrs = info.attributes ?: emptyMap()
        fun text(key: String): String? = attrs[key]?.toString(Charsets.UTF_8)?.takeIf { it.isNotBlank() }
        val host = info.host?.hostAddress ?: return
        if (info.port <= 0) return
        val id = text("id") ?: info.serviceName ?: "$host:${info.port}"
        val map: WritableMap = Arguments.createMap().apply {
            putString("id", id)
            putString("name", text("name") ?: info.serviceName ?: host)
            putString("host", host)
            putInt("port", info.port)
            putString("kind", text("kind") ?: "desktop")
            putString("fingerprint", text("fp") ?: "")
            putString("version", text("v") ?: "1")
        }
        found[id] = map
    }

    private fun finish() {
        if (finished) return
        finished = true
        runCatching { listener?.let { nsd?.stopServiceDiscovery(it) } }
        listener = null
        nsd = null
        resolving = false
        queue.clear()
        val result = Arguments.createArray()
        for (map in found.values) result.pushMap(map)
        found.clear()
        val pending = promise
        promise = null
        pending?.resolve(result)
    }

    private fun stopInternal() {
        finished = true
        runCatching { listener?.let { nsd?.stopServiceDiscovery(it) } }
        listener = null
        nsd = null
        resolving = false
        queue.clear()
        found.clear()
        promise = null
    }
}
