import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { getStateFromPath } from 'expo-router/build/fork/getStateFromPath';
import { getMockConfig } from 'expo-router/build/testing-library/mock-config';

// The real route tree, resolved by expo-router's own path parser.
const appDir = fileURLToPath(new URL('../app', import.meta.url));
const files = readdirSync(appDir, { recursive: true, encoding: 'utf8' }).filter((f) =>
  /\.tsx?$/.test(f),
);
const config = getMockConfig(files);

type State = { index?: number; routes: { name: string; state?: State }[] };

function routeNames(path: string): string[] {
  const names: string[] = [];
  let state = getStateFromPath(path, config) as State | undefined;
  while (state) {
    const route = state.routes[state.index ?? state.routes.length - 1];
    names.push(route.name);
    state = route.state;
  }
  return names;
}

describe('search routes', () => {
  test('the M3 search bar opens the root search view', () => {
    assert.deepEqual(routeNames('/search-view'), ['__root', 'search-view']);
  });

  // The reason the view is not at /search.
  test('/search is the iOS look tab', () => {
    assert.deepEqual(routeNames('/search'), ['__root', '(tabs)', 'search', 'index']);
  });
});
