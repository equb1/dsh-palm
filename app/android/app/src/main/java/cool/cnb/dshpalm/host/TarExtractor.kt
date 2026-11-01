package cool.cnb.dshpalm.host

import java.io.File
import java.io.InputStream
import java.util.zip.GZIPInputStream

/**
 * 极简 tar 解压器（只处理我们自己的镜像）。
 *
 * 为什么不用系统的 tar：
 * Android 的 toybox tar 遇到 `link()` 失败（app 私有目录里 SELinux 拒硬链接）会**中止**，
 * 结果 rootfs 只解了一半——`/bin/sh` 有了，`/usr/bin/sleep` 没有。
 * 自己解就能把硬链接退化成"复制"，不受限制。
 *
 * 支持的类型：普通文件、目录、符号链接、硬链接（复制）、GNU 长文件名。
 */
object TarExtractor {

    private const val BLOCK = 512

    fun extract(gz: InputStream, dest: File, log: (String) -> Unit): Int {
        dest.mkdirs()
        var count = 0
        var longName: String? = null
        val input = if (gz is GZIPInputStream) gz else GZIPInputStream(gz, 64 * 1024)

        input.use { stream ->
            val header = ByteArray(BLOCK)
            while (true) {
                if (!readFully(stream, header)) break
                if (header.all { it.toInt() == 0 }) break // 结尾的空块

                var name = readString(header, 0, 100)
                val size = readOctal(header, 124, 12)
                val mode = readOctal(header, 100, 8)
                val type = header[156].toInt().toChar()
                val linkName = readString(header, 157, 100)
                val prefix = readString(header, 345, 155)

                if (type == 'L') { // GNU 长文件名
                    val buf = ByteArray(size.toInt())
                    readFully(stream, buf)
                    longName = String(buf, Charsets.UTF_8).trimEnd('\u0000')
                    skipPadding(stream, size)
                    continue
                }
                if (prefix.isNotEmpty()) name = "$prefix/$name"
                if (longName != null) {
                    name = longName
                    longName = null
                }

                val target = File(dest, name)
                // 防目录穿越
                if (!target.canonicalPath.startsWith(dest.canonicalPath)) {
                    if (size > 0L) skip(stream, size)
                    skipPadding(stream, size)
                    continue
                }

                when (type) {
                    '5' -> {
                        target.mkdirs()
                        skipPadding(stream, size)
                    }
                    '2' -> {
                        target.parentFile?.mkdirs()
                        runCatching { target.delete() }
                        runCatching { java.nio.file.Files.createSymbolicLink(target.toPath(), File(linkName).toPath()) }
                        skipPadding(stream, size)
                    }
                    '1' -> {
                        // 硬链接：直接复制目标文件的内容，绕开 link() 限制
                        target.parentFile?.mkdirs()
                        val source = File(dest, linkName)
                        if (source.exists()) {
                            runCatching { source.copyTo(target, overwrite = true) }
                        }
                        skipPadding(stream, size)
                    }
                    else -> {
                        target.parentFile?.mkdirs()
                        target.outputStream().use { out ->
                            copyN(stream, out, size)
                        }
                        // 可执行位（proot 不强制，但 shell 脚本需要）
                        if (mode and 0b001000000L != 0L) runCatching { target.setExecutable(true) }
                        skipPadding(stream, size)
                    }
                }
                count += 1
                if (count % 2000 == 0) log("[runtime] 已解压 $count 个文件")
            }
        }
        return count
    }

    private fun readFully(stream: InputStream, buf: ByteArray): Boolean {
        var read = 0
        while (read < buf.size) {
            val n = stream.read(buf, read, buf.size - read)
            if (n <= 0) return read > 0
            read += n
        }
        return true
    }

    private fun readString(header: ByteArray, offset: Int, length: Int): String {
        val end = (offset until minOf(offset + length, header.size)).firstOrNull { header[it].toInt() == 0 } ?: minOf(offset + length, header.size)
        return String(header, offset, end - offset, Charsets.UTF_8).trim()
    }

    private fun readOctal(header: ByteArray, offset: Int, length: Int): Long {
        // 有些 tar 用 base-256 存大数
        if (header[offset].toInt() and 0x80 != 0) {
            var v = 0L
            for (i in offset + 1 until offset + length) v = (v shl 8) or (header[i].toLong() and 0xFF)
            return v
        }
        val text = String(header, offset, length, Charsets.US_ASCII).trim().trimEnd('\u0000')
        return text.toLongOrNull(8) ?: 0L
    }

    private fun copyN(stream: InputStream, out: java.io.OutputStream, size: Long) {
        val buf = ByteArray(64 * 1024)
        var left = size
        while (left > 0) {
            val n = stream.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
            if (n <= 0) break
            out.write(buf, 0, n)
            left -= n
        }
    }

    private fun skip(stream: InputStream, size: Long) {
        var left = size
        val buf = ByteArray(8 * 1024)
        while (left > 0) {
            val n = stream.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
            if (n <= 0) break
            left -= n
        }
    }

    /** tar 的每个条目按 512 对齐 */
    private fun skipPadding(stream: InputStream, size: Long) {
        val pad = ((BLOCK - (size % BLOCK)) % BLOCK)
        if (pad > 0) skip(stream, pad)
    }
}
