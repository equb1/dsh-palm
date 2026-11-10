package cool.cnb.dshpalm.system

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.TextView
import cool.cnb.dshpalm.MainActivity
import cool.cnb.dshpalm.R
import java.net.URLEncoder

class QuickSearchActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_quick_search)

        val root = findViewById<FrameLayout>(R.id.quick_search_root)
        val closeBtn = findViewById<TextView>(R.id.quick_search_close)
        val input = findViewById<EditText>(R.id.quick_search_input)
        val sendBtn = findViewById<ImageButton>(R.id.quick_search_send_btn)

        // 点击卡片外部半透明阴影遮罩关闭
        root.setOnClickListener {
            hideKeyboardAndFinish()
        }

        findViewById<View>(R.id.quick_search_card).setOnClickListener {
            // 阻止冒泡
        }

        closeBtn.setOnClickListener {
            hideKeyboardAndFinish()
        }

        fun doSend() {
            val text = input.text.toString().trim()
            if (text.isNotEmpty()) {
                val encoded = URLEncoder.encode(text, "UTF-8")
                val intent = Intent(this, MainActivity::class.java).apply {
                    action = Intent.ACTION_VIEW
                    data = Uri.parse("dshpalm://session?source=widget_quick&draft=$encoded&autoSend=true")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                }
                startActivity(intent)
            }
            hideKeyboardAndFinish()
        }

        sendBtn.setOnClickListener {
            doSend()
        }

        input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                doSend()
                true
            } else {
                false
            }
        }

        // 界面打开自动聚焦并呼出键盘
        input.requestFocus()
        input.postDelayed({
            val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
            imm?.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
        }, 150)
    }

    private fun hideKeyboardAndFinish() {
        val input = findViewById<EditText>(R.id.quick_search_input)
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.hideSoftInputFromWindow(input.windowToken, 0)
        finish()
        overridePendingTransition(0, android.R.anim.fade_out)
    }

    override fun onBackPressed() {
        hideKeyboardAndFinish()
    }
}

