package cool.cnb.dshpalm.host

import android.content.Context
import android.net.ConnectivityManager
import java.io.File
import java.io.FilterInputStream
import java.io.InputStream

/**
 * 运行时镜像的安装与路径解析。
 *
 * 两块东西：
 * - **proot**：作为 native lib 打包（`lib/arm64-v8a/libproot.so`）。
 *   必须放这里——app 私有数据目录里的文件在 Android 10+ 不允许执行（SELinux），
 *   但 nativeLibraryDir 里的可以。
 * - **rootfs**：assets 里的 tar.gz，首次启动解压到 `filesDir/runtime/rootfs`。
 *   里面的二进制不需要可执行位：proot 自己读文件、用 ptrace 模拟 execve。
 */
object RuntimeInstaller {

    private const val ASSET = "rootfs.bin"

    /** node + dsh 的载荷，叠加在基础 rootfs 之上 */
    const val PAYLOAD_ASSET = "payload.bin"
    private const val MARKER = ".installed"
    // 改过 payload（补 dsh-web-frontend、塞桥）就换版本号，手机上的旧镜像会自动重装
    private const val VERSION = "ubuntu-24.04.5-node24.22.1-dsh0.2.1rc5+frontend+bridge"

    data class Paths(
        val proot: String,
        val loader: String,
        val rootfs: File,
        /** proot 依赖的 so 放这里，靠 LD_LIBRARY_PATH 找 */
        val libDir: File,
        /** 工作区：bind 到客体 /root/work，换镜像不丢 */
        val workspace: File,
        /** 桥的设备密钥：bind 到客体 /bridge，换镜像不丢 */
        val bridgeData: File,
        /** dsh 的 home（会话、凭据、工作区索引）：bind 到客体 /root/.dsh */
        val dshHome: File,
    )

    fun paths(context: Context): Paths {
        val libDir = context.applicationInfo.nativeLibraryDir
        val files = context.filesDir
        return Paths(
            proot = File(libDir, "libproot.so").absolutePath,
            loader = File(libDir, "libprootloader.so").absolutePath,
            rootfs = File(files, "runtime/rootfs"),
            libDir = File(files, "runtime/lib"),
            workspace = File(files, "workspace"),
            bridgeData = File(files, "bridge"),
            dshHome = File(files, "home/.dsh"),
        )
    }

    /** 已经装好了吗 */
    fun installed(context: Context): Boolean {
        val marker = File(context.filesDir, "runtime/$MARKER")
        if (!marker.exists()) return false
        return runCatching { marker.readText().trim() == VERSION }.getOrDefault(false)
    }

    /**
     * 解压 rootfs。返回是否成功。
     * 用系统自带的 tar（toybox）解 gz，比在 Kotlin 里写解压快也稳。
     */
    fun install(
        context: Context,
        log: (String) -> Unit,
        progress: (String, Int) -> Unit = { _, _ -> },
    ): Boolean {
        val paths = paths(context)
        val runtimeDir = File(context.filesDir, "runtime")
        if (installed(context)) return true

        if (paths.rootfs.exists()) paths.rootfs.deleteRecursively()
        runtimeDir.mkdirs()

        // 用自研解压器：系统 tar 遇到硬链接失败会中止，而且私有目录里根本建不了硬链接
        return try {
            log("[runtime] 解压镜像（首次启动）…")
            val started = System.currentTimeMillis()
            // 两层分开报进度：基础层 0–16%，载荷 16–95%（按体积近似）
            val count = extractAsset(context, ASSET, paths.rootfs, "解压运行时（1/2）", 0, 16, log, progress)
            log("[runtime] 基础层解压完成：$count 个条目，耗时 ${(System.currentTimeMillis() - started) / 1000}s")

            // 第二层：node + dsh（体积大，单独打包，叠加到同一个 rootfs）
            val payloadStarted = System.currentTimeMillis()
            val payloadCount = extractAsset(context, PAYLOAD_ASSET, paths.rootfs, "解压运行时（2/2）", 16, 95, log, progress)
            log("[runtime] 载荷解压完成：$payloadCount 个条目，耗时 ${(System.currentTimeMillis() - payloadStarted) / 1000}s")

            // Windows 上打的包权限是 0644，node 二进制在 proot 里会被判成"不可执行"。
            // 给 /opt 树补执行位（只对文件，不碰目录）。
            chmodTree(File(paths.rootfs, "opt"), log)
            val nodeBin = File(paths.rootfs, "opt/node/bin/node")
            log("[runtime] node 可执行: " + nodeBin.canExecute())

            if (!File(paths.rootfs, "bin/sh").exists()) {
                log("[runtime] 失败：解压后没有 /bin/sh")
                return false
            }
            listOf("dev", "proc", "sys", "tmp", "root", "home", "run", "bridge", "root/work").forEach { name ->
                File(paths.rootfs, name).mkdirs()
            }
            fixRuntimeLinks(paths.rootfs, log)
            installLibs(context, paths, log)
            ensureLayout(context, log)
            File(runtimeDir, MARKER).writeText(VERSION)
            // 到 95 就交棒：接下来是起引擎（96–99），别让进度条先到 100 再回退
            progress("运行时就绪", 95)
            log("[runtime] 镜像就绪: " + paths.rootfs.absolutePath)
            true
        } catch (t: Throwable) {
            log("[runtime] 解压异常: " + (t.message ?: t.toString()))
            false
        }
    }

    /**
     * 动态链接器的兜底修复。
     *
     * Ubuntu 24.04 里 /lib64/ld-linux-aarch64.so.1 -> /usr/lib/... 这类绝对符号链接，
     * 如果没解出来（或指向了宿主路径），所有 ELF 都会跑不起来，shell 只会报 "not found"。
     */
    private fun fixRuntimeLinks(rootfs: File, log: (String) -> Unit) {
        val loader = File(rootfs, "usr/lib/aarch64-linux-gnu/ld-linux-aarch64.so.1")
        if (!loader.exists()) {
            log("[runtime] 动态链接器缺失，ELF 都跑不起来")
            return
        }
        // 直接**复制**，不用符号链接：/lib 和 /lib64 本身可能是符号链接，
        // 链到链上很容易解析歪（我们就踩过）。复制最笨也最稳。
        for (target in listOf("lib64/ld-linux-aarch64.so.1", "lib/ld-linux-aarch64.so.1")) {
            val dest = File(rootfs, target)
            if (runCatching { dest.exists() }.getOrDefault(false)) {
                log("[runtime] 已存在: $target")
                continue
            }
            runCatching {
                dest.parentFile?.mkdirs()
                loader.copyTo(dest, overwrite = true)
                dest.setExecutable(true)
                log("[runtime] 复制链接器: $target")
            }.onFailure { log("[runtime] 复制失败 $target: ${it.message}") }
        }
        log("[runtime] 链接器就位: " + File(rootfs, "lib64/ld-linux-aarch64.so.1").exists())
    }
    /** 递归补可执行位（tar 里存的是 0644 时需要） */
    private fun chmodTree(dir: File, log: (String) -> Unit) {
        if (!dir.exists()) return
        var count = 0
        dir.walkTopDown().forEach { f ->
            if (f.isFile) {
                runCatching { f.setExecutable(true, false) }
                count += 1
            }
        }
        log("[runtime] chmod +x: $count 个文件")
    }

    /** proot 是动态链接的（libtalloc / libandroid-shmem），要把 so 一起放好 */
    private fun installLibs(context: Context, paths: Paths, log: (String) -> Unit) {
        paths.libDir.mkdirs()
        val libs = mapOf(
            "libtalloc.so.2.bin" to "libtalloc.so.2",
            "libandroid-shmem.so.bin" to "libandroid-shmem.so",
        )
        for ((asset, name) in libs) {
            val target = File(paths.libDir, name)
            if (target.exists() && target.length() > 0) continue
            context.assets.open(asset).use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            }
            log("[runtime] 库就位: " + name)
        }
    }
    /**
     * 可写数据放在 rootfs 之外的三个位置（换镜像不丢）：
     *   files/workspace  → 客体 /root/work           用户的工作区
     *   files/bridge     → 客体 /bridge              桥的设备密钥
     *   files/runtime    → 客体 /opt/node、/opt/dsh  运行时本身
     *
     * 同时把老版本留在 rootfs 里的工作区和设备密钥迁出来。
     * 每次启动都调：install() 有"已装好"的短路，而老 rootfs 里可能还没有 /root/work。
     */
    fun ensureLayout(context: Context, log: (String) -> Unit = {}): Boolean {
        val p = paths(context)
        return runCatching {
            p.workspace.mkdirs()
            p.bridgeData.mkdirs()
            p.dshHome.mkdirs()
            File(p.rootfs, "root/work").mkdirs()
            File(p.rootfs, "bridge").mkdirs()
            File(p.rootfs, "root/.dsh").mkdirs()
            ensureDns(context, log)
            migrateWorkspace(p, log)
            migrateDeviceKeys(p, log)
            migrateDshHome(p, log)
            true
        }.getOrElse {
            log("[runtime] 目录准备失败: ${it.message}")
            false
        }
    }

    /**
     * 给客体写 /etc/resolv.conf。
     *
     * 镜像里的这个文件是**空的**（0 字节）：Ubuntu 的 glibc 解析域名只认它，
     * 于是客体里的 node 连 `platform.deepseek.com` 都是 EAI_AGAIN ——
     * 表现就是「填了 Key 也发不出消息」「账号登录 no-response」。
     * 安卓的 DNS 在 ConnectivityManager 里，取当前网络的，取不到用公共 DNS 兜底。
     */
    fun ensureDns(context: Context, log: (String) -> Unit = {}): Boolean {
        val servers = LinkedHashSet<String>()
        runCatching {
            val cm = context.getSystemService(ConnectivityManager::class.java)
            val network = cm?.activeNetwork
            val props = if (cm != null && network != null) cm.getLinkProperties(network) else null
            props?.dnsServers?.forEach { addr ->
                val ip = addr.hostAddress
                if (!ip.isNullOrBlank()) servers.add(ip)
            }
        }.onFailure { log("[runtime] 读系统 DNS 失败: " + it.message) }
        if (servers.isEmpty()) {
            servers.add("223.5.5.5")
            servers.add("119.29.29.29")
        }
        val text = servers.joinToString("\n") { "nameserver $it" } + "\n"
        val target = File(paths(context).rootfs, "etc/resolv.conf")
        return runCatching {
            target.parentFile?.mkdirs()
            // 可能是悬空软链（-> /run/systemd/...）：exists() 是 false，但 unlink 仍能删掉链接本身
            runCatching { target.delete() }
            target.writeText(text)
            log("[runtime] DNS: " + servers.joinToString(", "))
            true
        }.getOrElse {
            log("[runtime] 写 resolv.conf 失败: " + it.message)
            false
        }
    }

    /** 老版本默认工作区在 /root/Documents/deepseek-harness（rootfs 里） */
    private fun migrateWorkspace(p: Paths, log: (String) -> Unit) {
        val legacy = File(p.rootfs, "root/Documents/deepseek-harness")
        val target = File(p.workspace, "deepseek-harness")
        if (!legacy.isDirectory || target.exists()) return
        target.parentFile?.mkdirs()
        val moved = runCatching { legacy.renameTo(target) }.getOrDefault(false)
        if (!moved) {
            runCatching { legacy.copyRecursively(target, overwrite = false) }
                .onFailure {
                    log("[runtime] 迁移工作区失败: ${it.message}")
                    return
                }
        }
        // 老会话里记的 cwd 还是 /root/Documents/…：留个软链，它们还能打开
        runCatching {
            if (legacy.exists()) legacy.deleteRecursively()
            legacy.parentFile?.mkdirs()
            // android.system.Os 从 API 21 就有，比 java.nio.file（API 26）安全
            android.system.Os.symlink("../work/deepseek-harness", legacy.absolutePath)
        }.onFailure { log("[runtime] 工作区软链失败: ${it.message}") }
        log("[runtime] 默认工作区已迁出 rootfs → " + target.absolutePath)
    }

    /** 老的设备密钥在 rootfs 的 /root/.dsh-palm-devices.json */
    private fun migrateDeviceKeys(p: Paths, log: (String) -> Unit) {
        val legacy = File(p.rootfs, "root/.dsh-palm-devices.json")
        val target = File(p.bridgeData, "devices.json")
        if (!legacy.isFile || target.exists()) return
        runCatching { legacy.copyTo(target, overwrite = true) }
            .onSuccess { log("[runtime] 设备密钥已迁出 rootfs → " + target.absolutePath) }
            .onFailure { log("[runtime] 迁移设备密钥失败: ${it.message}") }
    }

    /**
     * 把老 rootfs 里的 `~/.dsh` 搬到 bind 目录。
     *
     * 会话、`.credentials.yaml`、工作区索引都在这里；不搬的话换一次镜像全丢。
     * 只搬宿主目录为空的场景，避免把新数据覆盖回旧的。
     */
    private fun migrateDshHome(p: Paths, log: (String) -> Unit) {
        val legacy = File(p.rootfs, "root/.dsh")
        if (!legacy.isDirectory) return
        val target = p.dshHome
        target.mkdirs()
        val hasTarget = (target.list()?.isNotEmpty() == true)
        if (hasTarget) return
        var moved = 0
        legacy.listFiles()?.forEach { item ->
            val dest = File(target, item.name)
            if (dest.exists()) return@forEach
            val ok = runCatching { item.renameTo(dest) }.getOrDefault(false)
            if (!ok) runCatching { item.copyRecursively(dest, overwrite = false) }.getOrDefault(false)
            if (dest.exists()) moved += 1
        }
        if (moved > 0) log("[runtime] 会话与凭据已迁出 rootfs → ${target.absolutePath}（$moved 项）")
    }

    /**
     * 解压一个 assets 里的 tar.gz，按字节数报进度。
     *
     * 资产在 APK 里是压缩的，拿不到 openFd 的长度；但 AssetManager 的流在开头
     * 用 available() 给的是**解压后**的总长度，正好可以当分母。
     */
    private fun extractAsset(
        context: Context,
        asset: String,
        dest: File,
        label: String,
        fromPct: Int,
        toPct: Int,
        log: (String) -> Unit,
        progress: (String, Int) -> Unit,
    ): Int {
        context.assets.open(asset).use { input ->
            val total = runCatching { input.available().toLong() }.getOrDefault(0L)
            log("[runtime] $asset 约 ${total / (1024 * 1024)}MB")
            progress(label, fromPct)
            var last = fromPct
            val counting = CountingStream(input) { read ->
                if (total <= 0L) return@CountingStream
                val pct = fromPct + ((read * (toPct - fromPct)) / total).toInt()
                if (pct >= last + 2) {
                    last = pct.coerceAtMost(toPct)
                    progress(label, last)
                }
            }
            return TarExtractor.extract(counting, dest, log)
        }
    }

    /** 只数读了多少字节，不改变数据 */
    private class CountingStream(
        inner: InputStream,
        private val onRead: (Long) -> Unit,
    ) : FilterInputStream(inner) {
        private var count = 0L

        override fun read(): Int {
            val b = super.read()
            if (b >= 0) {
                count += 1
                onRead(count)
            }
            return b
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            val n = super.read(b, off, len)
            if (n > 0) {
                count += n.toLong()
                onRead(count)
            }
            return n
        }
    }

    /** proot 的通用参数前缀 */
    private fun prootPrefix(context: Context): String {
        val p = paths(context)
        p.workspace.mkdirs()
        p.bridgeData.mkdirs()
        p.dshHome.mkdirs()
        return listOf(
            p.proot,
            "-0",
            "-r", p.rootfs.absolutePath,
            "-b", "/dev",
            "-b", "/proc",
            "-b", "/sys",
            // 工作区和设备密钥住在 rootfs 外面：换镜像不会把它们冲掉
            "-b", p.workspace.absolutePath + ":/root/work",
            "-b", p.bridgeData.absolutePath + ":/bridge",
            // dsh 的会话/授权/工作区索引：换镜像不丢
            "-b", p.dshHome.absolutePath + ":/root/.dsh",
            "-w", "/root",
        ).joinToString(" ")
    }

    /** 正式命令：rootfs 里的 node 跑 dsh web */
    fun engineCmd(context: Context): String =
        prootPrefix(context) +
            " /opt/node/bin/node --require /opt/dsh/patch/fs-link-fallback.cjs" +
            " /opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js web" +
            " --patch /opt/dsh/patch/phone.yml" +
            " --host 127.0.0.1 --port 8787 --no-open"

    /** 桥（同一个 node 跑单文件桥） */
    fun bridgeCmd(context: Context): String =
        prootPrefix(context) + " /opt/node/bin/node /opt/dsh/bridge/dsh-palm-bridge.cjs {url} {token} {port}"

    /**
     * 每次启动补一次执行位。
     * Windows 上打的 tar 里权限是 0644，proot 会拒绝 exec；
     * 而 install() 有"已装好"的短路，所以不能只放在安装流程里。
     */
    fun ensureExecutable(context: Context): Boolean {
        val node = File(paths(context).rootfs, "opt/node/bin/node")
        if (!node.exists()) return false
        if (node.canExecute()) return true
        runCatching { node.setExecutable(true, false) }
        // 顺手把 lib 目录里带 +x 需求的（node 的辅助二进制）也补上
        runCatching {
            File(paths(context).rootfs, "opt/node").walkTopDown().forEach { f ->
                if (f.isFile) f.setExecutable(true, false)
            }
        }
        return node.canExecute()
    }

    /**
     * 装 rootfs 里缺、但 dsh 会去调的小命令（目前只有 xdg-user-dir）。
     *
     * dsh 建默认工作区时执行 `xdg-user-dir DOCUMENTS`；Ubuntu base 镜像里没这个包，
     * 不补的话第一条消息就报 `workspace/initializeDefault -> spawn xdg-user-dir ENOENT`。
     */
    fun ensureShims(context: Context, log: (String) -> Unit = {}): Boolean {
        val bin = File(paths(context).rootfs, "usr/local/bin")
        return runCatching {
            bin.mkdirs()
            val target = File(bin, "xdg-user-dir")
            val bytes = context.assets.open("patch/xdg-user-dir.sh").use { it.readBytes() }
            val same = target.exists() && target.readBytes().contentEquals(bytes)
            if (!same) {
                target.writeBytes(bytes)
                log("[runtime] shim 就位: xdg-user-dir（${bytes.size} 字节）")
            }
            if (!target.canExecute()) target.setExecutable(true, false)
            target.canExecute()
        }.getOrElse {
            log("[runtime] shim 写入失败: ${it.message}")
            false
        }
    }

    /** 镜像里有没有 node（决定用正式命令还是冒烟命令） */
    fun hasNode(context: Context): Boolean = File(paths(context).rootfs, "opt/node/bin/node").exists()

    /**
     * 把 Android 兼容补丁写进 rootfs。
     *
     * 补丁很小（<2KB），放 assets，每次启动顺手同步一份，这样改它不用重打 150MB 的 payload。
     * 用途见 assets/patch/fs-link-fallback.cjs：Android 不让 app 私有目录建硬链接，
     * 而 dsh 的会话落盘靠 link()。
     */
    fun ensurePatch(context: Context, log: (String) -> Unit = {}): Boolean {
        val rootfs = paths(context).rootfs
        val ok = writeAssetPatch(context, rootfs, "patch/fs-link-fallback.cjs", "opt/dsh/patch/fs-link-fallback.cjs", log)
        val profile = writeAssetPatch(context, rootfs, "patch/phone.yml", "opt/dsh/patch/phone.yml", log)
        // 桥也走 APK 补丁：改完脚本重打 APK 就行，不必再重打 150MB 的 payload
        val bridge = writeAssetPatch(
            context,
            rootfs,
            "patch/dsh-palm-bridge.cjs",
            "opt/dsh/bridge/dsh-palm-bridge.cjs",
            log,
        )
        return ok && profile && bridge
    }

    /** 把 assets 里的补丁同步进 rootfs；内容一样就跳过，脚本类顺手补 +x */
    private fun writeAssetPatch(
        context: Context,
        rootfs: File,
        asset: String,
        rel: String,
        log: (String) -> Unit,
    ): Boolean {
        val target = File(rootfs, rel)
        return runCatching {
            val bytes = context.assets.open(asset).use { it.readBytes() }
            val same = target.exists() && target.length() == bytes.size.toLong() &&
                target.readBytes().contentEquals(bytes)
            if (!same) {
                target.parentFile?.mkdirs()
                target.writeBytes(bytes)
                log("[runtime] 补丁就位: $rel（${bytes.size} 字节）")
            }
            if (!target.canExecute()) target.setExecutable(true, false)
            true
        }.getOrElse {
            log("[runtime] 补丁写入失败 $rel: ${it.message}")
            false
        }
    }

    /** 默认的引擎命令（rootfs 里的 dsh） */
    fun defaultEngineCmd(context: Context): String {
        val p = paths(context)
        return listOf(
            p.proot,
            "-0",
            "-r", p.rootfs.absolutePath,
            "-b", "/dev",
            "-b", "/proc",
            "-b", "/sys",
            "-w", "/root",
            "/bin/sh", "-c",
            "'dsh web --host 127.0.0.1 --port 8787 --no-open'",
        ).joinToString(" ")
    }

    /** 冒烟测试用：不进 dsh，只证明 proot + rootfs 能跑 */
    fun smokeEngineCmd(context: Context): String {
        val p = paths(context)
        return listOf(
            p.proot,
            "-0",
            "-r", p.rootfs.absolutePath,
            "-b", "/dev",
            "-b", "/proc",
            "-w", "/root",
            "/bin/sh", "-c",
            "'echo dsh web: http://127.0.0.1:8787/?token=PROOTOK; echo IN_ROOTFS; cat /etc/os-release 2>&1 | head -2; echo STEP3; exec sleep 600'",
        ).joinToString(" ")
    }
}
