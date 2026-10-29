import type { PublicationSummary } from 'berean-ffi-rn';
import { useTheme } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { TextButton } from '@/components/text-button';
import { type InstallJob, startInstall } from '@/library/installs';
import { JobStatus } from '@/library/job-status';

type CatalogRowProps = {
  pub: PublicationSummary;
  installed: boolean;
  job: InstallJob | undefined;
};

export function CatalogRow({ pub, installed, job }: CatalogRowProps) {
  const { colors } = useTheme();
  const detail = pub.year > 0 ? `${pub.symbol} · ${pub.year}` : pub.symbol;
  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <View style={styles.main}>
        <View style={styles.text}>
          <Text numberOfLines={2} style={[styles.title, { color: colors.text }]}>
            {pub.title}
          </Text>
          <Text style={[styles.detail, { color: colors.text }]}>{detail}</Text>
        </View>
        {installed ? (
          <Text style={[styles.detail, { color: colors.text }]}>Installed</Text>
        ) : (
          job === undefined && (
            <TextButton
              title="Download"
              accessibilityLabel={`Download ${pub.title}`}
              onPress={() => startInstall(pub)}
            />
          )
        )}
      </View>
      {!installed && job !== undefined && <JobStatus job={job} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  main: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 4 },
  title: { fontSize: 17, fontWeight: '500' },
  detail: { fontSize: 15, opacity: 0.7 },
});
