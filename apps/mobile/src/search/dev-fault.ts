// Dev-only. Set from the dev menu to show the search error state, which the
// core rarely produces. Imported solely from inside `if (__DEV__)`, so it never
// reaches a release bundle.
let failing = false;

export function simulatingCoreFailure(): boolean {
  return failing;
}

export function setSimulatingCoreFailure(on: boolean) {
  failing = on;
}
