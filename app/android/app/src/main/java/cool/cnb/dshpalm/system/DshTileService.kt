package cool.cnb.dshpalm.system

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import cool.cnb.dshpalm.MainActivity
import cool.cnb.dshpalm.host.HostRuntime

/** M3.3：快捷设置磁贴。点击直接回到锦囊；长按/添加由系统 UI 负责。 */
class DshTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        val tile = qsTile ?: return
        val status = HostRuntime.status()
        val ready = status.engine == "ready" && status.bridge == "ready"
        tile.state = if (ready) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = "锦囊"
        if (Build.VERSION.SDK_INT >= 29) {
            tile.subtitle = when {
                status.engine == "failed" || status.bridge == "failed" -> "引擎出错"
                ready -> "已就绪"
                else -> status.phase.ifBlank { "轻引擎" }
            }
        }
        tile.updateTile()
    }

    override fun onClick() {
        super.onClick()
        val intent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("dshpalm://session?source=tile")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        if (Build.VERSION.SDK_INT >= 34) {
            val pending = android.app.PendingIntent.getActivity(
                this,
                4702,
                intent,
                android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
            )
            startActivityAndCollapse(pending)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}
