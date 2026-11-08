package cool.cnb.dshpalm.system

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.PixelFormat
import android.graphics.drawable.BitmapDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.ImageView
import android.widget.TextView
import cool.cnb.dshpalm.MainActivity
import cool.cnb.dshpalm.R
import kotlin.math.abs

/**
 * 桌面常驻桌宠悬浮窗服务（全面参考 ccch1mneyyy/dsh-go 规范）。
 *
 * 核心特性：
 * 1. EdgeSnap 边缘平滑吸附 + 惯性动画
 * 2. 像素艺术 Nearest-Neighbor 锐利渲染（禁用模糊滤波）
 * 3. 触觉与微震动反馈（拖拽、贴边）
 * 4. 任务状态与交互气泡（Speech Bubble）
 * 5. 长按快捷菜单 / 点击回 App
 */
class FloatPetService : Service() {

    private var windowManager: WindowManager? = null
    private var floatView: View? = null
    private var petImageView: ImageView? = null
    private var bubbleTextView: TextView? = null
    private var vibrator: Vibrator? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var hideBubbleRunnable: Runnable? = null

    private var pack: PetPackSpec? = null
    private var anim: PetAnimationSpec? = null
    private var sheetBitmap: Bitmap? = null
    private var sheetName: String? = null
    private var frameIndex = 0
    private var frameRunnable: Runnable? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            stopSelf()
            return
        }
        initVibrator()
        initFloatingWindow()
    }

    private fun initVibrator() {
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vm?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }

    private fun triggerHaptic(durationMs: Long = 15) {
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(durationMs)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val role = intent?.getStringExtra(EXTRA_ROLE) ?: currentRole
        val state = intent?.getStringExtra(EXTRA_STATE) ?: currentState
        currentRole = role
        currentState = state
        applyState(role, state)
        return START_STICKY
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun initFloatingWindow() {
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        val inflater = LayoutInflater.from(this)
        floatView = inflater.inflate(R.layout.float_pet, null)
        petImageView = floatView?.findViewById(R.id.float_pet_img)
        bubbleTextView = floatView?.findViewById(R.id.float_pet_bubble)

        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 24
            y = 400
        }

        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f
        var isDragging = false
        val longPressTimeout = ViewConfiguration.getLongPressTimeout().toLong()
        var longPressTriggered = false

        val longPressRunnable = Runnable {
            longPressTriggered = true
            triggerHaptic(30)
            showBubble("长按：点击可回到 App", 2500)
        }

        floatView?.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    isDragging = false
                    longPressTriggered = false
                    mainHandler.postDelayed(longPressRunnable, longPressTimeout)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val deltaX = (event.rawX - initialTouchX).toInt()
                    val deltaY = (event.rawY - initialTouchY).toInt()
                    if (abs(deltaX) > 12 || abs(deltaY) > 12) {
                        if (!isDragging) {
                            isDragging = true
                            mainHandler.removeCallbacks(longPressRunnable)
                            triggerHaptic(12)
                        }
                        params.x = initialX + deltaX
                        params.y = initialY + deltaY
                        try {
                            windowManager?.updateViewLayout(floatView, params)
                        } catch (_: Throwable) {}
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    mainHandler.removeCallbacks(longPressRunnable)
                    if (!isDragging && !longPressTriggered) {
                        // 单击：唤起 App 或展示气泡
                        triggerHaptic(15)
                        showBubble("回到会话中…", 1500)
                        val appIntent = Intent(this, MainActivity::class.java).apply {
                            action = Intent.ACTION_VIEW
                            data = Uri.parse("dshpalm://session?source=pet_float")
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                                Intent.FLAG_ACTIVITY_CLEAR_TOP
                        }
                        startActivity(appIntent)
                    } else if (isDragging) {
                        // 拖拽松手：EdgeSnap 边缘物理吸附
                        snapToEdge(params)
                    }
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    mainHandler.removeCallbacks(longPressRunnable)
                    true
                }
                else -> false
            }
        }

        try {
            windowManager?.addView(floatView, params)
            isShowing = true
            applyState(currentRole, currentState)
        } catch (_: Throwable) {
            stopSelf()
        }
    }

    /** EdgeSnap: 松手后平滑吸附至屏幕最靠近的侧边 */
    private fun snapToEdge(params: WindowManager.LayoutParams) {
        val displayMetrics = resources.displayMetrics
        val screenWidth = displayMetrics.widthPixels
        val viewWidth = floatView?.width ?: 120
        val targetX = if (params.x + viewWidth / 2 < screenWidth / 2) {
            16
        } else {
            screenWidth - viewWidth - 16
        }

        val startX = params.x
        val animator = ValueAnimator.ofInt(startX, targetX)
        animator.duration = 240
        animator.interpolator = DecelerateInterpolator()
        animator.addUpdateListener { anim ->
            params.x = anim.animatedValue as Int
            try {
                windowManager?.updateViewLayout(floatView, params)
            } catch (_: Throwable) {}
        }
        animator.start()
        triggerHaptic(18)
    }

    fun showBubble(text: String, durationMs: Long = 2000) {
        bubbleTextView?.let { tv ->
            tv.text = text
            tv.visibility = View.VISIBLE
            hideBubbleRunnable?.let { mainHandler.removeCallbacks(it) }
            val runnable = Runnable { tv.visibility = View.GONE }
            hideBubbleRunnable = runnable
            mainHandler.postDelayed(runnable, durationMs)
        }
    }

    /**
     * JS 只推 state，原生按 pack.json 自己跑帧循环。
     * 这样 App 退到后台时，悬浮窗仍然能呼吸/眨眼/播完当前动作。
     */
    private fun applyState(role: String, state: String) {
        stopAnimation()
        val loaded = PetPackLoader.load(assets, role)
        pack = loaded
        val animName = loaded?.states?.get(state) ?: state
        val spec = loaded?.animations?.get(animName) ?: loaded?.animations?.get("idle")
        if (spec == null) {
            fallbackStatic(role, state)
            return
        }
        anim = spec
        ensureSheet(role, spec)
        if (sheetBitmap == null) {
            fallbackStatic(role, state)
            return
        }
        frameIndex = 0
        renderFrame()
        scheduleNextFrame()
        showStatusBubble(state)
    }

    private fun ensureSheet(role: String, spec: PetAnimationSpec) {
        if (sheetName == spec.sheet && sheetBitmap != null) return
        val next = try {
            assets.open("pets/$role/${spec.sheet}").use { BitmapFactory.decodeStream(it) }
        } catch (_: Throwable) {
            null
        }
        if (next != null) {
            sheetBitmap?.recycle()
            sheetBitmap = next
            sheetName = spec.sheet
        }
    }

    private fun renderFrame() {
        val sheet = sheetBitmap ?: return
        val a = anim ?: return
        val frame = a.frames.getOrNull(frameIndex) ?: return
        val col = frame.first % a.cols
        val row = frame.first / a.cols
        if ((col + 1) * a.frameW > sheet.width || (row + 1) * a.frameH > sheet.height) return
        val cropped = Bitmap.createBitmap(sheet, col * a.frameW, row * a.frameH, a.frameW, a.frameH)
            .copy(Bitmap.Config.ARGB_8888, false)
        petImageView?.let { iv ->
            val drawable = BitmapDrawable(resources, cropped)
            drawable.paint.isFilterBitmap = false
            drawable.paint.isDither = false
            iv.setImageDrawable(drawable)
        }
    }

    private fun scheduleNextFrame() {
        val a = anim ?: return
        val frame = a.frames.getOrNull(frameIndex) ?: return
        val runnable = Runnable {
            if (anim !== a) return@Runnable
            if (!a.loop && frameIndex >= a.frames.lastIndex) return@Runnable
            frameIndex = (frameIndex + 1) % a.frames.size
            renderFrame()
            scheduleNextFrame()
        }
        frameRunnable = runnable
        mainHandler.postDelayed(runnable, frame.second.toLong().coerceAtLeast(40))
    }

    private fun stopAnimation() {
        frameRunnable?.let { mainHandler.removeCallbacks(it) }
        frameRunnable = null
        anim = null
        frameIndex = 0
    }

    private fun fallbackStatic(role: String, state: String) {
        val resId = when (role) {
            "maid" -> when (state) {
                "coding", "working", "juggling", "sweeping" -> R.drawable.maid_coding
                "done", "waking", "notification" -> R.drawable.maid_done
                "waiting", "attention", "thinking" -> R.drawable.maid_waiting
                else -> R.drawable.maid_sleeping
            }
            else -> when (state) {
                "coding", "working", "juggling", "sweeping" -> R.drawable.deepy_coding
                "done", "waking", "notification" -> R.drawable.deepy_done
                "waiting", "attention", "thinking" -> R.drawable.deepy_waiting
                else -> R.drawable.deepy_sleeping
            }
        }
        petImageView?.let { iv ->
            iv.setImageResource(resId)
            val drawable = iv.drawable
            if (drawable is BitmapDrawable) {
                drawable.paint.isFilterBitmap = false
                drawable.paint.isDither = false
            }
        }
    }

    private fun showStatusBubble(state: String) {
        val statusHint = when (state) {
            "working", "coding" -> "正在全力执行中…"
            "juggling" -> "双任务并进 🤹"
            "sweeping" -> "多任务全力冲刺 🔥"
            "attention", "waiting" -> "有任务等待确认 ⚠️"
            "thinking" -> "正在深思熟虑…"
            else -> null
        }
        if (statusHint != null) showBubble(statusHint, 3000)
    }

    override fun onDestroy() {
        super.onDestroy()
        isShowing = false
        stopAnimation()
        hideBubbleRunnable?.let { mainHandler.removeCallbacks(it) }
        sheetBitmap?.recycle()
        sheetBitmap = null
        if (floatView != null) {
            try {
                windowManager?.removeView(floatView)
            } catch (_: Throwable) {}
            floatView = null
        }
    }

    companion object {
        const val EXTRA_ROLE = "extra_role"
        const val EXTRA_STATE = "extra_state"

        var isShowing: Boolean = false
            private set
        var currentRole: String = "deepy"
        var currentState: String = "sleeping"

        fun start(context: Context, role: String = "deepy", state: String = "sleeping") {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
                return
            }
            val intent = Intent(context, FloatPetService::class.java).apply {
                putExtra(EXTRA_ROLE, role)
                putExtra(EXTRA_STATE, state)
            }
            context.startService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, FloatPetService::class.java)
            context.stopService(intent)
            isShowing = false
        }
    }
}
