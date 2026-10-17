package app.inkora.android

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Base64
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import org.json.JSONObject
import java.io.File

/**
 * Inkora on Android — the same renderer, wrapped in a WebView.
 *
 * The web app talks to the phone through `window.InkoraAndroid`, which mirrors
 * the desktop bridge in src/renderer/js/platform.js. Everything stays on the
 * device: boards live in the app's private storage, exports go to Downloads.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private var pendingSaveName: String? = null
    private var pendingSaveText: String? = null

    private val createDocument =
        registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
            val text = pendingSaveText
            pendingSaveText = null
            if (uri != null && text != null) {
                contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) }
            }
        }

    private val openDocument =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri == null) return@registerForActivityResult
            val text = contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
            if (text != null) {
                val payload = JSONObject()
                    .put("path", uri.lastPathSegment ?: "board")
                    .put("text", text)
                    .toString()
                web.evaluateJavascript(
                    "window.IK && IK.store.emit('request:openText', $payload);", null
                )
            }
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_NO_CACHE
            textZoom = 100                    // ignore the system font scale on a canvas
        }
        web.setBackgroundColor(0xFFFFFFFF.toInt())
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                // Anything that isn't the bundled app opens in the browser.
                if (url.startsWith("file:///android_asset/")) return false
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                return true
            }
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfigDebug())
        web.addJavascriptInterface(Bridge(), "InkoraAndroid")
        web.loadUrl("file:///android_asset/www/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Back closes a dialog first, then clears the selection, then exits.
                web.evaluateJavascript(
                    """(function () {
                         if (!window.IK) return 'exit';
                         if (IK.dialogs.isOpen()) { IK.dialogs.close(); return 'handled'; }
                         if (IK.present.isActive()) { IK.present.stop(); return 'handled'; }
                         if (IK.store.state.selection.length) { IK.store.clearSelection(); return 'handled'; }
                         return 'exit';
                       })();"""
                ) { result ->
                    if (result.contains("exit")) finish()
                }
            }
        })
    }

    private fun BuildConfigDebug(): Boolean =
        0 != (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)

    /* ---------------------------------------------------------------- */
    /*  The JS bridge                                                    */
    /* ---------------------------------------------------------------- */

    inner class Bridge {

        private fun autosaveFile() = File(filesDir, "autosave.inkora")

        @JavascriptInterface
        fun autosave(text: String): Boolean = try {
            autosaveFile().writeText(text); true
        } catch (e: Exception) { false }

        @JavascriptInterface
        fun loadAutosave(): String? = try {
            val f = autosaveFile()
            if (f.exists()) f.readText() else null
        } catch (e: Exception) { null }

        /** Opens the system "save as" sheet so the board lands wherever the user wants. */
        @JavascriptInterface
        fun saveText(name: String, text: String): Boolean {
            pendingSaveText = text
            runOnUiThread { createDocument.launch(name) }
            return true
        }

        @JavascriptInterface
        fun openText(): String? {
            runOnUiThread { openDocument.launch(arrayOf("application/json", "*/*")) }
            return null   // the result arrives asynchronously via request:openText
        }

        /** Writes a PNG/PDF/SVG data URL into the public Downloads folder. */
        @JavascriptInterface
        fun saveBinary(name: String, dataUrl: String): Boolean = try {
            val comma = dataUrl.indexOf(',')
            val bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
            val dir = getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS)
            File(dir, name).writeBytes(bytes)
            runOnUiThread {
                android.widget.Toast.makeText(
                    this@MainActivity, "Saved to Downloads/$name", android.widget.Toast.LENGTH_SHORT
                ).show()
            }
            true
        } catch (e: Exception) { false }

        @JavascriptInterface
        fun vibrate(ms: Int) {
            val v = getSystemService(VIBRATOR_SERVICE) as? Vibrator ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createOneShot(ms.toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION") v.vibrate(ms.toLong())
            }
        }

        @JavascriptInterface
        fun setTitle(title: String) {
            runOnUiThread { this@MainActivity.title = title }
        }
    }
}
