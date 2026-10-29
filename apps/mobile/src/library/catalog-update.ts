// The catalog update, kept outside React so progress survives navigating
// away. JS does only the transport: the core builds the manifest request,
// decides whether there is an update, and verifies and installs the file.
import { CancelToken, type CatalogUpdate, type ProgressSink } from 'berean-ffi-rn';
import { File } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

import { catalog } from '@/ffi/core';
import { fileUriToPath } from '@/ffi/paths';
import {
  deleteQuietly,
  downloadTarget,
  failure,
  fetchOk,
  isCancellation,
  THROTTLE_MS,
} from '@/library/installs';

export type CatalogUpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'upToDate' }
  | { state: 'available'; update: CatalogUpdate }
  /** `totalBytes` is the server's Content-Length, or <= 0 when unknown. */
  | { state: 'downloading'; update: CatalogUpdate; bytesWritten: number; totalBytes: number }
  | { state: 'installing'; update: CatalogUpdate; done: number; total: number }
  | ({ state: 'failed'; message: string; retryable: boolean } & (
      | { step: 'check' }
      | { step: 'download'; update: CatalogUpdate }
    ));

export type CatalogUpdateSnapshot = {
  status: CatalogUpdateState;
  /** Bumped after every successful update so screens can reload. */
  catalogVersion: number;
};

type Controls = { abort: AbortController; cancel: CancelToken; cancelled: boolean };

/** Announce download progress at most this often when the size is unknown. */
const ANNOUNCE_BYTES = 10_000_000;

const listeners = new Set<() => void>();
let status: CatalogUpdateState = { state: 'idle' };
let snapshot: CatalogUpdateSnapshot = { status, catalogVersion: 0 };
let current: Controls | undefined;
/** The last progress step announced, e.g. "installing:4". */
let announced = '';
let lastEmit = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function emit() {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  lastEmit = Date.now();
  snapshot = { ...snapshot, status };
  listeners.forEach((listener) => listener());
}

/** Emits at most every THROTTLE_MS; for progress, which can fire often. */
function emitThrottled() {
  if (timer !== undefined) {
    return;
  }
  const wait = Math.max(0, THROTTLE_MS - (Date.now() - lastEmit));
  timer = setTimeout(emit, wait);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCatalogUpdate(): CatalogUpdateSnapshot {
  return snapshot;
}

export function useCatalogUpdate(): CatalogUpdateSnapshot {
  return useSyncExternalStore(subscribe, getCatalogUpdate);
}

function set(next: CatalogUpdateState) {
  status = next;
  emit();
}

function announce(message: string) {
  AccessibilityInfo.announceForAccessibility(message);
}

function announceProgress(next: CatalogUpdateState) {
  let mark: string;
  let message: string;
  if (next.state === 'downloading') {
    if (next.totalBytes > 0) {
      const step = Math.floor((next.bytesWritten / next.totalBytes) * 10);
      mark = `downloading:${step}%`;
      message = `Downloading catalog, ${step * 10} percent.`;
    } else {
      const step = Math.floor(next.bytesWritten / ANNOUNCE_BYTES);
      mark = `downloading:${step}MB`;
      message = `Downloading catalog, ${step * 10} megabytes.`;
    }
  } else if (next.state === 'installing') {
    const step = next.total > 0 ? Math.floor((next.done / next.total) * 10) : 0;
    mark = `installing:${step}`;
    message = `Installing catalog, ${step * 10} percent.`;
  } else {
    return;
  }
  if (mark !== announced) {
    announced = mark;
    announce(message);
  }
}

/** Records progress, unless `ctl`'s run has ended (a late callback). */
function progress(ctl: Controls, next: CatalogUpdateState) {
  if (current !== ctl) {
    return;
  }
  status = next;
  announceProgress(next);
  emitThrottled();
}

function begin(): Controls {
  const ctl: Controls = { abort: new AbortController(), cancel: new CancelToken(), cancelled: false };
  current = ctl;
  announced = '';
  return ctl;
}

function busy(): boolean {
  return status.state === 'checking' || status.state === 'downloading' || status.state === 'installing';
}

/** Asks the server whether there is a newer catalog; a no-op while busy. */
export function checkForUpdate() {
  if (busy()) {
    return;
  }
  const ctl = begin();
  set({ state: 'checking' });
  fetchOk(catalog().manifestRequest().url, ctl.abort.signal)
    .then(async (res) => catalog().planUpdate(await res.arrayBuffer()))
    .then(
      (update) => {
        if (current !== ctl) {
          return;
        }
        current = undefined;
        if (update === undefined) {
          announce('The catalog is up to date.');
          set({ state: 'upToDate' });
        } else {
          announce('A catalog update is available.');
          set({ state: 'available', update });
        }
      },
      (e: unknown) => {
        if (current !== ctl) {
          return;
        }
        current = undefined;
        if (ctl.cancelled || isCancellation(e)) {
          set({ state: 'idle' });
          return;
        }
        const { message, retryable } = failure(e);
        announce(message);
        set({ state: 'failed', step: 'check', message, retryable });
      },
    );
}

/** Resolves true once installed, false if cancelled between steps. */
async function run(update: CatalogUpdate, ctl: Controls): Promise<boolean> {
  const target = downloadTarget('catalog.db.gz');
  try {
    const file = await File.downloadFileAsync(update.url, target, {
      idempotent: true,
      signal: ctl.abort.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        progress(ctl, { state: 'downloading', update, bytesWritten, totalBytes });
      },
    });
    if (ctl.cancelled) {
      return false;
    }
    progress(ctl, { state: 'installing', update, done: 0, total: 0 });
    const sink: ProgressSink = {
      onProgress(done, total) {
        progress(ctl, { state: 'installing', update, done: Number(done), total: Number(total) });
      },
    };
    await catalog().installUpdate(update, fileUriToPath(file.uri), sink, ctl.cancel);
    return true;
  } finally {
    deleteQuietly(target);
  }
}

/** Downloads and installs the offered update; a no-op if there is none. */
export function downloadUpdate() {
  const offer = status;
  if (offer.state !== 'available' && !(offer.state === 'failed' && offer.step === 'download')) {
    return;
  }
  const { update } = offer;
  const ctl = begin();
  set({ state: 'downloading', update, bytesWritten: 0, totalBytes: 0 });

  run(update, ctl).then(
    (installed) => {
      if (current !== ctl) {
        return;
      }
      current = undefined;
      if (!installed) {
        set({ state: 'available', update });
        return;
      }
      // Even if Cancel came too late to stop it, the update did finish.
      announce('Catalog updated.');
      status = { state: 'upToDate' };
      snapshot = { ...snapshot, catalogVersion: snapshot.catalogVersion + 1 };
      emit();
    },
    (e: unknown) => {
      if (current !== ctl) {
        return;
      }
      current = undefined;
      if (ctl.cancelled || isCancellation(e)) {
        set({ state: 'available', update });
        return;
      }
      const { message, retryable } = failure(e);
      announce(message);
      set({ state: 'failed', step: 'download', update, message, retryable });
    },
  );
}

/** Stops the check, download, or install; it ends quietly, not failed. */
export function cancelUpdate() {
  const ctl = current;
  if (ctl === undefined) {
    return;
  }
  ctl.cancelled = true;
  ctl.abort.abort();
  ctl.cancel.cancel();
}

/** Retries the step that failed. */
export function retry() {
  if (status.state !== 'failed') {
    return;
  }
  if (status.step === 'check') {
    checkForUpdate();
  } else {
    downloadUpdate();
  }
}

/** Forgets a failure, going back to the offer if there was one. */
export function dismiss() {
  if (status.state !== 'failed') {
    return;
  }
  set(status.step === 'download' ? { state: 'available', update: status.update } : { state: 'idle' });
}
