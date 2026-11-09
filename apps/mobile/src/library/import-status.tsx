import { StyleSheet, View } from 'react-native';

import { ProgressBar } from '@/components/progress-bar';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useBerean } from '@/design/theme';
import { hairline, spacing } from '@/design/tokens';
import { displayTitle } from '@/library/labels';
import { cancelImport, type ImportJob, importPercent, replaceImport } from '@/library/side-load';

/** What the row is about: the publication once known, else the file. */
function importTitle(job: ImportJob): string {
  if (job.state === 'replace') {
    return displayTitle(job.pub);
  }
  return job.name ?? 'Publication file';
}

function importText(job: ImportJob): string {
  switch (job.state) {
    case 'copying':
      return 'Opening the file';
    case 'importing':
      return `Adding to your library · ${Math.round(importPercent(job) ?? 0)}%`;
    case 'replace':
      return 'This publication is already on this device. Replace it with the file you opened? Your notes and highlights stay.';
    case 'failed':
      return job.message;
  }
}

/** One import: its progress with Cancel, the replace question, or its failure. */
export function ImportStatus({ job }: { job: ImportJob }) {
  const { colors } = useBerean();
  const title = importTitle(job);
  const text = importText(job);
  const percent = importPercent(job);
  return (
    <View style={[styles.row, { borderColor: colors.separator }]}>
      <UIText numberOfLines={2} style={styles.title}>
        {title}
      </UIText>
      <UIText
        accessibilityLiveRegion={job.state === 'failed' || job.state === 'replace' ? 'assertive' : 'none'}
        style={[styles.text, job.state === 'failed' && { color: colors.accent }]}
      >
        {text}
      </UIText>
      {percent !== undefined && <ProgressBar percent={percent} label={`${title}: ${text}`} />}
      <View style={styles.actions}>
        {job.state === 'replace' ? (
          <>
            <TextButton
              title="Keep Current"
              accessibilityLabel={`Keep the ${title} you have`}
              onPress={() => cancelImport(job.id)}
            />
            <TextButton
              title="Replace"
              bold
              accessibilityLabel={`Replace ${title} with the file you opened`}
              onPress={() => replaceImport(job.id)}
            />
          </>
        ) : job.state === 'failed' ? (
          <TextButton
            title="Dismiss"
            accessibilityLabel={`Dismiss error for ${title}`}
            onPress={() => cancelImport(job.id)}
          />
        ) : (
          <TextButton
            title="Cancel"
            accessibilityLabel={`Cancel opening ${title}`}
            onPress={() => cancelImport(job.id)}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    borderBottomWidth: hairline,
  },
  title: { fontWeight: '500' },
  text: { fontSize: 15 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm },
});
