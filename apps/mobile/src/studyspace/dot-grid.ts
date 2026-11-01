// The Studyspace dot grid as a native style background: one radial-gradient
// dot centred in each spacing cell, repeated. Sizes are dp (CSS px in RN).
// Kept free of React Native.

export type DotGridBackground = {
  backgroundImage: string;
  backgroundSize: string;
  backgroundRepeat: 'repeat';
  backgroundPosition: string;
};

// The dot's edge is antialiased over half a dp past its radius.
const EDGE = 0.5;

export function dotGridBackground(color: string, spacing: number, dotDiameter: number): DotGridBackground {
  const r = dotDiameter / 2;
  return {
    backgroundImage: `radial-gradient(circle at center, ${color} ${r}px, transparent ${r + EDGE}px)`,
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundRepeat: 'repeat',
    backgroundPosition: '0px 0px',
  };
}
