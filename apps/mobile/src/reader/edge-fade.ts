// A scroll-edge fade's background: the surface color, solid for `solid` dp
// from the top (the status bar's inset, so its clock and icons stay on a
// clear background), then fading to the same color at zero alpha at the
// bottom. Fading to the same color, not 'transparent' (a transparent
// black), keeps it from passing through grey. The color is a 6-digit hex
// token, as the theme's colors are.
export function edgeFade(color: string, solid: number): string {
  return `linear-gradient(to bottom, ${color} 0px, ${color} ${solid}px, ${color}00 100%)`;
}
