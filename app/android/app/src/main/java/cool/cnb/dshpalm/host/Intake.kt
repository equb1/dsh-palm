package cool.cnb.dshpalm.host

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/**
 * 附件收件：把系统分享 / 相册 / 文件选择器给的内容复制进
 * `<filesDir>/workspace/uploads/<hash16>-<sanitized name>`，只回路径引用。
 *
 * 约束（见 docs/TECHNICAL.md 6.4）：
 *  - 绝不把整个文件读进内存，也不产生 base64；
 *  - 边拷边算 SHA-256，先写 `uploads/*.part` 再改名，避免留下半个文件；
 *  - 同一个文件重复收件（hash + 大小相同）直接复用已有文件。
 */
data class FileRef(
    /** 手机上的绝对路径（调试/分享用，不由模型消费） */
    val path: String,
    /** 引擎里的相对路径：`uploads/<hash16>-<name>`，轻/完整引擎按各自根目录拼 */
    val relPath: String,
    /** 落盘用的文件名（已 sanitize，不含 hash 前缀） */
    val name: String,
    /** 用户看到的原始文件名 */
    val displayName: String,
    val mime: String,
    val bytes: Long,
    /** 完整 SHA-256（hex），JS 侧用前缀做去重/文件名 */
    val hash: String,
)

/** 收件结果：成功给 ref，失败给中文原因（单文件失败不打断整批） */
data class IntakeResult(val ref: FileRef? = null, val error: String? = null) {
    companion object {
        fun fail(reason: String): IntakeResult = IntakeResult(error = reason)
    }
}

object Intake {

    const val MAX_BYTES = 200L * 1024 * 1024
    private const val BUFFER_BYTES = 64 * 1024
    private const val NAME_STEM_MAX = 80
    private const val NAME_EXT_MAX = 16

    /** 收件目录；不存在就建出来（install 后 workspace 可能还没初始化） */
    fun uploadsDir(ctx: Context): File = File(File(ctx.filesDir, "workspace"), "uploads").apply { mkdirs() }

    /**
     * 文件名 sanitize：
     * 只保留中日韩/字母/数字/`._-` 和空格，其余（含 `#%/\:*?"<>|` 与控制字符）换成 `_`；
     * 合并连续空格，去掉首尾的点和空格；主名 ≤80 字符、扩展名 ≤16；
     * 主名空时回退 `file-<ts>`。
     */
    fun sanitizeName(raw: String?, mime: String? = null): String {
        // 先砍掉任何目录成分，路径穿越在这一步就没了
        val leaf = raw.orEmpty().trim().substringAfterLast('/').substringAfterLast('\\')
        val cleaned = StringBuilder(leaf.length)
        for (ch in leaf) {
            val keep = ch == '.' || ch == '_' || ch == '-' || ch == ' ' || ch.isLetterOrDigit()
            cleaned.append(if (keep) ch else '_')
        }
        var base = cleaned.toString().replace(Regex(" +"), " ")
        base = trimDotsAndSpaces(base)

        var stem = base
        var ext = ""
        val dot = base.lastIndexOf('.')
        if (dot > 0 && dot < base.length - 1) {
            val candidate = base.substring(dot + 1)
            if (candidate.length <= NAME_EXT_MAX) {
                stem = base.substring(0, dot)
                ext = candidate
            }
        }
        if (ext.isEmpty()) ext = extensionForMime(mime)
        if (stem.isBlank()) stem = "file-${System.currentTimeMillis()}"
        stem = trimDotsAndSpaces(stem.take(NAME_STEM_MAX))
        if (stem.isBlank()) stem = "file-${System.currentTimeMillis()}"
        val suffix = if (ext.isNotBlank()) "." + ext.take(NAME_EXT_MAX) else ""
        return stem + suffix
    }

    /** content:// / file:// 收件：流式拷贝 + 计算 hash（不整文件读进内存） */
    fun intake(ctx: Context, uri: Uri, name: String? = null, mimeHint: String? = null): IntakeResult {
        val resolver = ctx.contentResolver
        var displayName = name?.trim()?.takeIf { it.isNotEmpty() }
        var declaredSize = -1L
        var mime = mimeHint?.trim()?.takeIf { it.isNotEmpty() }
        try {
            if (mime == null) mime = resolver.getType(uri)
            resolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                null,
                null,
                null,
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (displayName == null && nameIndex >= 0 && !cursor.isNull(nameIndex)) {
                        displayName = cursor.getString(nameIndex)
                    }
                    val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) declaredSize = cursor.getLong(sizeIndex)
                }
            }
        } catch (_: SecurityException) {
            return IntakeResult.fail("没有读取这个文件的权限；请重新分享或重新选择")
        } catch (_: Throwable) {
            // 查不到名字/大小不致命，继续读流
        }

        val mimeValue = mime?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
        val shownName = displayName?.takeIf { it.isNotBlank() } ?: fallbackName(mimeValue)
        if (declaredSize > MAX_BYTES) return IntakeResult.fail(tooLarge(shownName))

        val stream = try {
            resolver.openInputStream(uri)
        } catch (_: SecurityException) {
            return IntakeResult.fail("没有读取这个文件的权限；请重新分享或重新选择")
        } catch (t: Throwable) {
            return IntakeResult.fail("打不开「$shownName」：${t.message ?: "未知错误"}")
        } ?: return IntakeResult.fail("打不开「$shownName」")

        return stream.use { copyToUploads(ctx, it, shownName, mimeValue) }
    }

    /** 本机文件（相册缓存、file://）收件 */
    fun intakePath(ctx: Context, source: File, name: String? = null, mimeHint: String? = null): IntakeResult {
        if (!source.isFile) return IntakeResult.fail("文件不存在：${source.name}")
        val displayName = name?.trim()?.takeIf { it.isNotEmpty() } ?: source.name
        val mime = mimeHint?.takeIf { it.isNotBlank() } ?: mimeForName(source.name)
        if (source.length() > MAX_BYTES) return IntakeResult.fail(tooLarge(displayName))
        val stream = try {
            source.inputStream()
        } catch (t: Throwable) {
            return IntakeResult.fail("打不开「$displayName」：${t.message ?: "未知错误"}")
        }
        return stream.use { copyToUploads(ctx, it, displayName, mime) }
    }

    /**
     * 流式拷贝到 uploads。`.part` 先留在 uploads 里（同一个文件系统才能原子改名），
     * 拷完按 sha256 前缀 + sanitize 后的文件名落盘。
     */
    private fun copyToUploads(ctx: Context, input: InputStream, displayName: String, mime: String): IntakeResult {
        val dir = uploadsDir(ctx)
        val staging = File(dir, ".${System.currentTimeMillis()}-${System.nanoTime().toString(16)}.part")
        val digest = MessageDigest.getInstance("SHA-256")
        var total = 0L
        try {
            staging.outputStream().buffered(BUFFER_BYTES).use { output ->
                val buffer = ByteArray(BUFFER_BYTES)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    if (read == 0) continue
                    total += read
                    if (total > MAX_BYTES) throw TooLargeException()
                    digest.update(buffer, 0, read)
                    output.write(buffer, 0, read)
                }
                output.flush()
            }
        } catch (_: TooLargeException) {
            staging.delete()
            return IntakeResult.fail(tooLarge(displayName))
        } catch (t: Throwable) {
            staging.delete()
            return IntakeResult.fail("复制「$displayName」失败：${t.message ?: "未知错误"}")
        }
        if (total <= 0L) {
            staging.delete()
            return IntakeResult.fail("文件「$displayName」是空的")
        }

        val hash = digest.digest().joinToString("") { byte -> "%02x".format(byte) }
        val safeName = sanitizeName(displayName, mime)
        val prefix = hash.take(16)

        var target = File(dir, "$prefix-$safeName")
        if (target.isFile && target.length() == total) {
            // 同一个文件再分享一次：复用已有落盘结果，不重复占空间
            staging.delete()
            return IntakeResult(ref = toRef(target, safeName, displayName, mime, total, hash))
        }
        var suffix = 2
        while (target.exists() && suffix <= 99) {
            target = File(dir, "$prefix-$suffix-$safeName")
            suffix += 1
        }
        if (!staging.renameTo(target)) {
            staging.delete()
            return IntakeResult.fail("保存「$displayName」失败（改名失败）")
        }
        return IntakeResult(ref = toRef(target, safeName, displayName, mime, total, hash))
    }

    private fun toRef(target: File, name: String, displayName: String, mime: String, bytes: Long, hash: String): FileRef =
        FileRef(
            path = target.absolutePath,
            relPath = "uploads/${target.name}",
            name = name,
            displayName = displayName,
            mime = mime,
            bytes = bytes,
            hash = hash,
        )

    private fun tooLarge(name: String): String = "文件「$name」超过 200MB 上限"

    private fun fallbackName(mime: String): String {
        val ext = extensionForMime(mime)
        return if (ext.isBlank()) "file-${System.currentTimeMillis()}" else "file-${System.currentTimeMillis()}.$ext"
    }

    private fun extensionForMime(mime: String?): String {
        if (mime.isNullOrBlank()) return ""
        return MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?.takeIf { it.isNotBlank() } ?: ""
    }

    private fun mimeForName(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase()
        if (ext.isEmpty()) return "application/octet-stream"
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }

    private fun trimDotsAndSpaces(value: String): String = value.trim(' ', '.')

    private class TooLargeException : Exception()
}
