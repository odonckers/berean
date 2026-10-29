package expo.modules.bereanshortcuts

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class BereanShortcutsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BereanShortcuts")
    Events("onShortcut")

    OnCreate { current = WeakReference(this@BereanShortcutsModule) }
    OnDestroy {
      if (current.get() === this@BereanShortcutsModule) current = WeakReference(null)
    }
  }

  internal fun emitShortcut(key: String) {
    sendEvent("onShortcut", mapOf("key" to key))
  }

  companion object {
    // The activity handler in BereanShortcutsPackage has no module reference
    // of its own, so it reaches the live instance through this.
    internal var current: WeakReference<BereanShortcutsModule> = WeakReference(null)
  }
}
