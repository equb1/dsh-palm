package cool.cnb.dshpalm.host

import android.content.Intent

/**
 * 「分享到锦囊」的收件箱。
 *
 * Activity 的 `onCreate` / `onNewIntent` 只把 Intent 交进来（主线程），
 * JS 侧的 `intakeShare` 在后台线程取走并复制文件。
 * 用 `@Volatile` + 锁保证冷启动和后台分享两条路都能读到、且只消费一次。
 */
object ShareInbox {
    private val lock = Any()

    @Volatile
    private var pending: Intent? = null

    /** 只收分享类 Intent；`setIntent` 的普通启动 Intent 直接忽略 */
    fun offer(intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return
        synchronized(lock) { pending = intent }
    }

    /** 取走并清空；返回 null 表示没有待处理的分享 */
    fun take(): Intent? = synchronized(lock) {
        val intent = pending
        pending = null
        intent
    }

    fun clear() {
        synchronized(lock) { pending = null }
    }
}
