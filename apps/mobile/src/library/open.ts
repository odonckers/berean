import { PubKind, type PublicationSummary } from 'berean-ffi-rn';
import { router } from 'expo-router';

import { displayTitle } from '@/library/labels';

/**
 * Open an installed publication in the Read tab: navigate selects the tab,
 * and its stack either takes the new params in place (same screen on top)
 * or pushes.
 */
export function openPublication(pub: PublicationSummary) {
  const params = { pubKey: pub.pubKey, title: displayTitle(pub) };
  if (pub.kind === PubKind.Bible) {
    router.navigate({ pathname: '/', params });
  } else {
    router.navigate({ pathname: '/publication', params });
  }
}
