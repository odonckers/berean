// A scroll-edge fade's background: the surface color at the top, fading to
// the same color at zero alpha at the bottom, so it never passes through
// grey (as fading to 'transparent', a transparent black, can). The color is
// a 6-digit hex token, as the theme's colors are.
export function edgeFade(color: string): string {
  return `linear-gradient(to bottom, ${color}, ${color}00)`;
}
