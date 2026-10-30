import { Stack } from 'expo-router';

import { IosSearchView, MaterialSearchView } from '@/components/search-view';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';

// The full-screen search pushed by the M3 search bar (material look) and by
// the iOS look's toolbar field on wide Android windows. Not /search: expo-router
// resolves that path to the iOS look's tab, (tabs)/search/index, which is
// hidden in the material look, so the push landed on the first tab.
export default function SearchScreen() {
  const { look } = useBerean();
  const insets = useContentInsets();
  if (look === 'material') {
    return (
      <>
        {/* The view draws its own header: back arrow and field. */}
        <Stack.Screen options={{ headerShown: false }} />
        <MaterialSearchView />
      </>
    );
  }
  return <IosSearchView nativeField={false} inlineTitle={false} insets={insets} />;
}
