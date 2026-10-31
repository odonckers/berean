# Studyspace canvas: feel findings and specs

**Status:** Draft. Kerning & Co. findings (Iris, with Pebble, Hinge, Nova and Magpie), written up by Lumen. Wren ruled the product calls on Oct 31 2026 (§11); Owen can override any of them in this PR. Every number is a **proposal to check on a device**, per the [README conventions](README.md#conventions).
**Board row:** Expo 7, Studyspace (`PVTI_lAHOALCvmc4BpDa0zhFCJSA`). It follows 6c; backup and import go last. Follow-up rows: connectors (…FCK6w), pinned card layouts (`PVTI_lAHOALCvmc4BpDa0zhFCM8I`), Pencil text-annotation storage (…FCK8U), Studyspace in backups (…FCPpc).
**Platforms:** SwiftUI on iOS, iPadOS and macOS. Expo (`apps/mobile`) on iOS and Android, in both looks: Material 3 and the iOS look.
**Owner:** Design (Lumen). **Core:** Echo (`echo/studyspace`, not pushed when this was written). **Build:** Kiwi and Moss (SwiftUI), Otter (Expo).
**Frames:** eight annotated wireframes from Kerning & Co. in [studyspace-frames/](studyspace-frames/). Each shows the iOS and Material looks side by side wherever they differ, and marks its opinions as **OPINION**. Frames are wireframes, not final art.

This doc covers how the canvas *feels*: pan and zoom physics, inertia, snapping, dragging and resizing, selection, switching workspaces, opening items from Omnisearch, note links, and reader cards (Owen's addition: publications open on the canvas as live reader windows). Visual layout follows the design guide §4 ([berean-design-guide.md](berean-design-guide.md)). The core model is summarised in §2.

## 1. How other apps do it

Sources are listed in §12. **Unverified** marks anything that we couldn't confirm from documentation or code (community reports, marketing copy, or our own reading of a demo).

### 1.1 Canvas apps

| App | Zoom range | Edges | Zoom-out legibility | Selection and input | Links | What we take |
| --- | --- | --- | --- | --- | --- | --- |
| **Apple Freeform** | 10–400%; menu steps 10, 25, 50, 75, 100, 200, 400, plus Zoom to Fit Content and Fit Selection | "Not technically infinite" (9to5Mac) | Content scales | iPad: touch and hold on empty canvas for a marquee. Mac: Space+drag pans. Guides for centre, edges, matching size and equal spacing; a second finger while dragging constrains | Connector lines | The marquee gesture, the alignment guides, the second-finger constrain, Space+drag, and 10% as the zoom-out minimum |
| **Allume** (formerly Muse; renamed with v4.0 in 2026, per allume.com) | Not documented | **Bounded**: a board starts at the top left and grows right and down | Nested boards; you zoom *into* a board card | Pencil-first, with a low-angle grip for selecting (unverified, from the Ink & Switch write-up) | Nesting rather than lines | Closest model for reader cards: a PDF sits inert on the board until you double-click or pinch into it, and pinching out or Back leaves it. Card text follows the system text size |
| **Heptabase** | Min 10% (mobile v1.39.0, Sep 2026); max not documented | Unknown | "Large text at small zoom": titles only below 30%, larger at 15% and 10% | ⇧1 fit all, ⇧2 fit selection, Space quick look | Two-way links and canvas lines | Fit shortcuts, the quick look, title-only zoomed-out cards, and placing a new card next to the one you're working on |
| **Miro** | 1% (Web SDK `setZoom` 0.01); the UI goes "up to 2000%" (Help Center), the SDK to 400% | Effectively unbounded. The minimum depends on board content (community report, **unverified**) | Content scales | Pointer-first | Connectors | Precedent for letting fit-all go below 10% (our 2% floor) |
| **Scrintal** | Not documented (**unverified**) | "Infinite canvas" (marketing, **unverified**) | Pinned card layouts: Compact, Snippet, Full | — | **Split model:** global two-way links vs canvas-only connectors | The links/connectors split. Our existing note hyperlinks are the global links; connectors come later (row …FCK6w). Pinned layouts are after v1 |
| **MarginNote 4** | Not documented (**unverified**) | Unknown | — | — | Document and mind map side by side, with a four-state link control | A publication card keeps its place in the source, and **Show in reader** jumps there |
| **tldraw** (code, main 9e700c6; Magpie's bonus reference) | 5–800%; steps 5, 10, 25, 50, 100, 200, 400, 800 (they double from 25% up; 5→10→25 doesn't) | Unbounded by default | Content scales | Drag starts at 4 px (pointer) or 6 px (coarse). Snap threshold 8 **screen** px, so the same on-screen distance at every zoom. Double-click 450 ms, long press 500 ms | Arrows | The 800% max, the thresholds, fit padding of 128 px capped at 28% of the viewport width, and friction scaled by elapsed time (0.09 per 60 Hz tick × elapsed/16.67 ms, about 0.994 per ms). Checked against `options.ts` and `constants.ts` on Oct 31 2026 |
| **Excalidraw** (code, 8bcdca4) | 10–3000%, linear 0.1 steps | Unbounded | Content scales | — | Arrows | Rejected: linear zoom steps feel uneven |

**Magpie's bonus references:**

| Source | What it shows | What we take |
| --- | --- | --- |
| **tldraw** `options.ts` (row above) | Time-scaled friction, 4/6 px drag, 500 ms long press, doubling zoom steps, a constant 8 screen-px snap, 128 px fit padding | Thresholds and fit padding. Its friction is stronger than UIKit's, so we use 0.998/ms instead (§3.5) |
| **Figma**, [Use Figma with a keyboard](https://help.figma.com/hc/en-us/articles/360040328653-Use-Figma-products-with-a-keyboard) | With nothing selected, arrow keys pan; Shift pans farther, scaled by zoom. A keyboard box-selection tool (⌥Space on Mac, Ctrl+Space on Windows) with ⌘-arrows to grow the box | Arrow-key pan (§3.2) and the keyboard marquee (§7.1, §9). Figma's tap-vs-hold Space isn't on that page (**unverified**); our tap/hold rule is Iris's (§4.1) |
| **Google Maps** `gestureHandling: "cooperative"` ([docs](https://developers.google.com/maps/documentation/javascript/interaction#gestureHandling)) | One finger scrolls the page; two fingers pan and zoom the map | Reader-card direction C, **rejected** (§6.1): on a Mac, two-finger trackpad scroll is how you pan the canvas, so it can't also mean "scroll the card" |

### 1.2 Reader-card references

| App | How a document lives on the canvas | Verdict |
| --- | --- | --- |
| **Allume** (formerly Muse) | The PDF is inert on the board. Double-click or pinch to go in; pinch out or Back to leave (Allume memo, Mar 2022) | **Closest to ours.** We keep the inert-until-entered idea, but enter in place with a tap |
| **Heptabase** | A PDF card opens in a popup or tab, and keyboard shortcuts work after you click into it (wiki, PDF annotation) | Click-in focus for the keyboard |
| **LiquidText** | The document sits in its own pane beside the workspace (Interface Lineage) | The docked study pane (§6.4) |
| **MarginNote 4** | Document and map side by side, with links between them | Show in reader, and keeping each card's place |

## 2. The model the feel sits on (Echo's core)

The core model is Echo's (`echo/studyspace`); the full write-up with sources is Lumen's early viewport note. Only the parts the feel depends on are listed here.

| Part | Value | Owner |
| --- | --- | --- |
| Units | 1 world unit = 1 pt (Apple) or 1 dp (Android) at 100%. f64 everywhere. y points down. (0,0) is a new workspace's starting camera centre | Core |
| Bounds | The model is unbounded. Keep `abs(x)` and `abs(y)` ≤ 1e6 (recommended validation). Renderers subtract the camera centre in f64 before converting to f32 | Core stores; apps render |
| Camera | One per workspace: `{ center_x, center_y, scale }`, saved when a gesture settles, never per frame. `world = center + (screen − viewport/2) / scale` | Core stores; apps restore and clamp |
| Zoom limits | **The core doesn't clamp**; it only rejects scale ≤ 0 or non-finite. `ZoomLimits` and `step_zoom` belong to the apps (§3.1) | Apps |
| Items | `{ id, workspace_id, kind, x, y, w, h, z }`. x,y is the **top-left** corner. `z` is an integer, and bring-to-front sets max+1. No rotation in v1. Recommended validation: 24 ≤ w,h ≤ 8192 | Core |
| Content bounds | Apps compute them from `items()` for fit-all and the soft edges | Apps |
| Reader card | `anchor` = core `Location` (a verse, or a paragraph id) at the top visible line, plus `char_offset` in **UTF-16 code units** into the core's plain text for that block. Clamp to the block length on restore; if the anchor is gone, use the nearest earlier block. Two cards of one publication keep separate state | Core |
| `last_used_at` (decided, Wren) | A column on the canvas item, exposed as `CanvasItem.last_used_at`. Set when the item is added; bumped by `set_reader_state` and by a new `touch_item(item_id)` on focus or note-link reuse (§6.6). Approved and in Echo's core PR | Core (Echo) |
| Not persisted | Focus, `preFocusViewport`, `moved_while_focused` | App session state |
| On their own row | `selection` and `study_pane` per reader card (Echo's separate row) | Core, later |
| Annotations | Reuse `userdata::TextRange` (JW word tokens). Pencil styles are on row …FCK8U (§6.7) | Core, later |

## 3. Pan and zoom

### 3.1 Zoom limits and steps

| Setting | iPhone and Android phone (< 600 pt/dp) | iPad, Android tablet, Mac |
| --- | --- | --- |
| Maximum | **400%** | **800%** |
| Minimum for pinch, scroll and keys | **10%** | **10%** |
| Fit-all floor | **2%**. Only fit-all may go below 10% | **2%**, same rule |
| Steps (⌘+ / ⌘−, Ctrl on Android, and the zoom stack's + and −) | 10, 25, 50, 75, 100, 150, 200, 300, **400** | 10, 25, 50, 75, 100, 150, 200, 300, 400, 600, **800** |
| Next-step rule | Pick the next step by **log-space midpoints**, not tldraw's linear halfway | Same |
| Restoring a camera saved on a bigger device | Clamp to the device's range (a camera saved at 800% on iPad opens at 400% on iPhone) | — |

**Why:** 800% matches tldraw and leaves room for Pencil detail. Phones stop at 400% because tapping a card opens it full screen, so deep zoom isn't how you read there. The 10% minimum matches Freeform and Heptabase. At 10%, a 260 pt card is 26 pt wide, which is the L1 block level (§5). The 2% floor exists so fit-all always frames a big workspace (Wren, 2:08 PM).

### 3.2 Gestures

| Input | Pans | Zooms | Notes |
| --- | --- | --- | --- |
| Touch | One finger on empty canvas. On a reader card, one finger scrolls the card when it is **at least 320 pt wide on screen**; a smaller card pans the canvas (§6.1) | Pinch, around the **focal point** (the world point under the fingers stays put) | Pinch always zooms the canvas, never the card |
| Trackpad (Mac, iPad) | Two-finger scroll pans the canvas until the card under the pointer is focused. A resting pointer never grabs the scroll | Pinch, or ⌘-scroll, around the **cursor** | **No added inertia**: AppKit sends momentum events, and we apply them 1:1. Momentum stays with the gesture that started it |
| Mouse | Wheel scrolls; Space+drag pans | ⌘-scroll around the cursor | — |
| Keyboard (canvas focused, nothing selected) | Arrows pan; ⇧+arrows pan farther, scaled by zoom (Figma) | ⌘+ / ⌘− step; ⌘0 to 100%; ⇧1 fit all; ⇧2 fit selection (Heptabase) | Ctrl replaces ⌘ on Android |
| Double tap (touch) or double click (Mac, pointer) on **empty canvas** | — | Toggles between **100% at the tap point** and **fit-all**, on every device | **Body taps stay instant** (no double-tap delay). The one exception is a double-tap on a card's **header** on tablet, which opens the side split (§8) and doesn't delay body taps. No "next zoom step" on double tap; steps stay on ⌘+ / ⌘− (⌘0 = 100%, ⇧1 = fit-all). Settles with `.smooth` |

**Target lock.** Every gesture picks its target when it starts and keeps it until it ends. A pan or fling that starts on the canvas stays a canvas pan even if a card slides under the finger or pointer. **Space+drag and pinch always move the canvas.** Trackpad momentum belongs to the gesture that started it.

All zoom maths runs in **log space**: interpolation, the rubber band, the detent window and the step midpoints. Store scale as linear f64.

### 3.3 Pinch settle: soft detents (option B) — [frame 02](studyspace-frames/02-pinch-settle-timeline.png)

| Rule | Value |
| --- | --- |
| Detents | **100% and fit-all only.** The 11 steps are for ⌘+ / ⌘− and the zoom-stack buttons, never for pinch |
| Detent window | `abs(ln(z / detent)) ≤ 0.05`, so about 95–105% around 100% |
| Release inside a window | Eases to the detent with the settle spring (§3.6), seeded with the release velocity |
| Release outside every window | Stays exactly where it is. Pinch has **no zoom inertia** |
| Rejected | A: fully continuous (100% is hard to hit). C: Allume-style always-ease (Muse) (fights the fingers) |

### 3.4 Rubber bands and edges

| Case | Rule |
| --- | --- |
| Zoom past the maximum (pinch, trackpad pinch) | Rubber band in **log2 zoom**: shown overshoot = `(1 − 1/(x·0.55/d + 1))·d`, with x = log2(finger zoom / max) and **d = 0.5 octave**. Overshoot tops out at max × 2^0.5, about **1130%** for an 800% max (about 566% on phones). Example: fingers imply 1100%, the canvas shows 899% |
| Zoom below the minimum (pinch) | The same curve below 10%, so it bottoms out near 7%. It springs back to 10%. To see more of a big workspace, use fit-all |
| Release in the rubber band | Springs back to the limit with the settle spring, bounce 0 |
| ⌘+ / ⌘−, ⌘-scroll, keyboard | **Hard stop** at the limits. No rubber band, no detent easing |
| Pan edges (soft bounds) | The content bounds expanded by **one viewport** on each side. Past that, touch and trackpad drags rubber-band with the same curve, d = the viewport's size on that axis, and spring back on release |
| Keyboard pans | Hard stop at the soft bounds |
| Empty workspace | The soft bounds are one viewport around (0,0) |

The 0.55 curve is community-measured from UIScrollView, not documented by Apple (**unverified**). It supersedes the 0.8× / 1.25× overshoot in the early viewport note.

### 3.5 Pan inertia

| Platform | Decay | Implementation |
| --- | --- | --- |
| SwiftUI (iOS, iPadOS) and the Expo **iOS look** | **0.998 per ms** (UIKit `.normal`, per React Native's docs; Apple doesn't print the value). `v(t) = v0 · 0.998^t` | SwiftUI: the scroll view's normal deceleration where we use one, otherwise the formula. Expo: apply the formula directly in a Reanimated worklet. **Don't use `withDecay` with defaults**: it decays as `exp(−(1−d)·t·0.1)` and travels about 10× farther (4,991 pt instead of 499 pt for a 1000 pt/s fling) |
| Expo **Material look** (Android) | **Native Android fling**, about **0.985** (React Native's Android mapping; the AOSP OverScroller is a spline, not geometric) | Use the platform fling so it feels like every other Android list. **Lumen's decision** |
| Mac, iPad trackpad, mouse wheel | No added inertia | System momentum events only. Momentum stays with the gesture that started it (§3.2), so it keeps panning the canvas even if a card slides under the pointer |

- **Projected rest:** `projectedRest(v) = (v / 1000) · r / (1 − r)` with v in pt/s and r the per-ms rate (WWDC18 803). At 0.998, a 1000 pt/s fling travels 499 pt.
- Compute the rest point at release and check it against the soft bounds. If it lands past them, the fling runs into the rubber band and springs back. Never stop dead at the edge.
- Inertia is time-based, never per frame, so 60 Hz and 120 Hz devices feel the same. Set `CADisableMinimumFrameDurationOnPhone` to true (Otter through `app.json` `ios.infoPlist`, Kiwi in Xcode) so iPhone can run at 120 Hz.

### 3.6 Springs and curves

| Use | SwiftUI | Expo (Reanimated, on the UI thread) | Reduce Motion |
| --- | --- | --- | --- |
| Pinch settle, fit-all, fit selection, zoom-to, focus zoom, spring back from a rubber band | `.smooth` (duration 0.5 s, bounce 0), seeded with the gesture's release velocity | `withSpring({ duration: 500, dampingRatio: 1 })`, seeded with the velocity from react-native-gesture-handler | Gestures stay 1:1. The pinch settle becomes a **150 ms ease-out** (or a jump). Other automatic camera moves cross-fade or jump |
| Snapping a dragged card into place | `.snappy`, bounce 0.15 | `withSpring` with matching parameters | Instant |
| Anywhere | **Never `.bouncy`** | — | — |

Sources: WWDC23 10158 for the springs; frame 02 computes its curves from them.

## 4. Thresholds, snapping, dragging and resizing

### 4.1 Thresholds

Native recognizers keep their system values. Custom recognizers use these.

| Threshold | Pointer | Touch | Source |
| --- | --- | --- | --- |
| Drag starts after | 4 pt | 6 pt | tldraw |
| Long press | — | 500 ms (system recognizers keep the system value, which is 400 ms on Android) | tldraw, AOSP |
| Double tap / click (empty canvas only) | 450 ms | 450 ms | tldraw |
| Space: tap vs hold | Tap = released within **about 200 ms** and moved under 4 pt (tune on device); otherwise it's a hold to pan | — | Iris |
| Pinch detent window | — | ±5% in log space | §3.3 |
| Hit areas | ≥ 44 × 44 pt (Apple) / 48 × 48 dp (Material), handles included | Same | HIG, M3 |

### 4.2 Snapping

| Rule | Value |
| --- | --- |
| Snap distance | **6 pt with a pointer, 10 pt with touch**, measured on screen (tldraw uses 8 screen px) |
| Guides | Centre, edges, matching size and equal spacing (Freeform). Shown only while dragging |
| Haptic | `.alignment` sensory feedback when a guide catches, on iPhone, iPad and the Mac trackpad. Android: `CLOCK_TICK`-weight feedback in the Material look (**to confirm with Otter**) |
| Turn it off | Hold ⌘ (Ctrl on Android) during a drag to turn snapping off for that drag |
| Grid | **No grid snapping.** The dot grid (28 pt on iPad and Mac, 14 pt on iPhone, per the guide) is decoration. The 8 pt grid in §7 is only for choosing a landing spot |
| Snap animation | `.snappy`, bounce 0.15 (§3.6) |

### 4.3 Dragging and resizing

| Action | Phone | Tablet | Mac and pointer |
| --- | --- | --- | --- |
| Move a card | Long press (500 ms) lifts it, then drag | Long press lifts it, or drag a selected card | Drag after 4 pt |
| Nudge | — | With a keyboard: arrows nudge 1 pt, ⇧ 10 pt | Arrows 1 pt, ⇧ 10 pt |
| Resize | Handles in Select mode | Handles: 8 pt visible, ≥ 44 pt / 48 dp hit area | Same handles; cursor changes on hover |
| Constrain or match sizes | — | A second finger on the canvas while dragging (Freeform iPad) | ⇧ while dragging |
| Accessible alternative (WCAG 2.5.7) | Size menu and Move actions in the card's menu and the List view | Same, plus a keyboard shortcut | Same |

Minimum sizes come from content, not the core. A reader card can't shrink below its minimum live size (§6.3). Echo's validation is a sanity check only (24–8192).

## 5. Semantic zoom levels — [frame 01](studyspace-frames/01-semantic-zoom.png), [frame 06](studyspace-frames/06-reader-zoom-levels.png)

A card's level comes from its **width on screen** (card width × zoom), not from the zoom percentage. A big card can be at L4 while a small card at the same zoom is at L2.

| Level | On-screen width (at 17 pt text) | Note card | Publication card | Reader card |
| --- | --- | --- | --- | --- |
| L1 | < 48 pt | Colour block + note glyph | Colour block + publication glyph | Colour block + publication glyph |
| L2 | 48–160 pt | Title, wraps to 2 lines, then truncates | Title ("Romans 8") | "Romans 8" only |
| L3 | 160–320 pt | Title + first 2–3 lines (UI sans), ellipsis | Title + snippet in the reading serif | "Romans 8" + about 3 lines from the **saved anchor verse**, with its verse number |
| L4 | > 320 pt | Full text. Tap or click into the text to edit | Full text. **Not editable**: select text to highlight it or add a note | Live text at the saved position. **Touch** scrolls the card at this width. A **pointer** still pans until the card is focused (§6.1) |

- **Breakpoints scale with text size** (Dynamic Type; font scale on Android). At 17 pt they're 48 / 160 / 320. At 2× text they're 96 / 320 / 640, so each level always fits its content at the reader's size. (Opinion in frame 01; adopted.)
- **The glyph carries the meaning**, never colour alone (WCAG 1.4.1). SF Symbols-style glyphs in the iOS look, Material Symbols-style in Material. That and the edit affordance (Liquid Glass button, 44 pt; filled tonal icon button, 48 dp) are the only differences between the looks.
- **Text size:**
  - At 100%, a card's text is the reader's text size. Above 100%, it scales up with zoom.
  - Below 100%, **titles never shrink**: they stay at reader size.
  - **Body text scales with zoom down to an 11 pt floor** (Apple's Caption 2, the smallest default text style). Under Dynamic Type accessibility sizes, the floor scales up with the user's setting.
  - Where body or snippet text would go under the floor, the card **drops to the next level down** instead of drawing smaller text. An L3 title-plus-lines snippet falls back to title only (L2).
  - Example (frame 01, panel 6): at 60% zoom, 17 pt body text would be 10.2 pt, under 11 pt, so the card shows its title only, at 17 pt.
  - Focusing a reader card still zooms to reading size (§6.1).
- The ~3 lines at L3 and the live text at L4 start at the **same anchor**: the top line when the card last lost focus.

## 6. Reader cards

A reader card is a live publication window on the canvas. You read in place, and it remembers where you were.

### 6.1 Focus — [frame 05](studyspace-frames/05-reader-focus.png)

Each gesture follows the input that **started it** (Wren, Oct 31 2026, 2:39 PM ET). Tap to focus everywhere is superseded (decision 26).

| Input | Rule |
| --- | --- |
| Touch (iPad, Android tablets, unfolded foldables) | A card **at least 320 pt wide on screen** scrolls directly. A smaller card pans the canvas, and tapping it zooms to it |
| Pointer (Mac, and iPad with a trackpad or mouse, judged per gesture by its input source) | **Tap or click to focus**, so a pointer resting on a card never grabs two-finger scrolling |
| Keyboard, VoiceOver, TalkBack, Switch Control | Tap or activate to focus |
| Phones | A tap opens the full-screen reader (§8) |
| Every input | The gesture keeps the target it started on. **Space+drag and pinch always move the canvas**. Trackpad momentum belongs to the gesture that started it |

Rejected: hand-off at the scroll ends (momentum causes accidental pans), and one-finger card scroll (option C, the cooperative model like Google Maps' `gestureHandling: "cooperative"`, which breaks two-finger pan on the Mac). Pebble's middle option is **adopted for touch**. Plain tap to focus everywhere stays rejected.

| Input | Enter focus | Leave focus |
| --- | --- | --- |
| Touch | A card ≥ 320 pt wide on screen scrolls without a focus tap. Tapping a smaller card zooms to it. Pencil tap (ink tool off) focuses | Tap outside the card, or Done |
| Pointer | Click the card | Click outside, or Done |
| Keyboard, VoiceOver, TalkBack, Switch Control | Tap or activate (Return on the keyboard-focused card; Read for VoiceOver and TalkBack) | Esc, or Done |
| Never | Hover never focuses (it only shows the grey lift, frame 03). **Space+drag and pinch always move the canvas** | — |

| State | Behaviour |
| --- | --- |
| Unfocused | Thin 1 pt border (line grey). Text is live but static and reflows at the reader's text size. Pointer scroll (two-finger trackpad and the wheel) **pans the canvas**. Touch scrolls the card only when it is at least 320 pt wide on screen; a smaller card pans the canvas |
| Focused | **3 pt accent outline** (#9B3F2A light, #E59A7C dark) plus a **Done** button (iOS look: Liquid Glass button, 44 × 44 pt hit; Material: tonal text button, 48 dp hit). Not colour alone. Pointer, keyboard and assistive tech: the card takes scroll once focused. **Space+drag and pinch still move the canvas**. VoiceOver and TalkBack value: "focused" |
| Scroll ends | Text rubber-bands at the first and last verse (iOS bounce; Android 12+ stretch overscroll). **No hand-off** to the canvas when the text ends (like CSS `overscroll-behavior: contain`) |
| Paging | Space and ⇧Space page within the focused card |
| Focus zoom | If the canvas is **below 100%**, focusing zooms to 100% (card text = reader size) and centres the card, with `.smooth`. If it's **already at 100% or more**, it only pans the card into view. A card **taller than the view** aligns its top just under the toolbar. Reduce Motion: cross-fade |
| Leaving | Returns to the pre-focus view **only if the canvas didn't move while focused**. "Didn't move" means no canvas pan or zoom; scrolling the text doesn't count, and is saved as the card's new position. If you panned or zoomed, leaving keeps the current view |
| Wiring | Pointer and assistive focus: SwiftUI `.scrollDisabled(!isFocused)` plus `UIGestureRecognizerRepresentable` (iOS 18). UIKit: gesture delegate priority. Compose: `NestedScrollConnection`. React Native: `blocksExternalGesture`. Touch: a card at least 320 pt wide on screen scrolls without that gate |

`preFocusViewport` and `moved_while_focused` are session-only app state. Focus is never saved.

### 6.2 Opening a reader card

| From | Where it lands | State |
| --- | --- | --- |
| Omnisearch | The Omnisearch landing rules (§7) | **Unfocused**, default size, scrolled to the result |
| A note link | §6.5 | **Focused**, scrolled to the verse, with a brief highlight |
| Dragging a publication or a verse selection from the reader or the sidebar | At the drop point, anchored at the verse | Unfocused. Uses system drag and drop |
| ⌘-click on a card (Mac) | Opens it in the main reader or a new window instead | — |

**Default size:** about 60 characters × 20 lines at the user's text size (about 634 × 568 pt at 17 pt). Opinion; adopted.

### 6.3 Sizes and levels — [frame 06](studyspace-frames/06-reader-zoom-levels.png)

| Rule | Value |
| --- | --- |
| Minimum live size | **Width** = 32 characters at the current text size + horizontal padding. **Height** = header + 5 × line height (line height = 1.5 × text size) + padding. Example at 17 pt: about **350 × 186 pt**. It grows with Dynamic Type. Resizing stops there |
| Why it agrees with §5 | At 100%, the minimum card is just above the 320 pt L4 breakpoint, so a minimum-size reader card still shows live text. Since both scale with text size, that holds at every size |
| Resize | Live reflow, with the **first visible line pinned**. Reduce Motion: instant |
| Looks | Only the publication glyph and the corner radius differ: 12 pt (iOS look) vs 14 dp (Material). Radius is opinion |

### 6.4 The study pane in a card — [frame 07](studyspace-frames/07-reader-study-pane.png)

| Mode | Behaviour |
| --- | --- |
| Inline (default) | Selecting a verse in a focused card opens the [inline study pane](inline-study-pane.md) **inside the card, directly below the verse**. The verse holds still: its top edge stays where it was on screen, only the text below moves down, and the card's height doesn't change (the card's text scrolls). Contents as in the inline spec: tabs with no content hidden, My notes pinned at the bottom |
| Docked | ⌘\ (Ctrl+\ on Android), or drag the pane's header to the card's trailing edge. The pane becomes a **separate attached card** on the trailing edge: 0 pt gap, top-aligned, same height. It moves and zooms with the reader card. Minimum width 320 pt, as in the side split |
| Docking allowed | **Always**, on the canvas. The inline spec's 1000 pt side-split minimum doesn't apply, because docking adds a card instead of splitting the column |
| Undocking | Docked pane follows the selected verse unless pinned. ⌘\ or dragging its header back returns it inline. **No tear-off in v1**: an attached pane can't become a free card |
| Looks | iOS look: Liquid Glass segmented control, 44 pt targets, glass on the controls only. Material: M3 primary tabs, 48 dp targets, predictive back closes the pane |
| Motion | Docking uses the spec's matched-geometry move of the header. Reduce Motion: cross-fade |
| Phones | No reader card on the canvas: the full-screen reader opens and the normal compact pane applies (inline, starts at 40%, drags to 25–85%). **No sheets** on iPad or Mac |

### 6.5 Note links: open or reuse — [frame 08](studyspace-frames/08-note-link-open-vs-reuse.png)

Links in notes are underlined. (Underline means link. A Pencil underline is a thick coloured stroke, distinct from that; §11.) Tapping a scripture link in a note on the canvas:

| Case | Result |
| --- | --- |
| (a) No card for that publication is in view | A **new reader card** opens **24 pt right of the note**, top-aligned, **focused**, scrolled to the verse. It opens at the current zoom; the focus zoom (§6.1) applies if the canvas is below 100%. If the spot to the right is taken, it falls back to the nearest empty spot (§7) |
| (b) A card for the publication is **at least partly in view** | That card scrolls to the verse and gets the highlight. No duplicate card. **If several are in view, the most recently used one** (`last_used_at`, §6.6) is reused (Wren approved; frame 08 was re-rendered with this rule). If the verse would land off screen, the view pans the minimum to show it (frame 04 rule) |
| (c) The only card for it is **off screen** | A new card opens as in (a). The off-screen card stays where it is |
| Verse highlight | Brief accent fill behind the verse, fading after about 1.5 s (opinion). Reduce Motion: static, removed without a fade. Announce "Romans 8, verse 28" |
| Force a new card | ⌥-click (Alt-click on Android with a mouse), or long press → **Open in New Card**. Always opens a new card by rule (a), even when one is in view |
| Go to Existing Card | In the link's context menu only when a card for that publication exists on this workspace but is off screen. Pans to it (`.smooth`; a jump with Reduce Motion) and scrolls it to the verse |
| Menus | iOS look: system context menu (Liquid Glass), 44 pt rows: Open, Open in New Card (⌥-click), Go to Existing Card, Copy Link. Material: M3 menu, sentence case, the same items |

### 6.6 Position memory

| Field | Rule |
| --- | --- |
| `anchor` + `char_offset` | The core `Location` of the block at the top visible line, plus a UTF-16 offset into the core's plain text for that block. Never a page or pixel. Saved when a scroll **settles**, not per frame. Restored by reflowing to the anchor, so it survives text-size changes and resizes |
| Missing anchor | After a publication update: clamp the offset to the block's length, and if the block is gone, use the nearest earlier block |
| **`last_used_at`** (decided, Wren) | Persisted timestamp, the tie-break in §6.5(b). A column on the canvas item (`CanvasItem.last_used_at`), set when the card is added, bumped by `set_reader_state` (so when the **text scroll settles**) and by a new `touch_item(item_id)` when the card is **focused** (including opening the full-screen reader from it on a phone) or **reused by a note link**. Approved and in Echo's core PR |
| Separate state | Two cards of the same publication each keep their own anchor and `last_used_at` |
| Selection and study pane | `selection: Option<LocationSpan>` and `study_pane: Option<{ tab, verse }>`, on Echo's separate row |
| Not saved | Focus, `preFocusViewport`, `moved_while_focused` |

### 6.7 Apple Pencil and stylus

| Where | What Pencil does |
| --- | --- |
| Canvas, ink tool **on** | Inks. Ink lives on a layer above the cards in world coordinates and moves with them (guide §4) |
| Canvas, ink tool **off** | Draws a lasso that selects the cards it **fully encloses** (§7.1). Fingers never ink |
| Unfocused reader card | Pencil tap focuses it |
| **Focused reader card** | **Text annotations only:** highlight, underline or circle, snapped to the text so they reflow with it. No free ink fixed to the card, because it would drift when text rewraps |
| Ink that starts outside a card | Stays canvas ink, even if it crosses a card |
| A margin note | Becomes a small canvas note attached to the verse |
| System settings | `UIPencilInteraction`: double-tap and squeeze follow the user's system settings; honour "Only Draw with Apple Pencil". Hover previews the ink and lifts the card under it. Android: detect the stylus by the touch tool type |

**Annotation storage (row …FCK8U, not v1's model):**
- One record per annotation: the text range, a **style** (`highlight` | `underline` | `circle`) and a **colour** from the six highlight colours. **No name or label field**: highlights are colours only (Owen, Oct 28).
- The range reuses the core's `TextRange` (JW word tokens). The app snaps a stroke to the text, then converts to tokens. Because tokens are words, annotations snap to whole words.
- **`.jwlibrary` export:** JW Library has no underline or circle, so they export as a **plain highlight of the same colour**. Berean-only style data stays in Berean's own tables and round-trips through Berean.
- Until …FCK8U lands, Pencil on a focused card makes highlights only.

## 7. Canvas interactions

### 7.1 Selection — [frame 03](studyspace-frames/03-selection.png)

| | iPhone (iOS look) | Android phone (Material) | Tablet (touch and Pencil) | Mac, or iPad with a pointer |
| --- | --- | --- | --- | --- |
| Enter selecting | **Select / Done** button in the toolbar (Liquid Glass capsule) | **Long press a card**, or overflow → Select. A contextual top app bar replaces the normal one: close ×, "2 selected", actions, overflow | Always available | Always available |
| Pick cards | Tap toggles a card. Checkmark badge (filled = selected, ring = not) plus the accent outline | Same | Tap selects | Click selects. ⇧-click adds or removes |
| Marquee | **None on phones** | None | **Touch and hold on empty canvas** (500 ms), then drag. A one-finger drag on empty canvas still pans | Drag on empty canvas with the arrow cursor. Starts after 4 pt (mouse) or 6 pt (touch) |
| Marquee picks | — | — | Cards it **touches** (opinion, adopted) | Cards it **touches** |
| Pencil lasso | — | — | Ink tool off: picks cards it **fully encloses** (drawn deliberately). Ink tool on: Pencil inks | — |
| Select all / clear | — | — | With a keyboard: ⌘A / Esc | ⌘A / Esc. Ctrl+A on Android |
| Actions | Bottom glass action bar: count, Group, Share, Link, Delete (destructive role). Targets ≥ 44 pt | Top app bar actions. Targets ≥ 48 dp. Back and predictive back exit Select mode | Context menu | Context menu and menu bar |
| Exit | Done | Close × or back | Tap empty canvas | Click empty canvas or Esc |

- **Selected state is never colour alone:** a 2 pt accent outline (offset 3 pt) plus 8 pt handles on tablet and Mac, or the checkmark badge in phone Select mode. VoiceOver and TalkBack read "selected". Increase Contrast: 3 pt outline.
- Handles: 8 pt visible, 44 × 44 pt hit area (iOS) or 48 × 48 dp (Material), centred on the handle.
- **Hover** (pointer or Pencil hover): grey lift + a 1 pt darker outline. Hover never selects or focuses.
- **Keyboard:** Tab and ⇧Tab move through cards in reading order (top to bottom, then left to right), Return opens or focuses, Space with a selection toggles quick look, Esc closes it. The keyboard marquee and Tab path are required (§9).

### 7.2 Omnisearch landing — [frame 04](studyspace-frames/04-omnisearch-landing.png)

| Rule | Value |
| --- | --- |
| Search field | iOS look: Liquid Glass search field floating over the canvas (glass on the control only); ⌘K focuses it. Material: M3 search bar; Ctrl+K |
| (a) A card is being edited or is selected | The new item lands **to its right, top edges aligned, with a 24 pt gap** (Heptabase pattern; gap is opinion). **With several cards selected, it lands right of the last one selected** |
| (b) Nothing is selected | Centred in the view. The view doesn't move |
| Spot taken | Search outward from the target on an **8 pt grid** for the nearest spot with **24 pt clearance** around the item |
| Off screen | The view moves **only if the item would land off screen**. It pans the shortest distance that brings the whole item, plus a **24 pt margin**, into view. `.smooth`; a cross-fade jump with Reduce Motion. **Zoom never changes** |
| Landing highlight | 3 pt accent outline that fades after **about 1.5 s** (opinion). Reduce Motion: static outline removed without a fade |
| Announcement | "Added Romans 8 to Workspace 2" (VoiceOver announcement; TalkBack live region). Focus moves to the new card |
| A reader card from Omnisearch | Lands unfocused, default size, scrolled to the result (§6.2) |

### 7.3 Workspaces

| | Phone | Tablet | Mac |
| --- | --- | --- | --- |
| Switcher | The workspace title is a menu | Collapsible sidebar | Sidebar, and a window per workspace |
| Keyboard | — | ⌘⇧[ and ⌘⇧] for previous and next (⌘1 and ⌘2 stay Write and Read) | Same |
| Opening a workspace | **Reopens the last view; fit-all the first time** (Wren, 2:08 PM). Supersedes guide v3's "opens at fit-all" | Reopens the last view (fit-all the first time) | Same. Each window uses its own scene restoration; the core keeps one last camera per workspace |
| Camera | Saved per workspace when a gesture settles. Clamped to the device's zoom range on restore (§3.1) | Same | Same |
| Switch motion | **150 ms cross-fade**, no slide or zoom, for everyone (it's safe with Reduce Motion). Opens at the workspace's saved camera | Same | Same |
| Announcement | The name plus the card count: "Workspace 2, 14 cards" (VoiceOver announcement; TalkBack live region) | Same | Same |

### 7.4 Links

**Links only in v1** (Wren, 2:02 PM). The global, two-way links are the existing note hyperlinks. Canvas-only connector lines follow on row …FCK6w (the Scrintal split). A card's **Show in reader** opens its source location (MarginNote 4).

## 8. Phone vs tablet vs Mac

| | Phone (< 600 pt/dp) | Tablet (iPad, Android ≥ 600 dp) | Mac (and iPad with keyboard and trackpad) |
| --- | --- | --- | --- |
| Role | View and arrange | The full canvas | The full canvas |
| Pan / zoom | One finger pans; pinch at the focal point; max 400% | Fingers pan and pinch; max 800% | Two-finger scroll pans; pinch or ⌘-scroll at the cursor; Space+drag; max 800% |
| Inertia | iOS 0.998/ms; Material native fling (§3.5) | Same | None added |
| Opening a card | **A tap opens the full-screen reader** (or the note editor). **Back to Studyspace** returns to the exact canvas viewport. No editing at small zoom | Touch: a card at least 320 pt wide on screen scrolls directly; a smaller card pans, and a tap zooms to it. A pointer taps to focus; tap into note text to edit. **Expand**, or a double-tap on the header, opens the card in the existing side split (1/3, 1/2, 2/3) with the canvas still visible | Click focuses, so a resting pointer never grabs two-finger scroll. ⌘-click opens a publication in the main reader or a new window. **Open in New Window** (card menu and File menu; also iPad Stage Manager) shares the card's reading position |
| Moving cards | Long press lifts | Long press, or drag a selected card; second finger constrains | Drag after 4 pt |
| Selection | Select mode (§7.1); no lasso, no marquee | Touch-and-hold marquee; Pencil lasso | Drag marquee; ⇧-click |
| Pencil / stylus | — | Inks only with the ink tool on; text annotations on a focused reader card | — |
| Workspaces | Title menu | Collapsible sidebar | Sidebar + window per workspace |
| Android | Same split by window size class. **Foldables:** unfolded acts like a tablet, folded like a phone. Stylus by touch tool type. Ctrl shortcuts | Same | — |

## 9. Accessibility

| Area | Requirement |
| --- | --- |
| **List view** (required) | Each workspace has a List view in reading order (top to bottom, then left to right), with Move, Open and Show in reader actions. It's the full alternative to the canvas |
| VoiceOver and TalkBack | Cards are elements labelled by type and title ("Note, Hope in Romans 8"; "Romans 8, publication"). Reader cards have a **Read** custom action (it focuses the card). Announce "Reading Romans 8, verse 28" on focus and "Left Romans 8" on exit. Three-finger scroll pages a focused card. Announce snaps, adds ("Added Romans 8 to Workspace 2") and workspace switches ("Workspace 2, 14 cards"). Selected and focused are spoken values. With either on, panning goes through the list view and rotor actions |
| Switch Control | Read and Done are visible buttons, never hidden gestures |
| Keyboard | Tab / ⇧Tab path through cards, Return to open or focus, Esc to leave or clear, Space / ⇧Space to page a focused card, a keyboard marquee, ⌘A, arrows to nudge or pan, zoom keys (§3.2), ⌘⇧[ / ] for workspaces. Shortcuts work only when the canvas has focus and no card is being edited (while editing, Space types) |
| Reduce Motion | Direct manipulation stays 1:1. Pinch settle is a 150 ms ease. Automatic camera moves (fit, focus zoom, Go to Existing Card, Omnisearch pan) cross-fade or jump. Workspace switches are already a 150 ms cross-fade. Highlights are static and removed without a fade |
| Targets | ≥ 44 pt / 48 dp everywhere, including resize handles and Done |
| Dragging alternatives | Size menu, Move actions and the List view (WCAG 2.5.7) |
| Legibility | Titles never shrink; body text never goes below 11 pt (scaled up at accessibility sizes). Where it would, the card drops a level (§5). Breakpoints scale with text size |
| Colour | Focus, selection and type never rely on colour alone (outline weight, badge, glyph). Highlights are spoken by colour name, as in the reader |
| Timing | All physics are time-based, so frame rate doesn't change the feel |

## 10. Open items

| # | Item | For | Board row |
| --- | --- | --- | --- |
| 1 | **Android haptic** constant for snapping, and whether long press on Android uses 500 ms or the system 400 ms for custom recognizers | Otter | Expo 7 |
| 2 | **Studyspace in backups:** whether `.jwlibrary` export carries workspaces and cameras. Parked with the backup work. Lumen recommends yes; JW Library ignores unknown tables | Owen (when backups resume) | …FCPpc |
| 3 | **Pinned card layouts** (Compact / Snippet / Full) | Lumen, after v1 | `PVTI_lAHOALCvmc4BpDa0zhFCM8I` |
| 4 | **Pencil annotation storage** (§6.7) and `selection` / `study_pane` | Echo | …FCK8U; Echo's own row |
| 5 | **Measure on device:** the 0.998 `rawValue` on current iOS, web and Windows trackpad momentum, and the rubber-band 0.55 constant | Kiwi, Otter | Expo 7 |
| 6 | **Unverified app facts** in §1: Scrintal, MarginNote 4 and Allume numbers, Miro's content-dependent minimum, and Figma's tap-vs-hold Space | Iris / Magpie | — |

## 11. Decisions

| # | Decision | Who, when |
| --- | --- | --- |
| 1 | Max zoom 800% on tablet and Mac, 400% on phone. The core doesn't clamp; apps do | Wren, Oct 31 2:02 PM (per-device split from Hinge, approved by Wren) |
| 2 | Links only in v1; connectors next | Wren, 2:02 PM (row …FCK6w) |
| 3 | iPad Pencil inks only with the ink tool on; otherwise it lassos | Wren, 2:02 PM |
| 4 | Pinned card layouts after v1 | Wren, 2:02 PM (row …FCM8I) |
| 5 | Reader cards: tap to focus on tablet and Mac; on phones tap opens the full-screen reader | Wren, 2:03 PM. **Superseded** by 29 |
| 6 | A note link reuses a reader card that's at least partly in view, the **most recently used** if several; otherwise a new card beside the note, with Go to Existing Card in the menu. Open in New Card forces a new one | Wren, 2:03 PM; combined with Iris's in-view rule and approved 2:04 PM |
| 7 | Pencil on a focused reader card makes text annotations only. Style + colour, no names; underline and circle export to `.jwlibrary` as plain highlights of the same colour. Storage on Echo's Pencil row, not v1. Ink outside a card stays canvas ink; a margin note becomes a canvas note attached to the verse | Wren, 2:04 PM |
| 8 | Phones reopen the last view, with fit-all the first time | Wren, 2:08 PM |
| 9 | Panning rubber-bands one screen past the content | Wren, 2:08 PM |
| 10 | Zoom-out minimum 10%; only fit-all may go to 2% | Wren, 2:08 PM |
| 11 | Studyspace in backups: parked with the backup work | Wren, 2:08 PM (row …FCPpc) |
| 12 | Camera = centre + scale per workspace; reader anchor = `Location` + UTF-16 `char_offset`; items at the top-left, integer z, no rotation | Echo adopted (Lumen's proposal over Iris's centre origin and height fraction) |
| 13 | `last_used_at` per reader card, as a column on the canvas item, bumped on add, `set_reader_state` and `touch_item` | Wren (approved; in Echo's core PR) |
| 14 | Pinch settle B: soft detents at 100% and fit-all only; steps for ⌘+ / ⌘− only | Kerning & Co. (Iris); adopted by Lumen |
| 15 | Rubber band in log zoom, d = 0.5 octave; Reduce Motion settle 150 ms | Kerning & Co. (opinion); adopted by Lumen |
| 16 | Marquee picks what it touches; Pencil lasso picks what it encloses; Material phone Select mode by long press or overflow | Kerning & Co. (opinion); adopted by Lumen |
| 17 | Space: tap = quick look, hold = pan | Iris, 2:01 PM |
| 18 | Inertia: 0.998/ms in SwiftUI and the iOS look, applied as a formula in Expo (not `withDecay` defaults); native fling (~0.985) in the Material look | **Lumen** (with Pebble's correction) |
| 19 | Docked study pane always allowed on the canvas; no tear-off in v1 | Kerning & Co. (opinion); adopted by Lumen |
| 20 | Body text scales with zoom to an 11 pt floor (scaled at accessibility sizes); titles never shrink; below the floor the card drops a level | Iris, Oct 31 2:24 PM |
| 21 | Double tap / double click on empty canvas only, toggling 100% at the point ↔ fit-all on every device; body taps stay instant. Replaces the phone-only card ↔ fit-all toggle and "next zoom step". Exception: a tablet header double-tap opens the side split (§8) and doesn't delay body taps | Iris, 2:24 PM |
| 22 | Minimum reader card size as a formula (32 characters + padding × header + 5 lines at 1.5× + padding) | Iris, 2:24 PM |
| 23 | Workspace switch: 150 ms cross-fade for everyone, at the saved camera; announce name and card count | Iris, 2:24 PM |
| 24 | Pencil underline annotations draw as a thick coloured stroke, clearly distinct from a link underline | Wren |
| 25 | A gesture picks its target when it starts and keeps it until it ends. A canvas pan or fling stays a canvas pan if a card slides under the finger or pointer; trackpad momentum is part of that gesture | Kerning & Co. (Pebble and Hinge) |
| 26 | Tap to focus everywhere. While a card is focused, Space+drag still pans the canvas and pinch still zooms it. On phones a tap skips focus and opens the full-screen reader | Wren (Hinge agrees). **Superseded** by 29 (Oct 31 2:39 PM ET). Space+drag, pinch and the phone tap still hold, in 29 |
| 27 | Pebble's middle option (cards at least 320 pt wide on screen scroll directly; smaller cards pan; tap to focus kept for keyboard, VoiceOver and Switch Control): **adopted for touch**. Plain tap to focus everywhere stays rejected. One-finger card scroll (option C) stays rejected | Kerning & Co. (Pebble and Hinge); touch adopted by Wren, Oct 31 2:39 PM ET |
| 28 | Phone: Back to Studyspace returns to the exact canvas viewport. Tablet: Expand, or a header double-tap, opens the existing side split (1/3, 1/2, 2/3) with the canvas still visible. Mac and iPad Stage Manager: Open in New Window, in the card menu and the File menu, shares the card's reading position. Foldables: unfolded like a tablet, folded like a phone. VoiceOver or TalkBack: pan through the list view and rotor actions | Kerning & Co. (Pebble and Hinge) |
| 29 | Reader-card scroll follows the input that started the gesture. Touch (iPad, Android tablets, unfolded foldables): a card at least 320 pt wide on screen scrolls directly; a smaller card pans the canvas, and tapping it zooms to it. Pointer (Mac, and iPad with a trackpad or mouse, per gesture by input source): tap or click to focus, so a resting pointer never grabs two-finger scrolling. Keyboard, VoiceOver, TalkBack and Switch Control: tap or activate to focus. Phones: a tap opens the full-screen reader. Every input: the gesture keeps its starting target; Space+drag and pinch always move the canvas; trackpad momentum belongs to the gesture that started it | Wren, Oct 31 2:39 PM ET |

## 12. References

- Apple HIG: [Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures), [Apple Pencil and Scribble](https://developer.apple.com/design/human-interface-guidelines/apple-pencil-and-scribble), [Pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices), [Keyboards](https://developer.apple.com/design/human-interface-guidelines/keyboards), [Motion](https://developer.apple.com/design/human-interface-guidelines/motion), [Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics), [Drag and drop](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- Apple: [WWDC18 803 Designing Fluid Interfaces](https://developer.apple.com/videos/play/wwdc2018/803/) (projection), [WWDC23 10158 Animate with springs](https://developer.apple.com/videos/play/wwdc2023/10158/), [UIPencilInteraction](https://developer.apple.com/documentation/uikit/uipencilinteraction), [Optimizing for ProMotion displays](https://developer.apple.com/documentation/quartzcore/optimizing-iphone-and-ipad-apps-to-support-promotion-displays); UIScrollView `bouncesZoom` / `decelerationRate`, NSScrollView magnification, NSEvent `momentumPhase`; SwiftUI `sensoryFeedback`
- Material and Android: [M3 gestures](https://m3.material.io/foundations/interaction/gestures), [M3 menus](https://m3.material.io/components/menus/overview), [M3 top app bar](https://m3.material.io/components/top-app-bar/overview), [Window size classes](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes), [Stylus input](https://developer.android.com/develop/ui/compose/touch-input/stylus-input); AOSP `ViewConfiguration`, `OverScroller`
- Other references: Figma, [Use Figma products with a keyboard](https://help.figma.com/hc/en-us/articles/360040328653-Use-Figma-products-with-a-keyboard); Google Maps JavaScript API, [gesture handling](https://developers.google.com/maps/documentation/javascript/interaction#gestureHandling); tldraw [`options.ts`](https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/options.ts)
- WCAG 2.2: [2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), 1.4.1 Use of Color
- Code: tldraw `constants.ts`, `options.ts`, `Editor.ts` (main 9e700c6, Oct 30 2026); Excalidraw (8bcdca4, Oct 31 2026); Reanimated `decay/rigidDecay.ts`; React Native `ScrollView` docs (`decelerationRate`)
- Apps: Freeform (Apple Support: align items on Mac, position items on iPad; 9to5Mac hands-on); Heptabase (changelog mobile v1.39.0, newsletter 2024-08-02, keyboard shortcuts, wiki PDF annotation); Allume, formerly Muse ([allume.com](https://allume.com/) v4.0 rename memo and FAQ, 2026; Ink & Switch; Muse email 011; "Muse for Mac" memo 2022-03); Miro (Help "Precise resizing", Web SDK viewport); Scrintal (GitBook, links and connectors); MarginNote 4 manual; LiquidText (Interface Lineage)
- Berean: [berean-design-guide.md](berean-design-guide.md) §4 and §7.3, [inline-study-pane.md](inline-study-pane.md), [markdown-notes.md](markdown-notes.md) Q7 (UTF-16 spans), [document-blocks.md](document-blocks.md) §5, [userdata.md](userdata.md)
