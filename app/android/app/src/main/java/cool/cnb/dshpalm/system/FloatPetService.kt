package cool.cnb.dshpalm.system

import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import cool.cnb.dshpalm.MainActivity
import cool.cnb.dshpalm.R
import kotlin.math.abs

/**
 * 桌面常驻桌宠悬浮窗服务（App 外显示）。
 *
 * 开启后在手机桌面和其他应用上方显示 Deepy 或鲸娘；
 * 支持手指全屏自由拖拽吸附；点击直接回到 App。
 */
class FloatPetService : Service() {

    private var windowManager: WindowManager? = null
    private var floatView: View? = null
    private var petImageView: ImageView? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            stopSelf()
            return
        }
        initFloatingWindow()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val role = intent?.getStringExtra(EXTRA_ROLE) ?: currentRole
        val state = intent?.getStringExtra(EXTRA_STATE) ?: currentState
        currentRole = role
        currentState = state
        updatePetDrawable(role, state)
        return START_STICKY
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun initFloatingWindow() {
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        val inflater = LayoutInflater.from(this)
        floatView = inflater.inflate(R.layout.float_pet, null)
        petImageView = floatView?.findViewById(R.id.float_pet_img)

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
            x = 40
            y = 350
        }

        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f

        floatView?.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    params.x = initialX + (event.rawX - initialTouchX).toInt()
                    params.y = initialY + (event.rawY - initialTouchY).toInt()
                    try {
                        windowManager?.updateViewLayout(floatView, params)
                    } catch (_: Throwable) {}
                    true
                }
                MotionEvent.ACTION_UP -> {
                    val deltaX = abs(event.rawX - initialTouchX)
                    val deltaY = abs(event.rawY - initialTouchY)
                    if (deltaX < 15 && deltaY < 15) {
                        // 点击桌宠：唤起 App
                        val appIntent = Intent(this, MainActivity::class.java).apply {
                            action = Intent.ACTION_VIEW
                            data = Uri.parse("dshpalm://session?source=pet_float")
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                                Intent.FLAG_ACTIVITY_CLEAR_TOP
                        }
                        startActivity(appIntent)
                    }
                    true
                }
                else -> false
            }
        }

        try {
            windowManager?.addView(floatView, params)
            isShowing = true
        } catch (_: Throwable) {
            stopSelf()
        }
    }

    private fun updatePetDrawable(role: String, state: String) {
        val resId = when (role) {
            "maid" -> when (state) {
                "coding" -> R.drawable.maid_coding
                "done" -> R.drawable.maid_done
                "waiting" -> R.drawable.maid_waiting
                else -> R.drawable.maid_sleeping
            }
            else -> when (state) {
                "coding" -> R.drawable.deepy_coding
                "done" -> R.drawable.deepy_done
                "waiting" -> R.drawable.deepy_waiting
                else -> R.drawable.deepy_sleeping
            }
        }
        petImageView?.setImageResource(resId)
    }

    override fun onDestroy() {
        super.onDestroy()
        isShowing = false
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

