// The workspace open last, for this session only: the core has no place to
// keep it across launches yet. Kept free of React Native.

let last: bigint | undefined;

export function lastWorkspace(): bigint | undefined {
  return last;
}

export function rememberWorkspace(id: bigint | undefined) {
  last = id;
}
