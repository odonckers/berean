// Dev-only smoke test of the berean-ffi bindings. It exercises the sync and
// async paths, error mapping and bigint, and times the two calls §5 of
// docs/design/mobile-bindings.md asks about. Nothing here is app logic.
import {
  CancelToken,
  Core,
  coreVersion,
  type CoreLike,
  type ProgressSink,
  userDbSchema,
} from 'berean-ffi-rn';
import { Paths } from 'expo-file-system';

import { coreErrorMessage } from './errors';
import { fileUriToPath } from './paths';

export const TAG = '[berean-ffi]';

/** Timed runs after the first (cold) one. */
const WARM_RUNS = 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function timed<T>(run: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
}

/** First run plus the median of WARM_RUNS more. */
function bench<T>(run: () => T, dispose: (value: T) => void = () => {}) {
  const first = timed(run);
  const warm: number[] = [];
  for (let i = 0; i < WARM_RUNS; i++) {
    const { value, ms } = timed(run);
    warm.push(ms);
    dispose(value);
  }
  return {
    value: first.value,
    summary: `first ${first.ms.toFixed(1)} ms, median of ${WARM_RUNS} ${median(warm).toFixed(1)} ms`,
  };
}

/** Awaits a call that should reject, and reports how it settled. */
async function expectRejection(label: string, call: () => Promise<void>) {
  const promise = call();
  const kind = promise instanceof Promise ? 'Promise' : typeof promise;
  try {
    await promise;
    return `${label}: returned ${kind}, resolved (expected a rejection)`;
  } catch (e) {
    return `${label}: returned ${kind}, rejected with ${coreErrorMessage(e)}`;
  }
}

function destroy(core: CoreLike) {
  if (Core.instanceOf(core)) {
    core.uniffiDestroy();
  }
}

/** Runs every check, logging each line with TAG, and returns the lines. */
export async function runFfiDiagnostics(): Promise<string[]> {
  const lines: string[] = [];
  const report = (line: string) => {
    lines.push(line);
    console.log(`${TAG} ${line}`);
  };

  try {
    report(`coreVersion() = ${coreVersion()}`);
    report(`userDbSchema() = ${userDbSchema()}`);

    const dataDir = fileUriToPath(Paths.document.uri);
    const cacheDir = fileUriToPath(Paths.cache.uri);
    report(`dataDir = ${dataDir}`);
    report(`cacheDir = ${cacheDir}`);

    const open = bench(() => Core.open(dataDir, cacheDir), destroy);
    const core = open.value;
    report(`Core.open: ${open.summary}`);
    report(`dbVersion() = ${core.dbVersion()}`);

    const catalog = core.catalog();
    const library = core.library();
    const publications = bench(() =>
      catalog.publications({
        mepsLanguage: undefined,
        kind: undefined,
        keySymbol: undefined,
        text: undefined,
        limit: undefined,
      }),
    );
    report(`catalog.publications(all): ${publications.value.length} (${publications.summary})`);
    report(`catalog.languages(): ${catalog.languages().length}`);
    report(`library.installed(): ${library.installed().length}`);

    let progressCalls = 0;
    const progress: ProgressSink = {
      onProgress(done, total) {
        progressCalls += 1;
        report(`onProgress(${typeof done} ${done}, ${typeof total} ${total})`);
      },
    };
    const missing = `${cacheDir}/berean-ffi-diagnostics/does-not-exist.jwpub`;
    report(
      await expectRejection('catalog.ingestFile(missing)', () =>
        catalog.ingestFile(missing, progress, new CancelToken()),
      ),
    );
    report(
      await expectRejection('library.install(bogus, missing)', () =>
        library.install('bogus_E', missing, progress, new CancelToken()),
      ),
    );
    report(`progress callbacks: ${progressCalls}`);

    // u64 in: a bigint lowers; the missing publication maps to a CoreError.
    try {
      core.reader().document('bogus_E', 1n);
      report('reader.document(bogus, 1n): returned (expected a CoreError)');
    } catch (e) {
      report(`reader.document(bogus, 1n): threw ${coreErrorMessage(e)}`);
    }

    destroy(core);
  } catch (e) {
    report(`FAILED: ${coreErrorMessage(e)}`);
  }
  return lines;
}
