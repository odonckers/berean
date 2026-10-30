package expo.modules.bereansystembars

import android.content.Context
import android.os.Build
import android.view.View
import android.view.WindowInsetsController
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// An RN Modal is a Dialog with its own Window. ReactModalHostView's
// updateSystemAppearance copies only the activity's light-status-bar flag
// to it, never the nav-bar one, and Window.enableEdgeToEdge only sets the
// light nav-bar flag when the theme enforces nav-bar contrast, which ours
// doesn't. setNavigationBarStyle styles the activity's window only, so a
// Modal's window keeps light buttons. This view, rendered inside a Modal,
// styles the window it is attached to (the dialog's) the same way.
class ModalNavigationBarStyleView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {
  private var dark = true

  init {
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
  }

  fun setBarStyle(style: String) {
    dark = style == "dark"
    // Posted, so it lands after RN's own dialog setup (show, then
    // updateProperties and updateSystemAppearance).
    post { apply() }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    post { apply() }
  }

  private fun apply() {
    if (!isAttachedToWindow) return
    // As in BereanSystemBarsModule: the framework controller on API 31+,
    // where it is what counts; View.getWindowInsetsController is the
    // controller of the window this view is in.
    if (Build.VERSION.SDK_INT > Build.VERSION_CODES.R) {
      windowInsetsController?.setSystemBarsAppearance(
        if (dark) WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS else 0,
        WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
      )
    }
    // On API <= 30 this is the whole job (the legacy flag on the dialog's
    // decor view); above that it keeps the legacy flag in sync.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val root = rootView
      @Suppress("DEPRECATION")
      root.systemUiVisibility =
        if (dark) {
          root.systemUiVisibility or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        } else {
          root.systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
        }
    }
  }
}
