// Screenshot setup (docs/screenshots.md): fills a fresh install with what
// the key screens need, so the emulator workflow captures them populated.
// It goes through the same paths a person would: the catalog update, then
// real downloads of the study Bible and this week's daily text and meeting
// publications, then the sample notes and workspaces. Reached only from
// the dev-screenshots route, which builds without it unless __DEV__ or
// EXPO_PUBLIC_SCREENSHOTS=1.
import { PubKind, type PublicationSummary } from 'berean-ffi-rn';
import { File } from 'expo-file-system';

import { catalog, library, reader } from '@/ffi/core';
import { checkForUpdate, downloadUpdate, getCatalogUpdate, subscribe as subscribeCatalog } from '@/library/catalog-update';
import { downloadTarget, fetchOk, getSnapshot, startInstall, subscribe as subscribeInstalls } from '@/library/installs';
import { displayTitle } from '@/library/labels';
import { cancelImport, getImports, importFile } from '@/library/side-load';
import { seedSampleNotes } from '@/notes/dev-seed';
import { seedReaderWorkspace, seedSampleWorkspace } from '@/studyspace/dev-seed';
import { localDay } from '@/today/days';

/** The Bible the setup installs; its "Bible: <pubKey>" line tells the workflow which key to open. */
export const SCREENSHOT_BIBLE = 'nwtsty';
const ENGLISH = 0;

/** Resolves once `done` holds, checking after every change `subscribe` reports. */
function until(subscribe: (listener: () => void) => () => void, done: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (done()) return resolve();
    const unsubscribe = subscribe(() => {
      if (done()) {
        unsubscribe();
        resolve();
      }
    });
  });
}

async function updateCatalog(log: (line: string) => void) {
  const state = () => getCatalogUpdate().status;
  log('Catalog: checking');
  checkForUpdate();
  await until(subscribeCatalog, () => state().state !== 'checking' && state().state !== 'idle');
  if (state().state === 'available') {
    log('Catalog: downloading');
    downloadUpdate();
    let reported = '';
    await until(subscribeCatalog, () => {
      const now = state();
      // A line per tenth, so a stall shows where it stopped.
      const step =
        now.state === 'downloading' && now.totalBytes > 0
          ? `downloading ${Math.floor((now.bytesWritten / now.totalBytes) * 10) * 10}%`
          : now.state === 'installing' && now.total > 0
            ? `installing ${Math.floor((now.done / now.total) * 10) * 10}%`
            : now.state;
      if (step !== reported) {
        reported = step;
        log(`Catalog: ${step}`);
      }
      return ['upToDate', 'failed'].includes(now.state);
    });
  }
  const final = state();
  if (final.state === 'failed') throw new Error(`catalog: ${final.message}`);
  log('Catalog: up to date');
}

const installed = (pubKey: string) => library().installed().some((p) => p.pubKey === pubKey);

async function install(pub: PublicationSummary, log: (line: string) => void) {
  if (installed(pub.pubKey)) return;
  log(`Downloading: ${pub.pubKey}`);
  startInstall(pub);
  // The job shows up only once the download starts, so wait for the
  // outcome itself: installed, or a failed job.
  await until(subscribeInstalls, () => installed(pub.pubKey) || getSnapshot().jobs.get(pub.pubKey)?.state === 'failed');
  const job = getSnapshot().jobs.get(pub.pubKey);
  if (job?.state === 'failed') throw new Error(`${pub.pubKey}: ${job.message}`);
  log(`Installed: ${displayTitle(pub)} (${pub.pubKey})`);
}

/** What today's screens are missing: the daily text and the week's meeting publications. */
function missingForToday(day: number): PublicationSummary[] {
  const missing: PublicationSummary[] = [];
  const text = reader().dailyText(ENGLISH, day);
  if (text.tag === 'NotInstalled') missing.push(text.inner.publication);
  const week = reader().meetingWeek(ENGLISH, day);
  for (const part of [week.midweek, week.weekend]) {
    if (part.tag === 'NotInstalled') missing.push(part.inner.publication);
  }
  return missing.filter((p, i) => missing.findIndex((q) => q.pubKey === p.pubKey) === i);
}

/** The publication the setup opens as a file, the way Library › Import does. */
const SIDE_LOADED = 'll';

/**
 * Downloads a small publication's .jwpub as a plain file and imports it
 * through the side-load path (Library › Import, Open with), then imports it
 * again to check that the app asks before replacing it.
 */
async function sideLoad(log: (line: string) => void) {
  const pub = catalog().publications({ mepsLanguage: ENGLISH, keySymbol: SIDE_LOADED, limit: 1 })[0];
  if (pub === undefined) throw new Error(`no ${SIDE_LOADED} in the catalog`);
  if (installed(pub.pubKey)) return;
  log(`Side-load: downloading ${pub.pubKey}`);
  const signal = new AbortController().signal;
  const reply = await fetchOk(library().downloadRequest(pub.pubKey).url, signal);
  const plan = library().planDownload(pub.pubKey, await reply.arrayBuffer());
  const fileName = `${SIDE_LOADED}_E.jwpub`;
  const once = async () => {
    const file = await File.downloadFileAsync(plan.url, downloadTarget(`side-load-${fileName}`), { idempotent: true });
    await importFile(file.uri, { name: fileName, owned: true, open: false });
    const jobs = getImports();
    const failed = jobs.find((j) => j.state === 'failed');
    if (failed?.state === 'failed') throw new Error(`side-load: ${failed.message}`);
    return jobs;
  };
  await once();
  if (!installed(pub.pubKey)) throw new Error(`side-load: ${pub.pubKey} is not installed`);
  log(`Side-load: installed ${displayTitle(pub)} (${pub.pubKey})`);
  const again = (await once()).find((j) => j.state === 'replace');
  if (again === undefined) throw new Error('side-load: a second import did not ask to replace');
  cancelImport(again.id);
  log('Side-load: a second copy asks before replacing');
}

/** The language the article's Languages screen shows installed beside English. */
const SECOND_LANGUAGE = 'S';

/**
 * The weekend's study article, for the article and its Languages screen:
 * installs its issue in a second language too, so the list shows both
 * sections, and reports it in an "Article: <pubKey> <docId>" line.
 */
async function articleInAnotherLanguage(day: number, log: (line: string) => void) {
  const weekend = reader().meetingWeek(ENGLISH, day).weekend;
  if (weekend.tag !== 'Ready') {
    log('Article: none (the weekend study article is not installed)');
    return;
  }
  const { publication, docId } = weekend.inner;
  const second = reader()
    .documentLanguages(publication.pubKey, docId)
    .find((l) => l.language.code === SECOND_LANGUAGE);
  if (second !== undefined && !second.installed) await install(second.publication, log);
  log(`Article: ${publication.pubKey} ${docId}`);
}

/** Runs the setup; each step logs a line. Throws on the first failure. */
export async function runScreenshotSetup(log: (line: string) => void): Promise<void> {
  await updateCatalog(log);

  const bible = catalog().publications({ mepsLanguage: ENGLISH, kind: PubKind.Bible, keySymbol: SCREENSHOT_BIBLE, limit: 1 })[0];
  if (bible === undefined) throw new Error(`no ${SCREENSHOT_BIBLE} Bible in the catalog`);
  await install(bible, log);
  log(`Bible: ${bible.pubKey}`);

  const day = localDay(new Date());
  // Twice: a publication installed in the first pass can name the next one
  // (the weekend's Watchtower once its issue is known).
  for (let pass = 0; pass < 2; pass++) {
    for (const pub of missingForToday(day)) await install(pub, log);
  }
  const still = missingForToday(day);
  if (still.length > 0) log(`Not in the catalog yet: ${still.map((p) => p.pubKey).join(', ')}`);

  await articleInAnotherLanguage(day, log);

  await sideLoad(log);

  log(seedSampleNotes());
  log(seedSampleWorkspace());
  log(seedReaderWorkspace());
}
