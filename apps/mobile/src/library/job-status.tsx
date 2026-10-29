import { useTheme } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ProgressBar } from '@/components/progress-bar';
import { TextButton } from '@/components/text-button';
import {
  cancelInstall,
  dismissInstall,
  type InstallJob,
  jobPercent,
  startInstall,
} from '@/library/installs';

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

/** "14.2 of 38.0 MB · 37%" or "Installing · 40%". */
export function jobProgressText(job: InstallJob): string {
  const percent = Math.round(jobPercent(job) ?? 0);
  switch (job.state) {
    case 'downloading':
      return job.totalBytes > 0
        ? `${megabytes(job.bytesWritten)} of ${megabytes(job.totalBytes)} MB · ${percent}%`
        : `Downloading · ${megabytes(job.bytesWritten)} MB`;
    case 'installing':
      return `Installing · ${percent}%`;
    case 'failed':
      return job.message;
  }
}

/** A job's progress with Cancel, or its failure with Retry and Dismiss. */
export function JobStatus({ job }: { job: InstallJob }) {
  const { colors } = useTheme();
  const { title, pubKey } = job.pub;
  const percent = jobPercent(job);
  return (
    <View style={styles.status}>
      <Text
        accessibilityLiveRegion={job.state === 'failed' ? 'assertive' : 'none'}
        style={[styles.text, { color: job.state === 'failed' ? colors.notification : colors.text }]}
      >
        {jobProgressText(job)}
      </Text>
      {percent !== undefined && (
        <ProgressBar percent={percent} label={`${title}: ${jobProgressText(job)}`} />
      )}
      <View style={styles.actions}>
        {job.state === 'failed' ? (
          <>
            {job.retryable && (
              <TextButton
                title="Retry"
                accessibilityLabel={`Retry ${title}`}
                onPress={() => startInstall(job.pub)}
              />
            )}
            <TextButton
              title="Dismiss"
              accessibilityLabel={`Dismiss error for ${title}`}
              onPress={() => dismissInstall(pubKey)}
            />
          </>
        ) : (
          <TextButton
            title="Cancel"
            accessibilityLabel={`Cancel ${title}`}
            onPress={() => cancelInstall(pubKey)}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  status: { gap: 4 },
  text: { fontSize: 15 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
