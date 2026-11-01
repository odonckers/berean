// Studyspace's haptics (findings §4.2): lifting a card, a snap catching,
// starting a resize. Called on the JS thread (a worklet schedules them);
// expo-haptics never runs inside a worklet. A device without haptics just
// stays still.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import type { Look } from '@/design/look';

// Android's own feedback constants exist only on Android; the iOS look
// there uses the cross-platform calls, as it does on iOS.
const androidMaterial = (look: Look) => look === 'material' && Platform.OS === 'android';

/** A card lifts on long press. */
export function liftHaptic(look: Look) {
  const done = androidMaterial(look)
    ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press)
    : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  done.catch(() => {});
}

/** A snap catches: `.alignment`-weight on the iOS look, CLOCK_TICK on Material (§4.2). */
export function snapHaptic(look: Look) {
  const done = androidMaterial(look)
    ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick)
    : Haptics.selectionAsync();
  done.catch(() => {});
}

/** A resize handle is grabbed. */
export function resizeHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
