package cool.cnb.dshpalm.system

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import cool.cnb.dshpalm.MainActivity
import cool.cnb.dshpalm.R
import cool.cnb.dshpalm.host.HostRuntime

/**
 * M3.3：桌面小组件。
 *
 * 只显示宿主状态和一个入口，不把会话正文/文件写进 RemoteViews。
 * 状态更新由 HostService 的 statusListener 主动推；系统 30 分钟一次的
 * updatePeriodMillis 只是兜底。
 */
class DshWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val status = HostRuntime.status()
        val text = statusText(status)
        for (id in ids) manager.updateAppWidget(id, views(context, text))
    }

    companion object {
        fun refresh(context: Context, text: String? = null) {
            val manager = AppWidgetManager.getInstance(context) ?: return
            val ids = manager.getAppWidgetIds(ComponentName(context, DshWidgetProvider::class.java))
            if (ids.isEmpty()) return
            val label = text ?: statusText(HostRuntime.status())
            for (id in ids) manager.updateAppWidget(id, views(context, label))
        }

        private fun statusText(status: HostRuntime.Status): String = when {
            status.engine == "failed" || status.bridge == "failed" -> status.error ?: "引擎出错"
            status.engine == "ready" && status.bridge == "ready" -> "已就绪 · 点一下打开"
            status.phase.isNotBlank() -> status.phase
            else -> "轻引擎"
        }

        private fun views(context: Context, text: String): RemoteViews =
            RemoteViews(context.packageName, R.layout.dsh_widget).apply {
                setTextViewText(R.id.widget_title, "锦囊")
                setTextViewText(R.id.widget_status, text)
                setOnClickPendingIntent(R.id.widget_root, openApp(context))
            }

        private fun openApp(context: Context): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Uri.parse("dshpalm://session?source=widget")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            return PendingIntent.getActivity(
                context,
                4703,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }
    }
}
