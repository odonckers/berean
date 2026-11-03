package expo.modules.bereansystemcolors

import android.app.UiModeManager
import android.content.ComponentCallbacks
import android.content.Context
import android.content.res.Configuration
import android.database.ContentObserver
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The Android 12+ wallpaper palette ("System colors", themes spec §11,
// §12.4) and the system contrast level (§12.1, open item 2). JS decides what
// to do with them (src/design/system-colors.ts); this only reads them and
// says when they may have changed.
class BereanSystemColorsModule : Module() {
  private var observer: ContentObserver? = null
  private var callbacks: ComponentCallbacks? = null
  private var contrastListener: Any? = null

  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("BereanSystemColors")

    // The palette or the contrast level may have changed: read them again.
    Events("onChange")

    Function("isAvailable") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.S }

    // The M3 roles from the system tonal palettes, as #RRGGBB, or null
    // before Android 12.
    Function("getSystemColors") { scheme: String ->
      val ctx = context
      if (ctx == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) null
      else systemColors(ctx, scheme == "dark")
    }

    Function("getContrast") { contrast() }

    OnCreate { register() }
    OnDestroy { unregister() }
    // A wallpaper or setting changed while the app was away.
    OnActivityEntersForeground { notifyChange() }
  }

  private fun notifyChange() {
    sendEvent("onChange", mapOf<String, Any>())
  }

  /**
   * The system contrast level, -1 to 1 (0 is standard; Android 14's
   * Settings › Color contrast reports 0.5 for Medium and 1 for High).
   *
   * Android 14 (API 34) and later: UiModeManager.getContrast().
   * Earlier: there is no contrast level, so this reads the closest setting,
   * Accessibility › High contrast text ("high_text_contrast_enabled"), as
   * 1.0 when it is on and 0.0 otherwise. That key is hidden; if the platform
   * refuses to read it (SecurityException), this reports 0.0.
   */
  private fun contrast(): Double {
    val ctx = context ?: return 0.0
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      val uiModeManager = ctx.getSystemService(UiModeManager::class.java) ?: return 0.0
      return uiModeManager.contrast.toDouble()
    }
    return try {
      if (Settings.Secure.getInt(ctx.contentResolver, HIGH_TEXT_CONTRAST, 0) == 1) 1.0 else 0.0
    } catch (_: SecurityException) {
      0.0
    }
  }

  private fun register() {
    val ctx = context ?: return
    val handler = Handler(Looper.getMainLooper())

    // High contrast text (the contrast fallback below Android 14).
    observer = object : ContentObserver(handler) {
      override fun onChange(selfChange: Boolean) = notifyChange()
    }.also {
      try {
        ctx.contentResolver.registerContentObserver(Settings.Secure.getUriFor(HIGH_TEXT_CONTRAST), false, it)
      } catch (_: SecurityException) {
        // Not observable here; the foreground check still catches it.
      }
    }

    // A new wallpaper palette arrives as a configuration change when the
    // activity handles it rather than being recreated.
    callbacks = object : ComponentCallbacks {
      override fun onConfigurationChanged(newConfig: Configuration) = notifyChange()

      @Deprecated("Deprecated in Java")
      override fun onLowMemory() {}
    }.also { ctx.registerComponentCallbacks(it) }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      contrastListener = addContrastListener(ctx)
    }
  }

  @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
  private fun addContrastListener(ctx: Context): UiModeManager.ContrastChangeListener? {
    val uiModeManager = ctx.getSystemService(UiModeManager::class.java) ?: return null
    val listener = UiModeManager.ContrastChangeListener { notifyChange() }
    uiModeManager.addContrastChangeListener(ContextCompat.getMainExecutor(ctx), listener)
    return listener
  }

  private fun unregister() {
    val ctx = context
    if (ctx != null) {
      observer?.let { ctx.contentResolver.unregisterContentObserver(it) }
      callbacks?.let { ctx.unregisterComponentCallbacks(it) }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        (contrastListener as? UiModeManager.ContrastChangeListener)?.let {
          ctx.getSystemService(UiModeManager::class.java)?.removeContrastChangeListener(it)
        }
      }
    }
    observer = null
    callbacks = null
    contrastListener = null
  }

  companion object {
    private const val HIGH_TEXT_CONTRAST = "high_text_contrast_enabled"

    /**
     * Tones mapped to roles as Material 3's dynamic schemes do: accent1 is
     * the primary palette, accent2 the secondary; the suffix is the tone
     * step (0 white … 1000 black).
     */
    @RequiresApi(Build.VERSION_CODES.S)
    private fun systemColors(ctx: Context, dark: Boolean): Map<String, String> {
      fun hex(id: Int) = String.format("#%06X", 0xFFFFFF and ContextCompat.getColor(ctx, id))
      return if (dark) {
        mapOf(
          "primary" to hex(android.R.color.system_accent1_200),
          "onPrimary" to hex(android.R.color.system_accent1_800),
          "primaryContainer" to hex(android.R.color.system_accent1_700),
          "onPrimaryContainer" to hex(android.R.color.system_accent1_100),
          "secondaryContainer" to hex(android.R.color.system_accent2_700),
        )
      } else {
        mapOf(
          "primary" to hex(android.R.color.system_accent1_600),
          "onPrimary" to hex(android.R.color.system_accent1_0),
          "primaryContainer" to hex(android.R.color.system_accent1_100),
          "onPrimaryContainer" to hex(android.R.color.system_accent1_900),
          "secondaryContainer" to hex(android.R.color.system_accent2_100),
        )
      }
    }
  }
}
