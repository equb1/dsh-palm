package cool.cnb.dshpalm.host

import android.content.Context
import java.io.File

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
    private const val ASSET_PAYLOAD = "payload.bin"
    private const val MARKER = ".installed"
    // 改过 payload（补 dsh-web-frontend、塞桥）就换版本号，手机上的旧镜像会自动重装
    private const val VERSION = "ubuntu-24.04.5-node24.22.1-dsh0.2.1rc5+frontend+bridge"

    data class Paths(
        val proot: String,
        val loader: String,
        val rootfs: File,
        /** proot 依赖的 so 放这里，靠 LD_LIBRARY_PATH 找 */
        val libDir: File,
    )

    fun paths(context: Context): Paths {
        val libDir = context.applicationInfo.nativeLibraryDir
        return Paths(
            proot = File(libDir, "libproot.so").absolutePath,
            loader = File(libDir, "libprootloader.so").absolutePath,
            rootfs = File(context.filesDir, "runtime/rootfs"),
            libDir = File(context.filesDir, "runtime/lib"),
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
    fun install(context: Context, log: (String) -> Unit): Boolean {
        val paths = paths(context)
        val runtimeDir = File(context.filesDir, "runtime")
        if (installed(context)) return true

        if (paths.rootfs.exists()) paths.rootfs.deleteRecursively()
        runtimeDir.mkdirs()

        // 用自研解压器：系统 tar 遇到硬链接失败会中止，而且私有目录里根本建不了硬链接
        return try {
            log("[runtime] 解压镜像（首次启动）…")
            val started = System.currentTimeMillis()
            val count = context.assets.open(ASSET).use { input ->
                TarExtractor.extract(input, paths.rootfs, log)
            }
            log("[runtime] 基础层解压完成：$count 个条目，耗时 ${(System.currentTimeMillis() - started) / 1000}s")

            // 第二层：node + dsh（体积大，单独打包，叠加到同一个 rootfs）
            val payloadStarted = System.currentTimeMillis()
            val payloadCount = context.assets.open(ASSET_PAYLOAD).use { input ->
                TarExtractor.extract(input, paths.rootfs, log)
            }
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
            listOf("dev", "proc", "sys", "tmp", "root", "home", "run").forEach { name ->
                File(paths.rootfs, name).mkdirs()
            }
            fixRuntimeLinks(paths.rootfs, log)
            installLibs(context, paths, log)
            File(runtimeDir, MARKER).writeText(VERSION)
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
    /** proot 的通用参数前缀 */
    private fun prootPrefix(context: Context): String {
        val p = paths(context)
        return listOf(
            p.proot,
            "-0",
            "-r", p.rootfs.absolutePath,
            "-b", "/dev",
            "-b", "/proc",
            "-b", "/sys",
            "-w", "/root",
        ).joinToString(" ")
    }

    /** 正式命令：rootfs 里的 node 跑 dsh web */
    fun engineCmd(context: Context): String =
        prootPrefix(context) +
            " /opt/node/bin/node --require /opt/dsh/patch/fs-link-fallback.cjs" +
            " /opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js web" +
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
        val target = File(paths(context).rootfs, "opt/dsh/patch/fs-link-fallback.cjs")
        return runCatching {
            val bytes = context.assets.open("patch/fs-link-fallback.cjs").use { it.readBytes() }
            val same = target.exists() && target.length() == bytes.size.toLong() &&
                target.readBytes().contentEquals(bytes)
            if (same) return@runCatching true
            target.parentFile?.mkdirs()
            target.writeBytes(bytes)
            log("[runtime] 兼容补丁就位: ${target.absolutePath}（${bytes.size} 字节）")
            true
        }.getOrElse {
            log("[runtime] 兼容补丁写入失败: ${it.message}")
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
