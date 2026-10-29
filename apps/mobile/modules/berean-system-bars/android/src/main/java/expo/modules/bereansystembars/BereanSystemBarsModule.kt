package expo.modules.bereansystembars

import android.os.Build
import android.view.WindowInsetsController
import androidx.core.view.WindowInsetsControllerCompat
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BereanSystemBarsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BereanSystemBars")

    // React Native's StatusBarModule calls the framework
    // insetsController.setSystemBarsAppearance on API 31+, which marks the
    // window's appearance as app-controlled so the legacy systemUiVisibility
    // light flags stop counting. androidx.core 1.18's Impl30 (API 30-34) only
    // writes those legacy flags, so we write the nav bit where RN writes the
    // status bit.
    AsyncFunction("setNavigationBarStyle") { style: String ->
      val window = appContext.currentActivity?.window ?: return@AsyncFunction
      val dark = style == "dark"
      if (Build.VERSION.SDK_INT > Build.VERSION_CODES.R) {
        window.insetsController?.setSystemBarsAppearance(
          if (dark) WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS else 0,
          WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
        )
      }
      // On API <= 30 this is the whole job (legacy flags, as RN does there);
      // above that it keeps the legacy flag in sync for compat readers.
      WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightNavigationBars = dark
    }.runOnQueue(Queues.MAIN)
  }
}
