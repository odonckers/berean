// Install jobs, kept outside React so progress survives navigating away.
// JS does only the transport here: the core builds the request, picks the
// file, and verifies and unpacks it (docs/design/mobile-bindings.md §1).
import {
  CancelToken,
  CoreError,
  CoreError_Tags,
  type ProgressSink,
  type PublicationSummary,
} from 'berean-ffi-rn';
import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

import { library } from '@/ffi/core';
import { coreErrorMessage } from '@/ffi/errors';
import { fileUriToPath } from '@/ffi/paths';

export type InstallJob =
  | { state: 'downloading'; pub: PublicationSummary; bytesWritten: number; totalBytes: number }
  | { state: 'installing'; pub: PublicationSummary; done: number; total: number }
  | { state: 'failed'; pub: PublicationSummary; message: string; retryable: boolean };

export type InstallsSnapshot = {
  jobs: ReadonlyMap<string, InstallJob>;
  /** Bumped after every successful install so lists can refresh. */
  installedVersion: number;
};

type Controls = { abort: AbortController; cancel: CancelToken; cancelled: boolean };

/** Least time between progress-driven snapshots. */
export const THROTTLE_MS = 100;
const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";

const jobs = new Map<string, InstallJob>();
const controls = new Map<string, Controls>();
/** The last 10 percent step announced per job and phase, e.g. "installing:4". */
const announced = new Map<string, string>();
const listeners = new Set<() => void>();
let snapshot: InstallsSnapshot = { jobs: new Map(), installedVersion: 0 };
let lastEmit = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function emit() {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  lastEmit = Date.now();
  snapshot = {
    jobs: new Map([...jobs].map(([key, job]) => [key, { ...job }])),
    installedVersion: snapshot.installedVersion,
  };
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

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): InstallsSnapshot {
  return snapshot;
}

const libraryListeners = new Set<() => void>();

/** Calls `listener` whenever the installed publications change. */
export function onLibraryChanged(listener: () => void): () => void {
  libraryListeners.add(listener);
  return () => libraryListeners.delete(listener);
}

/** Records a change to the installed publications, e.g. after a remove. */
export function libraryChanged() {
  snapshot = { ...snapshot, installedVersion: snapshot.installedVersion + 1 };
  emit();
  libraryListeners.forEach((listener) => listener());
}

export function useInstalls(): InstallsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 0 to 100, or undefined for a failed job. */
export function jobPercent(job: InstallJob): number | undefined {
  switch (job.state) {
    case 'downloading':
      return job.totalBytes > 0 ? (job.bytesWritten / job.totalBytes) * 100 : 0;
    case 'installing':
      return job.total > 0 ? (job.done / job.total) * 100 : 0;
    case 'failed':
      return undefined;
  }
}

function announceProgress(pubKey: string, job: InstallJob) {
  const percent = jobPercent(job);
  if (percent === undefined) {
    return;
  }
  const step = Math.floor(percent / 10);
  const mark = `${job.state}:${step}`;
  if (announced.get(pubKey) === mark) {
    return;
  }
  announced.set(pubKey, mark);
  const verb = job.state === 'downloading' ? 'Downloading' : 'Installing';
  AccessibilityInfo.announceForAccessibility(`${verb}, ${step * 10} percent.`);
}

/** Records progress, unless the job has ended (a late callback). */
function update(pubKey: string, ctl: Controls, job: InstallJob) {
  if (controls.get(pubKey) !== ctl) {
    return;
  }
  jobs.set(pubKey, job);
  announceProgress(pubKey, job);
  emitThrottled();
}

function finish(pubKey: string) {
  jobs.delete(pubKey);
  controls.delete(pubKey);
  announced.delete(pubKey);
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

function isCoreError(e: unknown): e is CoreError {
  // CoreError.instanceOf indexes its argument, so rule out null first.
  return typeof e === 'object' && e !== null && CoreError.instanceOf(e);
}

export function isCancellation(e: unknown): boolean {
  return isAbortError(e) || (isCoreError(e) && e.tag === CoreError_Tags.Cancelled);
}

export function failure(e: unknown): { message: string; retryable: boolean } {
  if (isCoreError(e)) {
    // A bad request or a broken DB won't fix itself on retry.
    const permanent = e.tag === CoreError_Tags.Invalid || e.tag === CoreError_Tags.Migration;
    return { message: coreErrorMessage(e), retryable: !permanent };
  }
  if (e instanceof Error) {
    // Not String(e): that prefixes "Error: " to our own messages.
    return { message: e.message, retryable: true };
  }
  return { message: String(e), retryable: true };
}

/** `name` in the cache's downloads dir, which this creates if needed. */
export function downloadTarget(name: string): File {
  const dir = new Directory(Paths.cache, 'downloads');
  dir.create({ idempotent: true, intermediates: true });
  return new File(dir, name);
}

/** fetch, with a network failure or a non-2xx reply as a readable error. */
export async function fetchOk(url: string, signal: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    // fetch rejects with a TypeError when the network fails.
    throw e instanceof TypeError ? new Error(NETWORK_ERROR) : e;
  }
  if (!res.ok) {
    throw new Error(`Server returned HTTP ${res.status}`);
  }
  return res;
}

export function deleteQuietly(file: File) {
  try {
    if (file.exists) {
      file.delete();
    }
  } catch {
    // A leftover file in the cache dir is harmless; the OS may clear it.
  }
}

/** Resolves true once installed, false if cancelled between steps. */
async function run(pub: PublicationSummary, ctl: Controls): Promise<boolean> {
  const { pubKey } = pub;
  update(pubKey, ctl, { state: 'downloading', pub, bytesWritten: 0, totalBytes: 0 });

  const request = library().downloadRequest(pubKey);
  const res = await fetchOk(request.url, ctl.abort.signal);
  const plan = library().planDownload(pubKey, await res.arrayBuffer());
  const planned = Number(plan.size);

  const target = downloadTarget(`${pubKey.replace(/[^A-Za-z0-9._-]/g, '_')}.jwpub`);
  try {
    const file = await File.downloadFileAsync(plan.url, target, {
      idempotent: true,
      signal: ctl.abort.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        update(pubKey, ctl, {
          state: 'downloading',
          pub,
          bytesWritten,
          totalBytes: totalBytes > 0 ? totalBytes : planned,
        });
      },
    });
    if (ctl.cancelled) {
      return false;
    }
    update(pubKey, ctl, { state: 'installing', pub, done: 0, total: 0 });
    const progress: ProgressSink = {
      onProgress(done, total) {
        update(pubKey, ctl, {
          state: 'installing',
          pub,
          done: Number(done),
          total: Number(total),
        });
      },
    };
    await library().install(pubKey, fileUriToPath(file.uri), progress, ctl.cancel);
    return true;
  } finally {
    deleteQuietly(target);
  }
}

/** Downloads and installs `pub`; a no-op if it is already in progress. */
export function startInstall(pub: PublicationSummary) {
  const { pubKey } = pub;
  const existing = jobs.get(pubKey);
  if (existing !== undefined && existing.state !== 'failed') {
    return;
  }
  const ctl: Controls = { abort: new AbortController(), cancel: new CancelToken(), cancelled: false };
  controls.set(pubKey, ctl);
  announced.delete(pubKey);

  run(pub, ctl).then(
    (installed) => {
      if (controls.get(pubKey) !== ctl) {
        return;
      }
      finish(pubKey);
      if (!installed) {
        emit();
        return;
      }
      // Even if Cancel came too late to stop it, the install did finish.
      AccessibilityInfo.announceForAccessibility(`${pub.title} is installed.`);
      libraryChanged();
    },
    (e: unknown) => {
      if (controls.get(pubKey) !== ctl) {
        return;
      }
      if (ctl.cancelled || isCancellation(e)) {
        finish(pubKey);
      } else {
        const { message, retryable } = failure(e);
        controls.delete(pubKey);
        jobs.set(pubKey, { state: 'failed', pub, message, retryable });
        AccessibilityInfo.announceForAccessibility(message);
      }
      emit();
    },
  );
}

/** Stops the download or the install; the job is removed, not failed. */
export function cancelInstall(pubKey: string) {
  const ctl = controls.get(pubKey);
  if (ctl === undefined) {
    return;
  }
  ctl.cancelled = true;
  ctl.abort.abort();
  ctl.cancel.cancel();
}

/** Forgets a failed job. */
export function dismissInstall(pubKey: string) {
  if (jobs.get(pubKey)?.state === 'failed') {
    finish(pubKey);
    emit();
  }
}
