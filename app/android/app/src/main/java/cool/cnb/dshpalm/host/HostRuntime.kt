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
        /** 当前这一步干什么（解压 / 启动引擎 / 就绪），给界面和通知用 */
        val phase: String = "",
        /** 0–100，配合 phase；-1 表示不确定进度 */
        val progress: Int = -1,
        /** 桥启动时吐出的 6 位配对码（常驻内存，不被 500 行环形日志挤掉） */
        val pairCode: String? = null,
    )

    private val TOKEN_RE = Regex("token=([A-Za-z0-9_\\\\-]+)")
    private val PAIR_RE = Regex("配对码\\s+(\\d{6})")
    private const val LOG_LIMIT = 500
    private const val READY_TIMEOUT_MS = 40_000L

    /** 引擎（dsh web）固定监听本机 8787，桥的 {url} 占位符替换成它 */
    private const val ENGINE_URL = "http://127.0.0.1:8787"

    /** 进程命令行里的标记：App 被强杀后靠它认出残留的同 uid 进程 */
    private const val BRIDGE_MARKER = "dsh-palm-bridge.cjs"
    private const val ENGINE_MARKER = "@deepseek-ai/dsh/lib/bin.js"

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
    /** 桥的监督线程；同一时刻只允许一个，token 变了靠杀进程让它换参数重起 */
    @Volatile private var bridgeLoop: Thread? = null
    /** 认领存活进程时的守护线程 */
    @Volatile private var adoptedWatcher: Thread? = null
    @Volatile private var stopping = false
    @Volatile private var engine = "stopped"
    @Volatile private var bridge = "stopped"
    @Volatile private var port = 8788
    @Volatile private var lastError: String? = null
    @Volatile private var since = 0L
    @Volatile private var token = ""
    @Volatile private var extraEnv: Map<String, String> = emptyMap()
    @Volatile private var phase = ""
    @Volatile private var progress = -1
    @Volatile private var pairCode: String? = null
    @Volatile private var lastPublished = ""
    /** 连续启动失败次数：到 3 次就标记"下次安全模式" */
    @Volatile private var consecutiveFailures = 0
    private var appContext: Context? = null

    @Synchronized
    fun status(): Status = Status(engine, bridge, port, lastError, since, phase, progress, pairCode)

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
        // 状态没变就别惊动监听者（设置页 500ms 轮询一次，日志和通知都会被刷屏）
        val key = listOf(s.engine, s.bridge, s.port, s.error, s.since, s.phase, s.progress, s.pairCode).joinToString("|")
        if (key == lastPublished) return
        lastPublished = key
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
     * 报告"启动到哪一步了"。
     *
     * 解压有 10 秒左右，界面上只有一个"启动中"就等于没有反馈；这里把百分比
     * 推进 Status，界面每 500ms 拉一次，通知也跟着改。
     */
    fun progress(label: String, pct: Int) {
        val next = pct.coerceIn(0, 100)
        // 只在百分比真的变了才广播：解压时每 2% 一次，够细也够省
        if (phase == label && progress == next) return
        phase = label
        progress = next
        publish()
    }

    /**
     * 打开落盘日志。每次服务启动都调一次：进程被回收后文件还在，下次接着追加。
     */
    fun attachLogFile(context: Context) {
        appContext = context.applicationContext
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
        if (engineProcess != null || adoptedWatcher?.isAlive == true) {
            log("[host] 已经在跑，忽略重复启动")
            publish()
            return
        }
        stopping = false
        lastError = null
        port = bridgePort
        extraEnv = env
        attachLogFile(context)

        val worker = Thread({
            // 在后台线程探测是否已有存活的健康引擎+桥（避免主线程 HttpURLConnection 抛 NetworkOnMainThreadException）
            if (hasMarkedProcess(ENGINE_MARKER) && hasMarkedProcess(BRIDGE_MARKER) && healthOk()) {
                if (pairCode.isNullOrBlank()) {
                    pairCode = recoverPairCodeFromLogFile(context)
                }
                if (since == 0L) since = System.currentTimeMillis()
                engine = "ready"
                bridge = "ready"
                phase = "就绪"
                progress = 100
                publish()
                log("[host] 认领已存活的本机引擎与桥（port=$port pair=${pairCode ?: "none"}），0 秒复用")
                while (!stopping) {
                    runCatching { Thread.sleep(1500) }
                    if (stopping) return@Thread
                    if (!hasMarkedProcess(ENGINE_MARKER) || !hasMarkedProcess(BRIDGE_MARKER) || !healthOk()) {
                        log("[host] 已认领的引擎或桥退出，转入完整拉起流程")
                        break
                    }
                }
                if (stopping) return@Thread
            }

            since = System.currentTimeMillis()
            engine = "starting"
            bridge = "stopped"
            phase = "准备运行时"
            progress = 0
            publish()

            reapOrphans()
            logStartup(engineCmd, bridgeCmd, env)
            runEngine(engineCmd, bridgeCmd, prepare)
        }, "dsh-engine")
        adoptedWatcher = worker
        worker.start()
    }

    @Synchronized
    fun stop() {
        stopping = true
        log("[host] 正在停止")
        adoptedWatcher?.interrupt()
        adoptedWatcher = null
        bridgeProcess?.let { killTree(it) }
        engineProcess?.let { killTree(it) }
        bridgeProcess = null
        engineProcess = null
        // 自己杀完之后再扫一遍：fork 链断了的残留也不会留到下个进程里抢端口
        reapOrphans()
        engine = "stopped"
        bridge = "stopped"
        phase = "已停止"
        progress = 0
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
                phase = "运行时安装失败"
                publish()
                return
            }
        }
        var attempt = 0
        while (!stopping) {
            attempt += 1
            progress("启动引擎（第 $attempt 次）", 96)
            // 上一轮的孤儿还占着 8787（App 被强杀过很容易出现），先清掉再起
            killMarked(ENGINE_MARKER)
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
                            consecutiveFailures = 0
                            progress("引擎就绪", 99)
                            startBridge(bridgeCmd)
                        } else if (System.currentTimeMillis() > deadline) {
                            break
                        }
                    }
                }

                if (!ready) {
                    engine = "failed"
                    lastError = "引擎没在 ${READY_TIMEOUT_MS / 1000} 秒内打印 token"
                    phase = "引擎启动失败"
                    publish()
                    reportEngineFailure()
                    killTree(p)
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
                killTree(p)
                killMarked(ENGINE_MARKER)
            }
        }, "dsh-engine-watchdog").start()
    }

    /** 连续失败 3 次 → 下次启动用安全模式（重置 profiles），别让用户卡死 */
    private fun reportEngineFailure() {
        consecutiveFailures += 1
        if (consecutiveFailures < 3) return
        val ctx = appContext ?: return
        ctx.getSharedPreferences("dsh-palm", Context.MODE_PRIVATE)
            .edit()
            .putBoolean("safeModeNext", true)
            .apply()
        log("[engine] 连续失败 3 次，下次启动会进安全模式（重置 profiles）")
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

    /**
     * 起桥。
     *
     * 引擎每次重启 token 都会变，所以桥不能"一次性"——这里杀掉旧进程，
     * 由一个常驻监督线程按当前 token 重起，和引擎的看门狗同一套退避。
     */
    private fun startBridge(bridgeCmd: String) {
        killBridge()
        if (bridgeLoop?.isAlive == true) return
        bridge = "starting"
        publish()
        val t = Thread({ bridgeSupervisor(bridgeCmd) }, "dsh-bridge-supervisor")
        bridgeLoop = t
        t.start()
    }

    private fun bridgeSupervisor(bridgeCmd: String) {
        var attempt = 0
        while (!stopping) {
            if (token.isEmpty()) {
                runCatching { Thread.sleep(500) }
                continue
            }
            attempt += 1
            // 桥的孤儿占着 8788 时新桥会 EADDRINUSE，先清掉
            killMarked(BRIDGE_MARKER)
            val cmd = bridgeCmd
                .replace("{url}", ENGINE_URL)
                .replace("{token}", token)
                .replace("{port}", port.toString())
            try {
                log("[bridge] 启动（第 $attempt 次）: " + maskToken(cmd))
                // 桥也是 proot 起的，少一个环境变量就 CANNOT LINK EXECUTABLE
                val p = ProcessBuilder("/system/bin/sh", "-c", cmd)
                    .redirectErrorStream(true)
                    .apply { environment().putAll(extraEnv) }
                    .start()
                bridgeProcess = p
                Thread({ drain("bridge", p) }, "dsh-bridge-log").start()

                if (!awaitHealthy(p)) {
                    bridge = "failed"
                    lastError = "桥没有在时限内就绪"
                    publish()
                    log("[bridge] 健康检查超时，结束它")
                    killBridge()
                    if (stopping) return
                    backoff(attempt)
                    continue
                }
                bridge = "ready"
                lastError = null
                progress("就绪", 100)
                publish()

                val code = p.waitFor()
                bridgeProcess = null
                if (stopping) return
                bridge = "failed"
                lastError = "桥退出（exit=$code）"
                phase = "桥已退出，正在重连"
                publish()
                log("[bridge] 退出 code=$code，退避后重启")
                attempt = 0
                backoff(1)
            } catch (t: Throwable) {
                bridgeProcess = null
                if (stopping) return
                bridge = "failed"
                lastError = t.message ?: "桥启动异常"
                phase = "桥启动异常"
                publish()
                log("[bridge] 异常: ${android.util.Log.getStackTraceString(t)}")
                backoff(attempt)
            }
        }
    }

    /**
     * 收掉桥进程，并**等它真的退出**。
     * 不等的话新桥会和旧桥抢 8788，直接 EADDRINUSE —— 表现出来就是"桥一直起不来"。
     */
    private fun killBridge() {
        val p = bridgeProcess
        bridgeProcess = null
        if (p != null) killTree(p)
        // wrapper 死了 node 还活着：按标记补一刀，否则新桥抢不到 8788
        killMarked(BRIDGE_MARKER)
    }

    /**
     * 收掉一个进程**和它的后代**。
     *
     * `destroy()` 只杀 `/system/bin/sh -c` 这一层，proot/node 是它的子进程，会变孤儿占着端口。
     * ProcessHandle 从 API 26 就有；更老的系统只能退化成 force kill 自己。
     */
    /**
     * 收掉一层进程（`/system/bin/sh -c` 包装）。
     *
     * 真正的 proot/node 是它的子进程，杀 wrapper 杀不到 —— 所以下面还要按命令行标记
     * 扫一遍（`killMarked`），否则孤儿会占着 8788。
     */
    private fun killTree(p: Process) {
        runCatching { p.destroy() }
        runCatching { p.waitFor(2, java.util.concurrent.TimeUnit.SECONDS) }
        runCatching { if (p.isAlive) p.destroyForcibly() }
    }

    /** 检查同 uid 是否存在带 marker 的存活进程 */
    private fun hasMarkedProcess(marker: String): Boolean {
        val myUid = android.os.Process.myUid()
        val myPid = android.os.Process.myPid()
        return runCatching {
            File("/proc").listFiles()?.any { dir ->
                val pid = dir.name.toIntOrNull() ?: return@any false
                if (pid == myPid) return@any false
                val cmdline = runCatching { File(dir, "cmdline").readText() }.getOrNull().orEmpty()
                if (!cmdline.contains(marker)) return@any false
                val owner = runCatching {
                    File(dir, "status").readLines()
                        .firstOrNull { it.startsWith("Uid:") }
                        ?.split(Regex("\\s+"))
                        ?.getOrNull(1)
                        ?.toIntOrNull()
                }.getOrNull()
                owner == myUid
            } == true
        }.getOrDefault(false)
    }

    /** 从落盘日志尾部找回最近一次桥输出的 6 位配对码 */
    private fun recoverPairCodeFromLogFile(context: Context): String? {
        return runCatching {
            val file = File(context.filesDir, LOG_FILE)
            if (!file.exists()) return null
            val len = file.length()
            val tailBytes = 64 * 1024L
            val text = java.io.RandomAccessFile(file, "r").use { raf ->
                if (len > tailBytes) raf.seek(len - tailBytes)
                val buf = ByteArray(minOf(len, tailBytes).toInt())
                raf.readFully(buf)
                String(buf, Charsets.UTF_8)
            }
            PAIR_RE.findAll(text).lastOrNull()?.groupValues?.getOrNull(1)
        }.getOrNull()
    }

    /** 杀掉同 uid、命令行里带 marker 的进程（proot/node 那一层） */
    private fun killMarked(marker: String) {
        val myUid = android.os.Process.myUid()
        val myPid = android.os.Process.myPid()
        runCatching {
            File("/proc").listFiles()?.forEach { dir ->
                val pid = dir.name.toIntOrNull() ?: return@forEach
                if (pid == myPid) return@forEach
                val cmdline = runCatching { File(dir, "cmdline").readText() }.getOrNull().orEmpty()
                if (!cmdline.contains(marker)) return@forEach
                val owner = runCatching {
                    File(dir, "status").readLines()
                        .firstOrNull { it.startsWith("Uid:") }
                        ?.split(Regex("\\s+"))
                        ?.getOrNull(1)
                        ?.toIntOrNull()
                }.getOrNull()
                if (owner != myUid) return@forEach
                runCatching {
                    android.os.Process.killProcess(pid)
                    log("[host] 清掉残留进程 pid=$pid（$marker）")
                }
            }
        }
    }

    /**
     * 清掉同 uid 的残留进程。
     *
     * App 被系统强杀（或 force-stop）时，前台服务里的 sh 没了，它 fork 出来的
     * proot/node 还活着 —— 下一次启动就会 EADDRINUSE，界面一直"桥启动失败"。
     * 同 uid 的进程我们可以直接 kill。
     */
    private fun reapOrphans() {
        killMarked(BRIDGE_MARKER)
        killMarked(ENGINE_MARKER)
    }

    /**
     * 等 /health 通。
     *
     * 必须同时盯着**自己的进程还活着**：端口上可能是上一次残留的孤儿桥，
     * 它是健康的，但和我们这次起的 token 对不上 —— 只看 /health 会误判 ready。
     */
    private fun awaitHealthy(p: Process): Boolean {
        val deadline = System.currentTimeMillis() + READY_TIMEOUT_MS
        while (!stopping && System.currentTimeMillis() < deadline) {
            if (!p.isAlive) return false
            if (healthOk()) return true
            runCatching { Thread.sleep(150) }
        }
        return false
    }

    private fun drain(tag: String, p: Process) {
        runCatching {
            BufferedReader(InputStreamReader(p.inputStream)).use { r ->
                while (true) {
                    val line = r.readLine() ?: break
                    log("[$tag] $line")
                    if (tag == "bridge") {
                        PAIR_RE.find(line)?.groupValues?.getOrNull(1)?.let { code ->
                            if (pairCode != code) {
                                pairCode = code
                                publish()
                            }
                        }
                    }
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
