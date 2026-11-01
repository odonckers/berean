package expo.modules.bereanshortcuts

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.HorizontalScrollView
import android.widget.ScrollView
import androidx.core.widget.NestedScrollView
import com.facebook.react.uimanager.ReactOverflowView
import java.lang.ref.WeakReference

// Android draws a grey fill (the default focus highlight, API 26+) over a
// view that takes focus from a hardware keyboard; over the reader's scroll
// it reads as a rendering fault. This turns that fill off on every view that
// takes focus in the window and instead draws a ring (a rounded stroke, no
// fill) a little outside the view's bounds, only while the window is out of
// touch mode, so a touch hides it. Focus itself still moves as usual.
//
// The ring lies outside the view, where a clipping ancestor (a scroll view,
// a view with overflow hidden) would cut it off, so it is drawn in the root's
// overlay (the window's decor view or a dialog's root), which nothing clips,
// at the view's rect in the root. It is re-placed before every frame, so it
// follows scroll, layout and animation, and clipped to the part of the view
// that is drawn: a side cut off by an ancestor (the field scrolled under a
// header, or past the end of a scroll view) is cut at that edge, and a view
// not on screen draws nothing. React Native views don't set clipChildren but
// clip in draw from `overflow`, so the drawn part is the view's visible rect
// cut by every ancestor that clips its children, whichever way it does.
internal class KeyboardFocusRing {
  private val ring = RingDrawable()
  private var offsetPx = 0
  private var root: WeakReference<View> = WeakReference(null)
  // The focused view the ring is around, if any.
  private var shownOn: WeakReference<View> = WeakReference(null)

  private val focusListener = ViewTreeObserver.OnGlobalFocusChangeListener { _, newFocus ->
    follow(newFocus)
  }
  private val touchModeListener = ViewTreeObserver.OnTouchModeChangeListener {
    follow(root.get()?.findFocus())
  }
  // Only while the ring is shown. It invalidates only when the ring moved,
  // so a frame it draws doesn't schedule another.
  private val preDrawListener = ViewTreeObserver.OnPreDrawListener {
    shownOn.get()?.let { place(it) }
    true
  }

  // Follows the focus in rootView's window with a ring of this color, width,
  // corner radius and offset outside the view (px). Called again with the
  // same root view, it only restyles.
  fun attach(rootView: View, color: Int, widthPx: Int, radiusPx: Int, offsetPx: Int) {
    ring.paint.color = color
    ring.paint.strokeWidth = widthPx.toFloat()
    ring.radius = radiusPx.toFloat()
    this.offsetPx = offsetPx
    if (root.get() !== rootView) {
      detach()
      val observer = rootView.viewTreeObserver
      observer.addOnGlobalFocusChangeListener(focusListener)
      observer.addOnTouchModeChangeListener(touchModeListener)
      root = WeakReference(rootView)
    }
    follow(rootView.findFocus())
    ring.invalidateSelf()
  }

  fun detach() {
    hide()
    val rootView = root.get() ?: return
    val observer = rootView.viewTreeObserver
    if (observer.isAlive) {
      observer.removeOnGlobalFocusChangeListener(focusListener)
      observer.removeOnTouchModeChangeListener(touchModeListener)
    }
    root = WeakReference(null)
  }

  private fun follow(focused: View?) {
    if (focused != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focused.setDefaultFocusHighlightEnabled(false)
    }
    val rootView = root.get()
    if (rootView == null || focused == null || focused.isInTouchMode || !focused.isFocused) {
      hide()
      return
    }
    if (shownOn.get() !== focused) {
      hide()
      rootView.overlay.add(ring)
      rootView.viewTreeObserver.addOnPreDrawListener(preDrawListener)
      shownOn = WeakReference(focused)
    }
    place(focused)
  }

  private val visible = Rect()
  private val origin = Point()
  private val clip = Rect()
  private val outline = RectF()

  private fun place(view: View) {
    val rootView = root.get()
    // getGlobalVisibleRect works in the coordinates of the view's root; the
    // origin it reports is the view's content origin, before its own scroll.
    val onScreen = rootView != null && view.isAttachedToWindow && view.rootView === rootView &&
      view.isShown && view.getGlobalVisibleRect(visible, origin) && clipToAncestors(view, rootView)
    if (rootView == null || !onScreen) {
      clip.setEmpty()
      outline.setEmpty()
    } else {
      val left = origin.x + view.scrollX
      val top = origin.y + view.scrollY
      val right = left + view.width
      val bottom = top + view.height
      // The stroke's centre line sits half its width further out, so its
      // inner edge is offsetPx outside the view. The clip on an uncut side
      // leaves a pixel past the outer edge for antialiasing.
      val centre = offsetPx + ring.paint.strokeWidth / 2
      val extent = offsetPx + ring.paint.strokeWidth.toInt() + 1
      outline.set(left - centre, top - centre, right + centre, bottom + centre)
      clip.set(
        if (visible.left > left) visible.left else left - extent,
        if (visible.top > top) visible.top else top - extent,
        if (visible.right < right) visible.right else right + extent,
        if (visible.bottom < bottom) visible.bottom else bottom + extent,
      )
      // The overlay draws in the root's content coordinates.
      outline.offset(rootView.scrollX.toFloat(), rootView.scrollY.toFloat())
      clip.offset(rootView.scrollX, rootView.scrollY)
    }
    if (outline == ring.outline && clip == ring.bounds) return
    ring.outline.set(outline)
    ring.bounds = clip
    ring.invalidateSelf()
  }

  private val ancestorRect = Rect()
  private val ancestorOrigin = Point()

  // Cuts `visible` to every ancestor up to rootView that clips its children's
  // drawing; getGlobalVisibleRect only cuts at those with clipChildren set.
  // False if nothing is left.
  private fun clipToAncestors(view: View, rootView: View): Boolean {
    var parent = view.parent
    while (parent is ViewGroup && parent !== rootView) {
      val clipBounds = parent.clipBounds
      val clips = parent.clipChildren || clipBounds != null ||
        parent is ScrollView || parent is HorizontalScrollView || parent is NestedScrollView ||
        (parent is ReactOverflowView && parent.overflow.let { it != null && it != "visible" })
      if (clips) {
        if (!parent.getGlobalVisibleRect(ancestorRect, ancestorOrigin)) return false
        if (clipBounds != null) {
          // Clip bounds are in the ancestor's own coordinates, before its scroll.
          clipBounds.offset(ancestorOrigin.x + parent.scrollX, ancestorOrigin.y + parent.scrollY)
          if (!ancestorRect.intersect(clipBounds)) return false
        }
        if (!visible.intersect(ancestorRect)) return false
      }
      parent = parent.parent
    }
    return true
  }

  private fun hide() {
    // In the root's overlay the ring's callback is the overlay's host.
    if (ring.callback != null) {
      root.get()?.let { rootView ->
        rootView.overlay.remove(ring)
        val observer = rootView.viewTreeObserver
        if (observer.isAlive) observer.removeOnPreDrawListener(preDrawListener)
        rootView.invalidate()
      }
    }
    ring.outline.setEmpty()
    ring.setBounds(0, 0, 0, 0)
    shownOn = WeakReference(null)
  }

  // A rounded stroke around `outline`, clipped to the drawable's bounds.
  private class RingDrawable : Drawable() {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    val outline = RectF()
    var radius = 0f

    override fun draw(canvas: Canvas) {
      if (bounds.isEmpty) return
      canvas.save()
      canvas.clipRect(bounds)
      canvas.drawRoundRect(outline, radius, radius, paint)
      canvas.restore()
    }

    override fun setAlpha(alpha: Int) {
      paint.alpha = alpha
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
      paint.colorFilter = colorFilter
    }

    @Deprecated("Deprecated in Java")
    override fun getOpacity() = PixelFormat.TRANSLUCENT
  }
}
