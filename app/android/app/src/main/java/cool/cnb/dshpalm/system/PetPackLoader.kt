package cool.cnb.dshpalm.system

import android.content.res.AssetManager
import org.json.JSONObject

/** 与 app/assets/pets/<role>/pack.json 对齐的精简原生规范。 */
data class PetAnimationSpec(
    val sheet: String,
    val frameW: Int,
    val frameH: Int,
    val cols: Int,
    val frames: List<Pair<Int, Int>>, // cell to durationMs
    val loop: Boolean,
)

data class PetPackSpec(
    val id: String,
    val states: Map<String, String>,
    val animations: Map<String, PetAnimationSpec>,
    val reactions: Map<String, String>,
)

/**
 * 原生悬浮窗只读数据包，不跑 JS。
 * 内置包放在 android/app/src/main/assets/pets/<id>/，外部包后续再走文件路径。
 */
object PetPackLoader {
    private val cache = mutableMapOf<String, PetPackSpec?>()

    fun load(assets: AssetManager, role: String): PetPackSpec? {
        cache[role]?.let { return it }
        val pack = try {
            val text = assets.open("pets/$role/pack.json").bufferedReader().use { it.readText() }
            val root = JSONObject(text)

            val states = mutableMapOf<String, String>()
            root.optJSONObject("states")?.let { obj ->
                for (key in obj.keys()) states[key] = obj.optString(key)
            }

            val animations = mutableMapOf<String, PetAnimationSpec>()
            root.optJSONObject("animations")?.let { anims ->
                for (name in anims.keys()) {
                    val a = anims.optJSONObject(name) ?: continue
                    val frames = mutableListOf<Pair<Int, Int>>()
                    val arr = a.optJSONArray("frames")
                    if (arr != null) {
                        for (i in 0 until arr.length()) {
                            val f = arr.optJSONObject(i) ?: continue
                            frames += (f.optInt("i") to f.optInt("ms"))
                        }
                    }
                    if (frames.isEmpty()) continue
                    animations[name] = PetAnimationSpec(
                        sheet = a.optString("sheet"),
                        frameW = a.optInt("frameW", 128),
                        frameH = a.optInt("frameH", 128),
                        cols = a.optInt("cols", 1).coerceAtLeast(1),
                        frames = frames,
                        loop = a.optBoolean("loop", true),
                    )
                }
            }

            val reactions = mutableMapOf<String, String>()
            root.optJSONObject("reactions")?.let { obj ->
                for (key in obj.keys()) reactions[key] = obj.optString(key)
            }

            if (animations.isEmpty()) null else PetPackSpec(
                id = root.optString("id", role),
                states = states,
                animations = animations,
                reactions = reactions,
            )
        } catch (_: Throwable) {
            null
        }
        cache[role] = pack
        return pack
    }
}
