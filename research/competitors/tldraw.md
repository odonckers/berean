# tldraw (SDK and whiteboard)

- **Date checked:** 2026-10-26
- **Sources:**
  - Snapping docs: https://tldraw.dev/sdk-features/snapping
  - Pricing: https://tldraw.dev/pricing
  - Whiteboard: https://www.tldraw.com/

## Who it's for
Developers embedding an infinite canvas in React apps. tldraw.com is the free whiteboard built on it. Logseq's whiteboards were a fork of it ([Logseq docs](https://raw.githubusercontent.com/logseq/docs/master/pages/Whiteboard.md)).

## Pricing (https://tldraw.dev/pricing)
SDK commercial license with a 100-day trial, and a free hobby license.

## Snapping (the most precise public spec we found) ([snapping docs](https://tldraw.dev/sdk-features/snapping))
- **Bounds snapping** "aligns bounding box edges and centers". By default, shapes snap to their bounding-box corners and center. Gap snapping also exists.
- **Handle snapping** gives "precise point connections" for arrow and line handles.
- **Threshold.** "options.snapThreshold screen pixels (default 8), scaled by the current zoom level."
- **Targets.** Snapping skips selected shapes and shapes outside the viewport. Frames are snap targets. Groups snap to their children.
- **Display.** Snap indicators are drawn as snap lines.
- **Modifiers.** "Snapping is off by default. Users hold Ctrl (Cmd on Mac) while translating, resizing, or dragging a handle to snap. Turning on snap mode inverts this: snapping is always on and holding Ctrl disables it." "Grid snapping is a separate system."
- **Arrows.** Handle snapping "connects handles to outlines and key points, like arrow tips to shape edges."
- **Resize snapping.** Corner handles snap both axes; edge handles snap only the perpendicular axis.

## Citations, broken links
Not applicable (SDK).

## Notes ↔ drawings
The draw tool sits on the same canvas as shapes and arrows. Berean could adopt this model if it embeds a canvas library.

## Parallel texts
No evidence found.

## Worth screenshotting
1. https://tldraw.dev/sdk-features/snapping
2. https://www.tldraw.com/

## Screenshots (captured 2026-10-26)
- [`screenshots/tldraw-snapping.png`](screenshots/tldraw-snapping.png): SDK snapping docs. Source: https://tldraw.dev/sdk-features/snapping
