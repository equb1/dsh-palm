package cool.cnb.dshpalm

/** 进程内前台状态：由 ActivityLifecycleCallbacks 维护，悬浮窗据此显隐。 */
object AppVisibility {
    @Volatile
    var foreground: Boolean = false

    private var resumed = 0

    @Synchronized
    fun onActivityResumed() {
        resumed += 1
        foreground = true
    }

    @Synchronized
    fun onActivityPaused() {
        resumed = (resumed - 1).coerceAtLeast(0)
        foreground = resumed > 0
    }
}
