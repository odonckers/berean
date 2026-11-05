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
          val key = shortcutKeys[keyCode]
          if (key == null || event == null || !isCtrlOrMetaOnly(event)) {
            return false
          }
          val module = BereanShortcutsModule.current.get() ?: return false
          module.emitShortcut(key)
          return true
        }
      }
    )

  // K opens search; 1 and 2 switch the note editor to Write and Read; D
  // opens the Bible reader's bookmarks.
  private val shortcutKeys =
    mapOf(
      KeyEvent.KEYCODE_K to "k",
      KeyEvent.KEYCODE_1 to "1",
      KeyEvent.KEYCODE_2 to "2",
      KeyEvent.KEYCODE_D to "d"
    )

  // metaStateHasModifiers folds left/right variants and ignores lock keys, so
  // this is true only for Ctrl or Meta with the key and nothing else held.
  private fun isCtrlOrMetaOnly(event: KeyEvent): Boolean =
    KeyEvent.metaStateHasModifiers(event.metaState, KeyEvent.META_CTRL_ON) ||
      KeyEvent.metaStateHasModifiers(event.metaState, KeyEvent.META_META_ON)
}
