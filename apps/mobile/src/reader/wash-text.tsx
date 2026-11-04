import { type ReactNode, useEffect, useState } from 'react';
import { Text } from 'react-native';

import { washFill, washStrength } from '@/reader/landing-wash';

/** The fade re-draws the span in this many steps at most, not every frame. */
const FADE_STEPS = 12;

/**
 * A landed verse's text (or the space between its parts) under the landing
 * wash (bookmarks spec §3.3): `base` (the page, or its highlight) with the
 * accent mixed in. It holds, then fades out and reports `onFaded`; a static
 * wash (Reduce Motion) holds until the reader clears it. Its own component,
 * so the fade re-renders this span alone, not the chapter.
 */
export function WashText({
  base,
  accent,
  fades,
  onFaded,
  onLongPress,
  children,
}: {
  base: string;
  accent: string;
  fades: boolean;
  onFaded: () => void;
  onLongPress?: () => void;
  children: ReactNode;
}) {
  const [strength, setStrength] = useState(1);
  useEffect(() => {
    if (!fades) return;
    const start = Date.now();
    let frame = requestAnimationFrame(function step() {
      const next = Math.ceil(washStrength(Date.now() - start, true) * FADE_STEPS) / FADE_STEPS;
      setStrength(next);
      if (next <= 0) {
        onFaded();
        return;
      }
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
    // The clock starts once per wash; a new arrival mounts a new span.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fades]);
  return (
    <Text
      suppressHighlighting
      onLongPress={onLongPress}
      style={{ backgroundColor: washFill(base, accent, fades ? strength : 1) }}
    >
      {children}
    </Text>
  );
}
