import {
  Core,
  type CatalogLike,
  type CoreLike,
  type LibraryLike,
  type ReaderLike,
  type UserDataLike,
} from 'berean-ffi-rn';
import { Paths } from 'expo-file-system';

import { fileUriToPath } from './paths';

let core: CoreLike | undefined;

/** The core's cache dir, as a plain path. */
export function cacheDir(): string {
  return fileUriToPath(Paths.cache.uri);
}

/**
 * The app's one Core, opened on first use. Opening errors propagate so
 * screens can show them; the next call tries again.
 */
export function getCore(): CoreLike {
  const opened = core ?? Core.open(fileUriToPath(Paths.document.uri), cacheDir());
  core = opened;
  return opened;
}

export function library(): LibraryLike {
  return getCore().library();
}

export function catalog(): CatalogLike {
  return getCore().catalog();
}

export function reader(): ReaderLike {
  return getCore().reader();
}

export function userdata(): UserDataLike {
  return getCore().userdata();
}
