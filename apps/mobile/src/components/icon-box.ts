// The box for a symbol drawn at `size` under the system font scale. Pure, so
// the Node tests can import it without React Native.
export function iconBox(size: number, fontScale: number): { width: number; height: number } {
  const side = size * fontScale;
  return { width: side, height: side };
}
