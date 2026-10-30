// Decides whether a result row's press is a tap that should open it, kept
// free of React Native so Node can test it. One guard is shared by a list's
// rows: a touch press opens only if the list didn't scroll since it began and
// the finger ended within TOUCH_SLOP of where it went down. A press with no
// pressIn before it always opens: TalkBack double-tap (accessibility
// activation) and hardware-keyboard activation call onPress without
// onPressIn, and with pageX/pageY of 0.

/** How far (dp, the pageX/pageY units) a finger may drift and still tap. */
export const TOUCH_SLOP = 10;

export type PressGuard = {
  /** A row's press began at (x, y): forget any earlier scrolling. */
  pressIn(x: number, y: number): void;
  /** The list scrolled (a drag or momentum began). */
  scrolled(): void;
  /**
   * Whether the press released at (x, y) should open the row. With no press
   * in progress (an accessibility or keyboard activation) it opens; otherwise
   * it opens only if the list didn't scroll and the finger stayed within
   * TOUCH_SLOP. Either way the press ends here, so a later activation isn't
   * judged against a stale touch.
   */
  shouldOpen(x: number, y: number): boolean;
  /**
   * The touch ended without reaching shouldOpen (cancelled by the list, or
   * released off the row): forget the press.
   */
  end(): void;
};

export function createPressGuard(): PressGuard {
  let start: { x: number; y: number } | undefined;
  let moved = false;
  return {
    pressIn(x, y) {
      start = { x, y };
      moved = false;
    },
    scrolled() {
      moved = true;
    },
    shouldOpen(x, y) {
      const open =
        start === undefined ||
        (!moved && Math.hypot(x - start.x, y - start.y) <= TOUCH_SLOP);
      start = undefined;
      moved = false;
      return open;
    },
    end() {
      start = undefined;
      moved = false;
    },
  };
}
