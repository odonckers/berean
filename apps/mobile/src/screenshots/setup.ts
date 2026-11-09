// Screenshot setup (docs/screenshots.md): fills a fresh install with what
// the key screens need, so the emulator workflow captures them populated.
// It goes through the same paths a person would: the catalog update, then
// real downloads of the study Bible and this week's daily text and meeting
// publications, then the sample notes and workspaces. Reached only from
// the dev-screenshots route, which builds without it unless __DEV__ or
// EXPO_PUBLIC_SCREENSHOTS=1.
import { PubKind, type PublicationSummary } from 'berean-ffi-rn';

import { catalog, library, reader } from '@/ffi/core';
import { checkForUpdate, downloadUpdate, getCatalogUpdate, subscribe as subscribeCatalog } from '@/library/catalog-update';
import { getSnapshot, startInstall, subscribe as subscribeInstalls } from '@/library/installs';
import { displayTitle } from '@/library/labels';
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
  await until(subscribeInstalls, () => {
    const job = getSnapshot().jobs.get(pub.pubKey);
    return job === undefined || job.state === 'failed';
  });
  const job = getSnapshot().jobs.get(pub.pubKey);
  if (job?.state === 'failed') throw new Error(`${pub.pubKey}: ${job.message}`);
  if (!installed(pub.pubKey)) throw new Error(`${pub.pubKey}: not installed after download`);
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

  log(seedSampleNotes());
  log(seedSampleWorkspace());
  log(seedReaderWorkspace());
}
