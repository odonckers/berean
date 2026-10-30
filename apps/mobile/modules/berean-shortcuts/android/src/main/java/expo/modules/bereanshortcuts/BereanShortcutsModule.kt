package expo.modules.bereanshortcuts

import android.graphics.Color
import android.view.KeyEvent
import android.view.View
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference
import kotlin.math.roundToInt

class BereanShortcutsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BereanShortcuts")
    Events("onShortcut", "onListKey")

    OnCreate { current = WeakReference(this@BereanShortcutsModule) }
    OnDestroy {
      if (current.get() === this@BereanShortcutsModule) current = WeakReference(null)
    }

    // A text field that drives a list (the search palette's) takes hardware
    // Up/Down from its cursor and reports them. TextInput's onKeyPress only
    // sees soft-keyboard input, and the activity's onKeyDown never sees keys
    // inside a Modal (its own dialog window), so this listens on the field.
    AsyncFunction("captureListKeys") { view: View ->
      view.setOnKeyListener(listKeys)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("releaseListKeys") { view: View ->
      view.setOnKeyListener(null)
    }.runOnQueue(Queues.MAIN)

    // The keyboard focus ring's color (#RRGGBB, the theme's accent) and width
    // in dp. Kept, so a recreated activity's window gets the ring too.
    AsyncFunction("setFocusRing") { color: String, widthDp: Double ->
      focusRingStyle = Color.parseColor(color) to widthDp
      attachFocusRing()
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersForeground { attachFocusRing() }
    OnActivityDestroys { focusRing.detach() }
  }

  private val focusRing = KeyboardFocusRing()
  private var focusRingStyle: Pair<Int, Double>? = null

  private fun attachFocusRing() {
    val (color, widthDp) = focusRingStyle ?: return
    val decorView = appContext.currentActivity?.window?.decorView ?: return
    val widthPx = (widthDp * decorView.resources.displayMetrics.density).roundToInt()
    focusRing.attach(decorView, color, widthPx)
  }

  internal fun emitShortcut(key: String) {
    sendEvent("onShortcut", mapOf("key" to key))
  }

  companion object {
    // The activity handler in BereanShortcutsPackage has no module reference
    // of its own, so it reaches the live instance through this.
    internal var current: WeakReference<BereanShortcutsModule> = WeakReference(null)

    // Plain Up/Down only (Shift+Up still extends the text selection); the
    // key up is consumed too so the field never moves its cursor. Enter is
    // left to the field, which submits.
    private val listKeys = View.OnKeyListener { _, keyCode, event ->
      val key = when (keyCode) {
        KeyEvent.KEYCODE_DPAD_UP -> "up"
        KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        else -> return@OnKeyListener false
      }
      if (!event.hasNoModifiers()) return@OnKeyListener false
      if (event.action == KeyEvent.ACTION_DOWN) {
        current.get()?.sendEvent("onListKey", mapOf("key" to key))
      }
      true
    }
  }
}
