package expo.modules.bereanshortcuts

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.View
import android.view.ViewTreeObserver
import java.lang.ref.WeakReference

// Android draws a grey fill (the default focus highlight, API 26+) over a
// view that takes focus from a hardware keyboard; over the reader's scroll
// it reads as a rendering fault. This turns that fill off on every view that
// takes focus in the window and instead draws a ring (stroke only) in the
// view's overlay, only while the window is out of touch mode, so a touch
// hides it. Focus itself still moves as usual.
internal class KeyboardFocusRing {
  private val ring = GradientDrawable().apply {
    shape = GradientDrawable.RECTANGLE
    setColor(Color.TRANSPARENT)
  }
  private var decor: WeakReference<View> = WeakReference(null)
  // The view whose overlay holds the ring, if any.
  private var shownOn: WeakReference<View> = WeakReference(null)

  private val focusListener = ViewTreeObserver.OnGlobalFocusChangeListener { _, newFocus ->
    follow(newFocus)
  }
  private val touchModeListener = ViewTreeObserver.OnTouchModeChangeListener {
    follow(decor.get()?.findFocus())
  }
  // A scrolling view draws its overlay in content coordinates, so the ring
  // moves with its scroll offset to stay on the view's visible bounds.
  private val scrollListener = ViewTreeObserver.OnScrollChangedListener {
    shownOn.get()?.let { place(it) }
  }
  private val layoutListener = View.OnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
    place(view)
  }

  // Follows the focus in decorView's window with a ring of this color and
  // width (px). Called again with the same decor view, it only restyles.
  fun attach(decorView: View, color: Int, widthPx: Int) {
    ring.setStroke(widthPx, color)
    if (decor.get() !== decorView) {
      detach()
      val observer = decorView.viewTreeObserver
      observer.addOnGlobalFocusChangeListener(focusListener)
      observer.addOnTouchModeChangeListener(touchModeListener)
      observer.addOnScrollChangedListener(scrollListener)
      decor = WeakReference(decorView)
    }
    follow(decorView.findFocus())
    shownOn.get()?.invalidate()
  }

  fun detach() {
    hide()
    val decorView = decor.get() ?: return
    val observer = decorView.viewTreeObserver
    if (observer.isAlive) {
      observer.removeOnGlobalFocusChangeListener(focusListener)
      observer.removeOnTouchModeChangeListener(touchModeListener)
      observer.removeOnScrollChangedListener(scrollListener)
    }
    decor = WeakReference(null)
  }

  private fun follow(focused: View?) {
    if (focused != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focused.setDefaultFocusHighlightEnabled(false)
    }
    if (focused == null || focused.isInTouchMode || !focused.isFocused) {
      hide()
      return
    }
    if (shownOn.get() !== focused) {
      hide()
      focused.overlay.add(ring)
      focused.addOnLayoutChangeListener(layoutListener)
      shownOn = WeakReference(focused)
    }
    place(focused)
  }

  private fun place(view: View) {
    ring.setBounds(view.scrollX, view.scrollY, view.scrollX + view.width, view.scrollY + view.height)
    view.invalidate()
  }

  private fun hide() {
    val view = shownOn.get()
    if (view != null) {
      view.overlay.remove(ring)
      view.removeOnLayoutChangeListener(layoutListener)
      view.invalidate()
    }
    shownOn = WeakReference(null)
  }
}
