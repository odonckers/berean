import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ProgressBar } from '@/components/progress-bar';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import {
  cancelUpdate,
  type CatalogUpdateState,
  checkForUpdate,
  dismiss,
  downloadUpdate,
  retry,
  useCatalogUpdate,
} from '@/library/catalog-update';

/** For the offer only: the core doesn't report the size before downloading. */
const APPROX_CATALOG_MB = 63;

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

function percentOf(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

/** Check, offer, progress, or failure for the catalog update. */
export function CatalogUpdatePanel({ compact = false }: { compact?: boolean }) {
  const { status } = useCatalogUpdate();
  return (
    <View style={[styles.panel, compact && styles.compact]}>
      <PanelBody status={status} />
    </View>
  );
}

function CancelButton({ step }: { step: 'download' | 'install' }) {
  return (
    <TextButton title="Cancel" accessibilityLabel={`Cancel catalog ${step}`} onPress={cancelUpdate} />
  );
}

function PanelBody({ status }: { status: CatalogUpdateState }) {
  const { colors } = useBerean();
  const text = styles.text;
  const checkButton = <TextButton title="Check for catalog update" onPress={checkForUpdate} />;

  switch (status.state) {
    case 'idle':
      return checkButton;
    case 'checking':
      return (
        <View style={styles.row}>
          <ActivityIndicator color={colors.accent} accessibilityLabel="Checking" />
          <UIText style={text}>Checking for a catalog update…</UIText>
        </View>
      );
    case 'upToDate':
      return (
        <>
          <UIText style={text}>The catalog is up to date.</UIText>
          {checkButton}
        </>
      );
    case 'available':
      return (
        <TextButton
          title={`Download catalog (about ${APPROX_CATALOG_MB} MB)`}
          accessibilityLabel={`Download catalog, about ${APPROX_CATALOG_MB} megabytes`}
          onPress={downloadUpdate}
        />
      );
    case 'downloading': {
      const { bytesWritten, totalBytes } = status;
      if (totalBytes > 0) {
        const percent = percentOf(bytesWritten, totalBytes);
        const label = `${megabytes(bytesWritten)} of ${megabytes(totalBytes)} MB · ${percent}%`;
        return (
          <>
            <UIText style={text}>{label}</UIText>
            <View style={styles.bar}>
              <ProgressBar percent={percent} label={`Downloading catalog: ${label}`} />
            </View>
            <CancelButton step="download" />
          </>
        );
      }
      return (
        <>
          <View style={styles.row}>
            <ActivityIndicator color={colors.accent} accessibilityLabel="Downloading catalog" />
            <UIText style={text}>{megabytes(bytesWritten)} MB downloaded</UIText>
          </View>
          <CancelButton step="download" />
        </>
      );
    }
    case 'installing': {
      const percent = percentOf(status.done, status.total);
      const label = `Installing catalog · ${percent}%`;
      return (
        <>
          <UIText style={text}>{label}</UIText>
          <View style={styles.bar}>
            <ProgressBar percent={percent} label={label} />
          </View>
          <CancelButton step="install" />
        </>
      );
    }
    case 'failed':
      return (
        <>
          <UIText
            accessibilityLiveRegion="assertive"
            style={[styles.text, { color: colors.accent }]}
          >
            {status.message}
          </UIText>
          <View style={styles.row}>
            {status.retryable && (
              <TextButton
                title="Retry"
                accessibilityLabel={
                  status.step === 'check' ? 'Retry catalog update check' : 'Retry catalog download'
                }
                onPress={retry}
              />
            )}
            <TextButton
              title="Dismiss"
              accessibilityLabel="Dismiss catalog update error"
              onPress={dismiss}
            />
          </View>
        </>
      );
  }
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md, alignSelf: 'stretch', alignItems: 'flex-start' },
  compact: { gap: spacing.xs },
  bar: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  text: { flexShrink: 1 },
});
