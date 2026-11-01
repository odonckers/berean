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

    // The keyboard focus ring's color (#RRGGBB, the theme's accent) and its
    // width, corner radius and offset outside the view, in dp. Kept, so a
    // recreated activity's window gets the ring too.
    AsyncFunction("setFocusRing") { color: String, widthDp: Double, radiusDp: Double, offsetDp: Double ->
      focusRingStyle = FocusRingStyle(Color.parseColor(color), widthDp, radiusDp, offsetDp)
      attachFocusRing()
      dialogRings.forEach { (root, ring) -> attachFocusRing(ring, root) }
    }.runOnQueue(Queues.MAIN)

    // The ring above follows focus in the activity's window only. A Modal
    // (the search palette) is its own dialog window with its own view tree,
    // so a view inside it hands that window over here to get a ring too,
    // until the window goes away.
    AsyncFunction("followFocusRingIn") { view: View ->
      followFocusRingIn(view.rootView)
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersForeground { attachFocusRing() }
    OnActivityDestroys { focusRing.detach() }
  }

  private val focusRing = KeyboardFocusRing()
  private class FocusRingStyle(val color: Int, val widthDp: Double, val radiusDp: Double, val offsetDp: Double)
  private var focusRingStyle: FocusRingStyle? = null
  // Rings for other windows (Modals), by root view, each dropped when its
  // root leaves the window.
  private val dialogRings = mutableMapOf<View, KeyboardFocusRing>()

  private fun attachFocusRing() {
    val decorView = appContext.currentActivity?.window?.decorView ?: return
    attachFocusRing(focusRing, decorView)
  }

  private fun attachFocusRing(ring: KeyboardFocusRing, root: View) {
    val style = focusRingStyle ?: return
    val density = root.resources.displayMetrics.density
    ring.attach(
      root,
      style.color,
      (style.widthDp * density).roundToInt(),
      (style.radiusDp * density).roundToInt(),
      (style.offsetDp * density).roundToInt(),
    )
  }

  private fun followFocusRingIn(root: View) {
    if (!root.isAttachedToWindow) return
    if (root === appContext.currentActivity?.window?.decorView) return
    val ring = dialogRings.getOrPut(root) {
      root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
        override fun onViewAttachedToWindow(v: View) = Unit
        override fun onViewDetachedFromWindow(v: View) {
          v.removeOnAttachStateChangeListener(this)
          dialogRings.remove(v)?.detach()
        }
      })
      KeyboardFocusRing()
    }
    attachFocusRing(ring, root)
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
