// Opening a .jwpub from the device: picked in the Library (Import), or handed
// to the app by another one (Open with / Open in Berean, through
// app/+native-intent.tsx). The file is copied into the cache, the core
// installs it as the publication the file itself names (Library::side_load),
// and the copy is deleted. Imports are kept outside React, like install jobs,
// so they survive navigating away; the Library lists them above its
// downloads (import-status.tsx).
import {
  CancelToken,
  CoreError,
  type ProgressSink,
  type PublicationSummary,
  SideLoad_Tags,
} from 'berean-ffi-rn';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

import { library } from '@/ffi/core';
import { coreErrorMessage } from '@/ffi/errors';
import { fileUriToPath } from '@/ffi/paths';
import { deleteQuietly, isCancellation, libraryChanged } from '@/library/installs';
import { displayTitle } from '@/library/labels';
import { openPublication } from '@/library/open';
import { fileNameFromUrl, sideLoadFailure, type SideLoadErrorTag } from '@/library/side-load-text';

export type ImportJob =
  /** Copying the file in, before the core has it. */
  | { id: number; state: 'copying'; name?: string }
  | { id: number; state: 'importing'; name?: string; done: number; total: number }
  /** The publication is already installed: replace it, or keep it. */
  | { id: number; state: 'replace'; name?: string; pub: PublicationSummary }
  | { id: number; state: 'failed'; name?: string; message: string };

type Controls = { cancel: CancelToken; cancelled: boolean; file?: File; open: boolean };

const jobs = new Map<number, ImportJob>();
const controls = new Map<number, Controls>();
const listeners = new Set<() => void>();
let snapshot: readonly ImportJob[] = [];
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;

function emit() {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  snapshot = [...jobs.values()];
  listeners.forEach((listener) => listener());
}

function emitSoon() {
  timer ??= setTimeout(emit, 100);
}

export function subscribeImports(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getImports(): readonly ImportJob[] {
  return snapshot;
}

/** The imports in progress, waiting on a choice, or failed, oldest first. */
export function useImports(): readonly ImportJob[] {
  return useSyncExternalStore(subscribeImports, getImports);
}

/** 0 to 100 while importing; undefined otherwise. */
export function importPercent(job: ImportJob): number | undefined {
  if (job.state === 'copying') {
    return 0;
  }
  if (job.state !== 'importing') {
    return undefined;
  }
  return job.total > 0 ? (job.done / job.total) * 100 : 0;
}

function isCoreError(e: unknown): e is CoreError {
  // CoreError.instanceOf indexes its argument, so rule out null first.
  return typeof e === 'object' && e !== null && CoreError.instanceOf(e);
}

function failureMessage(e: unknown, name: string | undefined): string {
  if (isCoreError(e)) {
    return sideLoadFailure(e.tag as SideLoadErrorTag, name, coreErrorMessage(e));
  }
  // Copying the file in failed: the app couldn't read it.
  return sideLoadFailure('Io', name, e instanceof Error ? e.message : String(e));
}

/** A fresh file in the cache's imports dir, which this creates if needed. */
function importTarget(id: number): File {
  const dir = new Directory(Paths.cache, 'imports');
  dir.create({ idempotent: true, intermediates: true });
  return new File(dir, `import-${Date.now()}-${id}.jwpub`);
}

function set(job: ImportJob) {
  jobs.set(job.id, job);
}

function end(id: number) {
  const ctl = controls.get(id);
  if (ctl?.file !== undefined) {
    deleteQuietly(ctl.file);
  }
  controls.delete(id);
  jobs.delete(id);
}

function fail(id: number, name: string | undefined, e: unknown) {
  const ctl = controls.get(id);
  if (ctl?.file !== undefined) {
    deleteQuietly(ctl.file);
  }
  controls.delete(id);
  const message = failureMessage(e, name);
  set({ id, state: 'failed', name, message });
  AccessibilityInfo.announceForAccessibility(message);
  emit();
}

/** Hands the copied file to the core; ends the job, or leaves it asking to replace. */
async function install(id: number, name: string | undefined, replace: boolean) {
  const ctl = controls.get(id);
  if (ctl?.file === undefined) {
    return;
  }
  set({ id, state: 'importing', name, done: 0, total: 0 });
  emit();
  const progress: ProgressSink = {
    onProgress(done, total) {
      if (controls.get(id) !== ctl || ctl.cancelled) {
        return;
      }
      set({ id, state: 'importing', name, done: Number(done), total: Number(total) });
      emitSoon();
    },
  };
  try {
    const result = await library().sideLoad(fileUriToPath(ctl.file.uri), replace, progress, ctl.cancel);
    if (controls.get(id) !== ctl) {
      return;
    }
    const pub = result.inner.publication;
    if (result.tag === SideLoad_Tags.AlreadyInstalled) {
      // Keep the copy for Replace.
      set({ id, state: 'replace', name, pub });
      AccessibilityInfo.announceForAccessibility(
        `${displayTitle(pub)} is already on this device. Replace it, or keep the one you have.`,
      );
      emit();
      return;
    }
    end(id);
    emit();
    AccessibilityInfo.announceForAccessibility(`${displayTitle(pub)} is added to your library.`);
    libraryChanged();
    if (ctl.open) {
      openPublication(pub);
    }
  } catch (e) {
    if (controls.get(id) !== ctl) {
      return;
    }
    if (ctl.cancelled || isCancellation(e)) {
      end(id);
      emit();
    } else {
      fail(id, name, e);
    }
  }
}

export type ImportOptions = {
  /** The file's name, when the source knows it. */
  name?: string;
  /** The file is the app's own temporary copy, deleted once it is read. */
  owned?: boolean;
  /** Open the publication in Read once it is in. Default true. */
  open?: boolean;
};

/**
 * Imports the file at `uri` (file:// or, on Android, content://). Resolves
 * when the import has ended, is waiting on Replace, or has failed; the
 * outcome is in the import's job (and, once in, the library).
 */
export async function importFile(uri: string, options: ImportOptions = {}): Promise<void> {
  const { open = true } = options;
  // iOS copies a file opened in Berean into Documents/Inbox; that copy is
  // the app's to delete.
  const owned = options.owned ?? uri.startsWith(new Directory(Paths.document, 'Inbox').uri);
  let { name } = options;
  const id = nextId++;
  const ctl: Controls = { cancel: new CancelToken(), cancelled: false, open };
  controls.set(id, ctl);
  name ??= fileNameFromUrl(uri);
  set({ id, state: 'copying', name });
  emit();
  try {
    const source = new File(uri);
    if (owned) {
      ctl.file = source;
    } else {
      const target = importTarget(id);
      await source.copy(target);
      ctl.file = target;
    }
  } catch (e) {
    if (controls.get(id) === ctl && !ctl.cancelled) {
      fail(id, name, e);
    }
    return;
  }
  if (ctl.cancelled) {
    end(id);
    emit();
    return;
  }
  await install(id, name, false);
}

/** Opens the system file picker and imports the file picked; nothing if cancelled. */
export async function pickAndImport(): Promise<void> {
  let result: DocumentPicker.DocumentPickerResult;
  try {
    // .jwpub has no registered MIME type, so any file can be picked; the
    // core says if it isn't a publication.
    result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  } catch (e) {
    const id = nextId++;
    set({ id, state: 'failed', message: sideLoadFailure('Io', undefined, String(e)) });
    emit();
    return;
  }
  if (result.canceled) {
    return;
  }
  const asset = result.assets[0];
  if (asset !== undefined) {
    await importFile(asset.uri, { name: asset.name, owned: true });
  }
}

/** Replaces the installed copy with the file that was opened. */
export function replaceImport(id: number) {
  const job = jobs.get(id);
  if (job?.state === 'replace') {
    void install(id, job.name, true);
  }
}

/** Stops an import, or drops one that is waiting or failed, leaving the library as it is. */
export function cancelImport(id: number) {
  const ctl = controls.get(id);
  const job = jobs.get(id);
  if (job === undefined) {
    return;
  }
  if (ctl !== undefined && (job.state === 'copying' || job.state === 'importing')) {
    // The running call ends the job when it sees the cancel.
    ctl.cancelled = true;
    ctl.cancel.cancel();
    return;
  }
  end(id);
  emit();
}

/**
 * Sample imports, one in each state, for the screenshot workflow
 * (berean:///library?importDemo=1). They touch no file and no core data.
 */
export function showImportDemo(pub: PublicationSummary | undefined) {
  for (const id of [...jobs.keys()]) {
    end(id);
  }
  const id = () => nextId++;
  set({ id: id(), state: 'importing', name: 'lfb_E.jwpub', done: 82, total: 203 });
  if (pub !== undefined) {
    set({ id: id(), state: 'replace', name: 'w_E_202608.jwpub', pub });
  }
  set({
    id: id(),
    state: 'failed',
    name: 'Meeting notes.pdf',
    message: sideLoadFailure('Corrupt', 'Meeting notes.pdf', ''),
  });
  emit();
}
