import type { NewPublication } from 'berean-ffi-rn';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ProgressBar } from '@/components/progress-bar';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';
import { useWindowClass } from '@/design/use-window-class';
import { catalog } from '@/ffi/core';
import { useCatalogUpdate } from '@/library/catalog-update';
import { type InstallJob, jobPercent, startInstall, useInstalls } from '@/library/installs';
import { jobProgressText } from '@/library/job-status';
import { displayTitle, KIND_LABELS } from '@/library/labels';
import { load } from '@/library/load';
import { openPublication } from '@/library/open';
import { releaseLabel, releaseSpoken } from '@/library/release';

/** How many What's New items the Library shows; See All lists more. */
const SHELF_COUNT = 12;

function openWhatsNew() {
  router.push('/library/whats-new');
}

/** A card's width: wider on tablets, and growing with the text size. */
function cardWidth(windowClass: string, fontScale: number, windowWidth: number): number {
  const base = windowClass === 'compact' ? 152 : 184;
  const scaled = Math.round(base * Math.min(Math.max(fontScale, 1), 2));
  // Never wider than most of the window, so the next card still peeks in.
  return Math.min(scaled, Math.round(windowWidth * 0.72));
}

/** What a card says about its download: installed, progress, failure, or nothing. */
function statusText(installed: boolean, job: InstallJob | undefined): string | undefined {
  if (installed) return 'Downloaded';
  if (job !== undefined) return jobProgressText(job);
  return undefined;
}

type CardProps = {
  item: NewPublication;
  installed: boolean;
  job: InstallJob | undefined;
  width: number;
};

/**
 * One What's New publication. Tapping it opens it when installed and
 * downloads it otherwise, as JW Library's What's New does; while it
 * downloads the card shows the progress and taps do nothing.
 */
export function WhatsNewCard({ item, installed, job, width }: CardProps) {
  const { colors, m3, look } = useBerean();
  const pub = item.publication;
  const title = displayTitle(pub);
  const kind = KIND_LABELS[pub.kind];
  const status = statusText(installed, job);
  const busy = job !== undefined && job.state !== 'failed';
  const percent = job !== undefined ? jobPercent(job) : undefined;
  const action = installed ? 'Opens it' : busy ? undefined : job?.state === 'failed' ? 'Tries the download again' : 'Downloads it';

  const onPress = () => {
    if (installed) openPublication(pub);
    else if (!busy) startInstall(pub);
  };

  const background = look === 'material' ? m3.surfaceContainer : colors.surfaceRaised;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, kind, `released ${releaseSpoken(item.released)}`, status ?? 'Not downloaded']
        .filter(Boolean)
        .join(', ')}
      accessibilityHint={action}
      accessibilityState={{ busy, disabled: busy }}
      onPress={onPress}
      android_ripple={{ color: colors.separator, foreground: true }}
      style={({ pressed }) => [
        styles.card,
        { width, backgroundColor: background, borderRadius: radii.card },
        look !== 'material' && pressed && !busy && { opacity: 0.6 },
      ]}
    >
      <UIText variant="caption" secondary numberOfLines={1}>
        {kind}
      </UIText>
      <UIText numberOfLines={3} style={styles.title}>
        {title}
      </UIText>
      <View style={styles.footer}>
        <UIText variant="caption" secondary numberOfLines={1}>
          {releaseLabel(item.released)}
        </UIText>
        {status !== undefined ? (
          <UIText
            variant="caption"
            numberOfLines={2}
            style={{ color: job?.state === 'failed' ? colors.destructive : colors.textSecondary }}
          >
            {status}
          </UIText>
        ) : (
          <UIText variant="caption" numberOfLines={1} style={{ color: colors.accent }}>
            Download
          </UIText>
        )}
        {busy && percent !== undefined && <ProgressBar percent={percent} label={`Downloading ${title}`} />}
      </View>
    </Pressable>
  );
}

type ShelfProps = {
  mepsLanguage: number;
  installed: ReadonlySet<string>;
  /** Side insets the list pads for, so the shelf scrolls edge to edge. */
  insetLeft: number;
  insetRight: number;
};

/**
 * The Library's What's New: the newest publications in the browsed
 * language, in a row that scrolls sideways, with See All. Nothing at all
 * when the catalog has none (not downloaded yet, or a language without
 * publications).
 */
export function WhatsNewShelf({ mepsLanguage, installed, insetLeft, insetRight }: ShelfProps) {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const windowClass = useWindowClass();
  const { catalogVersion } = useCatalogUpdate();
  const { jobs } = useInstalls();

  // A synchronous FFI call on the JS thread, like the catalog list: one
  // indexed query with a small limit.
  const items = useMemo(
    () => load(() => catalog().whatsNew(mepsLanguage, SHELF_COUNT)),
    // catalogVersion: a newly installed catalog changes the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mepsLanguage, catalogVersion],
  );
  if (!items.ok || items.value.length === 0) return null;

  const width = cardWidth(windowClass, fontScale, windowWidth);
  return (
    <View style={styles.section}>
      <View style={[styles.heading, { paddingLeft: insetLeft + spacing.lg, paddingRight: insetRight + spacing.lg - spacing.md }]}>
        <UIText variant="title" style={styles.headingText}>
          What&apos;s New
        </UIText>
        <TextButton title="See All" accessibilityLabel="See all of What's New" onPress={openWhatsNew} />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel="What's New publications"
        contentContainerStyle={[
          styles.row,
          { paddingLeft: insetLeft + spacing.lg, paddingRight: insetRight + spacing.lg },
        ]}
      >
        {items.value.map((item) => (
          <WhatsNewCard
            key={item.publication.pubKey}
            item={item}
            installed={installed.has(item.publication.pubKey)}
            job={jobs.get(item.publication.pubKey)}
            width={width}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  headingText: { flexShrink: 1 },
  row: { gap: spacing.md, alignItems: 'stretch' },
  card: {
    minHeight: 132,
    padding: spacing.md,
    gap: spacing.xs,
    overflow: 'hidden',
  },
  title: { fontWeight: '600', flexGrow: 1 },
  footer: { gap: spacing.xs },
});
