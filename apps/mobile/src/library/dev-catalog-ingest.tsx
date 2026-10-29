// Dev only. The real download is CatalogUpdatePanel (catalog-update.ts);
// this stays for offline testing with a file pushed by
// `adb push catalog.db.gz <cache dir>/dev-catalog/catalog.db.gz`.
import { CancelToken, type ProgressSink } from 'berean-ffi-rn';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ProgressBar } from '@/components/progress-bar';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import { cacheDir, catalog } from '@/ffi/core';
import { coreErrorMessage } from '@/ffi/errors';

type IngestState =
  | { state: 'idle'; error?: string }
  | { state: 'running'; percent: number };

/** Least time between progress re-renders. */
const THROTTLE_MS = 100;

export function DevCatalogIngest({ onIngested }: { onIngested: () => void }) {
  const { colors } = useBerean();
  const [ingest, setIngest] = useState<IngestState>({ state: 'idle' });
  const token = useRef<CancelToken | undefined>(undefined);

  const start = () => {
    const cancel = new CancelToken();
    token.current = cancel;
    setIngest({ state: 'running', percent: 0 });
    let last = 0;
    const progress: ProgressSink = {
      onProgress(done, total) {
        const now = Date.now();
        if (now - last >= THROTTLE_MS && total > 0n) {
          last = now;
          setIngest({ state: 'running', percent: (Number(done) / Number(total)) * 100 });
        }
      },
    };
    const path = `${cacheDir()}/dev-catalog/catalog.db.gz`;
    catalog()
      .ingestFile(path, progress, cancel)
      .then(
        () => {
          setIngest({ state: 'idle' });
          onIngested();
        },
        (e: unknown) => {
          setIngest({ state: 'idle', error: cancel.isCancelled() ? undefined : coreErrorMessage(e) });
        },
      )
      .finally(() => {
        token.current = undefined;
      });
  };

  return (
    <View style={styles.panel}>
      {ingest.state === 'running' ? (
        <>
          <ProgressBar percent={ingest.percent} label="Ingesting catalog" />
          <TextButton
            title="Cancel"
            accessibilityLabel="Cancel catalog ingest"
            onPress={() => token.current?.cancel()}
          />
        </>
      ) : (
        <>
          <TextButton title="Dev: ingest catalog file" onPress={start} />
          {ingest.error !== undefined && (
            <UIText
              accessibilityLiveRegion="assertive"
              style={[styles.error, { color: colors.accent }]}
            >
              {ingest.error}
            </UIText>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md, alignSelf: 'stretch', alignItems: 'flex-start' },
  error: { fontSize: 15 },
});
