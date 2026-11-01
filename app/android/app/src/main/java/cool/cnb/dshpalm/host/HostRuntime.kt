package cool.cnb.dshpalm.host

import android.content.Context
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

/**
 * 引擎和桥的进程管理（原生层的核心）。
 *
 * 设计要点：
 * - 两条命令都是**可配置字符串**，带 {token} / {port} 占位符。
 *   真机上引擎是 `proot-distro login ubuntu -- dsh web ...`，桥是 `node bridge.cjs ...`；
 *   模拟器上跑不了 arm64 rootfs，所以换成假命令来验证进程管理本身。
 * - 引擎先起，从 stdout 里抓 token，再起桥。
 * - 两个进程都有看门狗：非主动停止时按退避重启。
 * - 日志进环形缓冲（500 行）供界面看；**同时落盘**到 `filesDir/logs/engine.log`
 *   （环形，超过 2MB 截半）。落盘是必须的：App 被系统回收后 logcat 里什么都没有，
 *   而"引擎为什么没监听 8787"只能靠子进程的原话判断。
 */
object HostRuntime {

    data class Status(
        val engine: String,   // stopped | starting | ready | failed
        val bridge: String,
        val port: Int,
        val error: String?,
        val since: Long,
    )

    private val TOKEN_RE = Regex("token=([A-Za-z0-9_\\\\-]+)")
    private const val LOG_LIMIT = 500
    private const val READY_TIMEOUT_MS = 40_000L

    /** 引擎（dsh web）固定监听本机 8787，桥的 {url} 占位符替换成它 */
    private const val ENGINE_URL = "http://127.0.0.1:8787"

    /** 落盘日志：超过 MAX 就砍到只剩最后 KEEP 字节，避免无限涨 */
    private const val LOG_FILE = "logs/engine.log"
    private const val LOG_FILE_MAX = 2L * 1024 * 1024
    private const val LOG_FILE_KEEP = 1L * 1024 * 1024

    private val logs = ArrayDeque<String>()
    private val listeners = CopyOnWriteArrayList<(Status) -> Unit>()
    private val logFileLock = Any()
    private var logOut: FileOutputStream? = null
    private var logFilePath: File? = null
    private var logBytes = 0L
    private val stamp = SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US)

    @Volatile private var engineProcess: Process? = null
    @Volatile private var bridgeProcess: Process? = null
    @Volatile private var stopping = false
    @Volatile private var engine = "stopped"
    @Volatile private var bridge = "stopped"
    @Volatile private var port = 8788
    @Volatile private var lastError: String? = null
    @Volatile private var since = 0L
    @Volatile private var token = ""
    @Volatile private var extraEnv: Map<String, String> = emptyMap()

    @Synchronized
    fun status(): Status = Status(engine, bridge, port, lastError, since)

    fun logs(): List<String> = synchronized(logs) { logs.toList() }

    fun addListener(l: (Status) -> Unit) {
        listeners.add(l)
        l(status())
    }

    fun removeListener(l: (Status) -> Unit) {
        listeners.remove(l)
    }

    private fun publish() {
        val s = status()
        for (l in listeners) {
            try {
                l(s)
            } catch (_: Throwable) {
            }
        }
    }

    private fun log(line: String) {
        android.util.Log.i("dsh-palm", line)
        synchronized(logs) {
            logs.addLast(line)
            while (logs.size > LOG_LIMIT) logs.removeFirst()
        }
        appendToFile(line)
    }

    /** 给 HostService 等外部调用方用（安装进度等，也要落盘） */
    fun note(line: String) = log(line)

    /**
     * 打开落盘日志。每次服务启动都调一次：进程被回收后文件还在，下次接着追加。
     */
    fun attachLogFile(context: Context) {
        synchronized(logFileLock) {
            runCatching { logOut?.close() }
            logOut = null
            val file = File(context.filesDir, LOG_FILE)
            runCatching {
                file.parentFile?.mkdirs()
                logOut = FileOutputStream(file, true)
                logFilePath = file
                logBytes = file.length()
            }.onFailure { android.util.Log.e("dsh-palm", "日志文件打不开: ${it.message}") }
        }
    }

    private fun appendToFile(line: String) {
        synchronized(logFileLock) {
            val out = logOut ?: return
            val text = stamp.format(Date()) + " " + line + "\n"
            runCatching {
                out.write(text.toByteArray(Charsets.UTF_8))
                out.flush()
                logBytes += text.toByteArray(Charsets.UTF_8).size
                if (logBytes > LOG_FILE_MAX) rotateFile()
            }.onFailure { android.util.Log.e("dsh-palm", "写日志失败: ${it.message}") }
        }
    }

    /** 超过上限：只保留最后 KEEP 字节（从换行处切，别切半行） */
    private fun rotateFile() {
        val out = logOut ?: return
        val file = logFilePath ?: return
        runCatching { out.close() }
        logOut = null
        runCatching {
            val text = file.readText()
            val start = (text.length - LOG_FILE_KEEP.toInt()).coerceAtLeast(0)
            val cut = if (start == 0) 0 else text.indexOf('\n', start).let { if (it < 0) start else it + 1 }
            file.writeText("[日志超过 2MB，已截断]\n" + text.substring(cut))
            logOut = FileOutputStream(file, true)
            logBytes = file.length()
        }.onFailure {
            runCatching { logOut?.close() }
            logOut = null
        }
    }

    /** 启动时的环境快照：排查"为什么跑不起来"时这一段的用处最大 */
    private fun logStartup(engineCmd: String, bridgeCmd: String, env: Map<String, String>) {
        log("[host] ===== 服务启动 =====")
        log("[host] engineCmd: $engineCmd")
        log("[host] bridgeCmd: ${maskToken(bridgeCmd)}")
        log("[host] bridgePort: $port")
        for ((k, v) in env.toSortedMap()) log("[host] env $k=$v")
    }

    /** 日志里打码 token。token 为空时不能调 String.replace("")——那会把每个字符之间塞满 *** */
    private fun maskToken(cmd: String): String = if (token.isEmpty()) cmd else cmd.replace(token, "***")

    /**
     * 启动引擎 + 桥。
     * @param engineCmd 引擎命令；stdout 里出现 `token=` 就算就绪
     * @param bridgeCmd 桥命令；`{token}` / `{port}` 会被替换
     */
    @Synchronized
    fun start(
        context: Context,
        engineCmd: String,
        bridgeCmd: String,
        bridgePort: Int,
        prepare: (() -> Boolean)? = null,
        env: Map<String, String> = emptyMap(),
    ) {
        if (engineProcess != null) {
            log("[host] 已经在跑，忽略重复启动")
            return
        }
        stopping = false
        lastError = null
        port = bridgePort
        since = System.currentTimeMillis()
        engine = "starting"
        bridge = "stopped"
        publish()

        extraEnv = env
        attachLogFile(context)
        logStartup(engineCmd, bridgeCmd, env)
        Thread({ runEngine(engineCmd, bridgeCmd, prepare) }, "dsh-engine").start()
    }

    @Synchronized
    fun stop() {
        stopping = true
        log("[host] 正在停止")
        runCatching { bridgeProcess?.destroy() }
        runCatching { engineProcess?.destroy() }
        bridgeProcess = null
        engineProcess = null
        engine = "stopped"
        bridge = "stopped"
        publish()
    }

    private fun runEngine(engineCmd: String, bridgeCmd: String, prepare: (() -> Boolean)?) {
        if (prepare != null) {
            val installed = try {
                prepare()
            } catch (t: Throwable) {
                log("[runtime] 准备异常: ${android.util.Log.getStackTraceString(t)}")
                false
            }
            if (!installed) {
                engine = "failed"
                lastError = "运行时镜像没装好"
                publish()
                return
            }
        }
        var attempt = 0
        while (!stopping) {
            attempt += 1
            try {
                log("[engine] 启动（第 $attempt 次）: $engineCmd")
                val p = ProcessBuilder("/system/bin/sh", "-c", engineCmd)
                    .redirectErrorStream(true)
                    .apply { environment().putAll(extraEnv) }
                    .start()
                engineProcess = p

                // 一个循环读到底：找到 token 就通知桥启动，然后继续读到 EOF。
                // 不能找到 token 就 return——关掉 stdout 会让子进程收到 EPIPE 立刻死。
                val reader = p.inputStream.bufferedReader()
                val readyFlag = java.util.concurrent.atomic.AtomicBoolean(false)
                startReadyWatchdog(p, readyFlag)
                var ready = false
                val deadline = System.currentTimeMillis() + READY_TIMEOUT_MS
                while (true) {
                    val line = reader.readLine() ?: break
                    log("[engine] $line")
                    if (!ready) {
                        val m = TOKEN_RE.find(line)
                        if (m != null) {
                            token = m.groupValues[1]
                            ready = true
                            readyFlag.set(true)
                            engine = "ready"
                            publish()
                            startBridge(bridgeCmd)
                        } else if (System.currentTimeMillis() > deadline) {
                            break
                        }
                    }
                }

                if (!ready) {
                    engine = "failed"
                    lastError = "引擎没在 ${READY_TIMEOUT_MS / 1000} 秒内打印 token"
                    publish()
                    runCatching { p.destroy() }
                    engineProcess = null
                    if (stopping) return
                    backoff(attempt)
                    continue
                }

                // 引擎退出（非主动停止）-> 重启
                val code = p.waitFor()
                engineProcess = null
                if (stopping) return
                engine = "failed"
                lastError = "引擎退出（exit=$code）"
                publish()
                log("[engine] 退出 code=$code")
                backoff(attempt)
            } catch (t: Throwable) {
                engineProcess = null
                engine = "failed"
                lastError = t.message ?: "引擎启动异常"
                publish()
                log("[engine] 异常: ${android.util.Log.getStackTraceString(t)}")
                if (stopping) return
                backoff(attempt)
            }
        }
    }

    /**
     * token 看门狗。
     *
     * 主循环卡在 readLine() 上时，`System.currentTimeMillis() > deadline` 那行根本没机会执行——
     * 子进程一声不吭就等于永远挂住。这里单独开一个线程，到点直接把进程收掉，让主循环回到重试。
     */
    private fun startReadyWatchdog(p: Process, ready: java.util.concurrent.atomic.AtomicBoolean) {
        Thread({
            val deadline = System.currentTimeMillis() + READY_TIMEOUT_MS
            while (!ready.get() && !stopping && System.currentTimeMillis() < deadline) {
                runCatching { Thread.sleep(500) }
            }
            if (!ready.get() && !stopping && engineProcess === p) {
                log("[engine] ${READY_TIMEOUT_MS / 1000} 秒没打印 token，结束它")
                runCatching { p.destroy() }
            }
        }, "dsh-engine-watchdog").start()
    }

    private fun backoff(attempt: Int) {
        val ms = when {
            attempt <= 1 -> 1_000L
            attempt == 2 -> 5_000L
            attempt == 3 -> 15_000L
            else -> 60_000L
        }
        runCatching { Thread.sleep(ms) }
    }

    private fun startBridge(bridgeCmd: String) {
        val cmd = bridgeCmd
            .replace("{url}", ENGINE_URL)
            .replace("{token}", token)
            .replace("{port}", port.toString())
        bridge = "starting"
        publish()
        Thread({
            try {
                log("[bridge] 启动: " + maskToken(cmd))
                // 桥也是 proot 起的，少一个环境变量就 CANNOT LINK EXECUTABLE
                val p = ProcessBuilder("/system/bin/sh", "-c", cmd)
                    .redirectErrorStream(true)
                    .apply { environment().putAll(extraEnv) }
                    .start()
                bridgeProcess = p
                Thread({ drain("bridge", p) }, "dsh-bridge-log").start()

                // 等 /health 通
                var ready = false
                val deadline = System.currentTimeMillis() + READY_TIMEOUT_MS
                while (!ready && System.currentTimeMillis() < deadline && !stopping) {
                    ready = healthOk()
                    if (!ready) Thread.sleep(500)
                }
                if (ready) {
                    bridge = "ready"
                    publish()
                } else {
                    bridge = "failed"
                    lastError = "桥没有在时限内就绪"
                    publish()
                    return@Thread
                }

                val code = p.waitFor()
                bridgeProcess = null
                if (!stopping) {
                    bridge = "failed"
                    lastError = "桥退出（exit=$code）"
                    publish()
                    log("[bridge] 退出 code=$code")
                }
            } catch (t: Throwable) {
                bridge = "failed"
                lastError = t.message ?: "桥启动异常"
                publish()
                log("[bridge] 异常: ${android.util.Log.getStackTraceString(t)}")
            }
        }, "dsh-bridge").start()
    }

    private fun drain(tag: String, p: Process) {
        runCatching {
            BufferedReader(InputStreamReader(p.inputStream)).use { r ->
                while (true) {
                    val line = r.readLine() ?: break
                    log("[$tag] $line")
                }
            }
        }
    }

    private fun healthOk(): Boolean {
        return try {
            val conn = URL("http://127.0.0.1:$port/health").openConnection() as HttpURLConnection
            conn.connectTimeout = 1000
            conn.readTimeout = 1000
            conn.requestMethod = "GET"
            val ok = conn.responseCode == 200
            conn.disconnect()
            ok
        } catch (_: Throwable) {
            false
        }
    }
}
