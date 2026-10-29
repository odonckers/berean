package expo.modules.bereanshortcuts

import android.content.Context
import android.view.KeyEvent
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler

// React Native has no global hardware shortcut API on Android, so this hooks
// the activity's onKeyDown through Expo's ReactActivityDelegateWrapper.
class BereanShortcutsPackage : Package {
  override fun createReactActivityHandlers(activityContext: Context?): List<ReactActivityHandler> =
    listOf(
      object : ReactActivityHandler {
        override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
          if (keyCode != KeyEvent.KEYCODE_K || event == null || !isCtrlOrMetaOnly(event)) {
            return false
          }
          val module = BereanShortcutsModule.current.get() ?: return false
          module.emitShortcut("k")
          return true
        }
      }
    )

  // metaStateHasModifiers folds left/right variants and ignores lock keys, so
  // this is true only for Ctrl+K or Meta+K with nothing else held.
  private fun isCtrlOrMetaOnly(event: KeyEvent): Boolean =
    KeyEvent.metaStateHasModifiers(event.metaState, KeyEvent.META_CTRL_ON) ||
      KeyEvent.metaStateHasModifiers(event.metaState, KeyEvent.META_META_ON)
}
