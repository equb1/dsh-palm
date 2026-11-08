package cool.cnb.dshpalm.host

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.Socket
import java.util.ArrayDeque
import java.util.concurrent.Executors

/**
 * M3.2：局域网宿主双模发现。
 *
 * 1. NsdManager (mDNS _dsh-palm._tcp) + WifiManager.MulticastLock 组播硬件放行；
 * 2. 局域网 C 段并发探活（Subnet Probe 8787 端口），防止家用路由器 AP 隔离或 IGMP 丢弃。
 */
class LanDiscovery(private val ctx: Context) {
    companion object {
        const val SERVICE_TYPE = "_dsh-palm._tcp"
        const val DEFAULT_PORT = 8787
        private const val TIMEOUT_MS = 3_500L
    }

    private val main = Handler(Looper.getMainLooper())
    private var nsd: NsdManager? = null
    private var listener: NsdManager.DiscoveryListener? = null
    private var promise: Promise? = null
    private val queue = ArrayDeque<NsdServiceInfo>()
    private val found = LinkedHashMap<String, WritableMap>()
    private var resolving = false
    private var finished = false
    private var multicastLock: WifiManager.MulticastLock? = null
    private val probePool = Executors.newFixedThreadPool(16)

    fun start(timeoutMs: Long = TIMEOUT_MS, promise: Promise) {
        stopInternal()
        this.promise = promise
        finished = false

        // 1. 获取 MulticastLock 允许硬件接收 UDP 5353 组播
        runCatching {
            val wifi = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            multicastLock = wifi?.createMulticastLock("dsh_palm_mdns")?.apply {
                setReferenceCounted(true)
                acquire()
            }
        }

        // 2. 启动 mDNS
        val manager = ctx.getSystemService(Context.NSD_SERVICE) as? NsdManager
        if (manager != null) {
            nsd = manager
            val discovery = object : NsdManager.DiscoveryListener {
                override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) {
                    // mDNS 启动失败仍由 Subnet Probe 兜底
                }

                override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) = Unit
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
        }

        // 3. 启动局域网 C 段智能探活（双重保险）
        startSubnetProbe()

        main.postDelayed({ finish() }, timeoutMs)
    }

    fun stop(promise: Promise? = null) {
        finish()
        promise?.resolve(true)
    }

    private fun startSubnetProbe() {
        probePool.execute {
            val localIpv4 = getLocalIpv4Address() ?: return@execute
            val parts = localIpv4.split(".")
            if (parts.size != 4) return@execute
            val prefix = "${parts[0]}.${parts[1]}.${parts[2]}."

            // 优先探测网关、本机相邻 IP 及常见 IP
            val currentLast = parts[3].toIntOrNull() ?: 1
            val targets = mutableListOf<String>()
            targets.add("${prefix}1")
            for (offset in 1..20) {
                val up = currentLast + offset
                if (up in 2..254) targets.add("$prefix$up")
                val down = currentLast - offset
                if (down in 2..254) targets.add("$prefix$down")
            }
            // 补齐其余常用 IP
            for (i in 2..60) {
                val ip = "$prefix$i"
                if (!targets.contains(ip)) targets.add(ip)
            }

            for (targetIp in targets) {
                if (finished) break
                probePool.execute {
                    if (finished) return@execute
                    try {
                        val socket = Socket()
                        socket.connect(InetSocketAddress(targetIp, DEFAULT_PORT), 180)
                        socket.close()

                        main.post {
                            if (!finished) {
                                addDirect(targetIp, DEFAULT_PORT, "电脑宿主 ($targetIp)")
                            }
                        }
                    } catch (_: Throwable) {
                        // 端口未开放
                    }
                }
            }
        }
    }

    private fun getLocalIpv4Address(): String? {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
        val activeNetwork = cm.activeNetwork ?: return null
        val linkProps: LinkProperties = cm.getLinkProperties(activeNetwork) ?: return null
        for (linkAddress in linkProps.linkAddresses) {
            val address = linkAddress.address
            if (address is Inet4Address && !address.isLoopbackAddress) {
                return address.hostAddress
            }
        }
        return null
    }

    private fun addDirect(host: String, port: Int, defaultName: String) {
        val id = "$host:$port"
        if (found.containsKey(id)) return
        val map: WritableMap = Arguments.createMap().apply {
            putString("id", id)
            putString("name", defaultName)
            putString("host", host)
            putInt("port", port)
            putString("kind", "desktop")
            putString("fingerprint", "")
            putString("version", "1")
        }
        found[id] = map
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
        releaseLocks()
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
        releaseLocks()
        runCatching { listener?.let { nsd?.stopServiceDiscovery(it) } }
        listener = null
        nsd = null
        resolving = false
        queue.clear()
        found.clear()
        promise = null
    }

    private fun releaseLocks() {
        runCatching {
            if (multicastLock?.isHeld == true) {
                multicastLock?.release()
            }
        }
        multicastLock = null
    }
}
