import type { PublicationSummary } from 'berean-ffi-rn';
import { StyleSheet, View } from 'react-native';

import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useBerean } from '@/design/theme';
import { hairline, spacing } from '@/design/tokens';
import { type InstallJob, startInstall } from '@/library/installs';
import { JobStatus } from '@/library/job-status';
import { displayTitle } from '@/library/labels';

type CatalogRowProps = {
  pub: PublicationSummary;
  installed: boolean;
  job: InstallJob | undefined;
};

export function CatalogRow({ pub, installed, job }: CatalogRowProps) {
  const { colors } = useBerean();
  const title = displayTitle(pub);
  const detail = pub.year > 0 ? `${pub.symbol} · ${pub.year}` : pub.symbol;
  return (
    <View style={[styles.row, { borderColor: colors.separator }]}>
      <View style={styles.main}>
        <View style={styles.text}>
          <UIText numberOfLines={2} style={styles.title}>
            {title}
          </UIText>
          <UIText secondary style={styles.detail}>
            {detail}
          </UIText>
        </View>
        {installed ? (
          <UIText secondary style={styles.detail}>
            Installed
          </UIText>
        ) : (
          job === undefined && (
            <TextButton
              title="Download"
              accessibilityLabel={`Download ${title}`}
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: hairline,
  },
  main: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: spacing.xs },
  title: { fontWeight: '500' },
  detail: { fontSize: 15 },
});
