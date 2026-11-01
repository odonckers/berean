import { Modal, type NativeSyntheticEvent, Pressable, StyleSheet, type TargetedEvent, View } from 'react-native';

import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { systemBarStyle, useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';
import { confirmButtons, dialogSurface } from '@/notes/confirm-buttons';
import { followFocusRingIn } from '../../modules/berean-shortcuts';
import { ModalNavigationBarStyle } from '../../modules/berean-system-bars';

type ConfirmDialogProps = {
  title: string;
  message: string;
  /** The destructive action, sentence case ("Delete"). */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

const followRing = (e: NativeSyntheticEvent<TargetedEvent>) => followFocusRingIn(e.nativeEvent.target);

/**
 * A destructive confirmation. Material: an M3 dialog, Cancel and the action
 * right-aligned. iOS look: an alert card, NameDialog's shell, with Cancel
 * bold and the action in red. Mounted only while open; Back cancels.
 */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const { look, scheme, colors, m3 } = useBerean();
  const material = look === 'material';
  const buttons = confirmButtons(look, confirmLabel, colors, m3);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onCancel}>
      <ModalNavigationBarStyle barStyle={systemBarStyle(scheme)} />
      <View style={styles.root}>
        <Pressable
          accessible={false}
          onPress={onCancel}
          style={[StyleSheet.absoluteFill, { backgroundColor: material ? m3.scrim : m3.scrimWarm }]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.card,
            { backgroundColor: dialogSurface(look, scheme === 'dark', colors, m3) },
            material ? { borderRadius: radii.sheet, padding: spacing.xl } : { borderRadius: 14, padding: spacing.lg },
          ]}
        >
          <UIText
            accessibilityRole="header"
            style={[material ? styles.materialTitle : styles.iosTitle, { color: material ? m3.onSurface : colors.text }]}
          >
            {title}
          </UIText>
          <UIText
            style={[material ? styles.materialBody : styles.iosBody, { color: material ? m3.onSurfaceVariant : colors.text }]}
          >
            {message}
          </UIText>
          <View style={[styles.buttons, !material && styles.iosButtons]}>
            {buttons.map((b) => (
              <TextButton
                key={b.role}
                title={b.label}
                color={b.color}
                bold={b.bold}
                onPress={b.role === 'cancel' ? onCancel : onConfirm}
                onFocus={followRing}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 360, gap: spacing.lg },
  // M3 dialog headline small and supporting text (body medium).
  materialTitle: { fontSize: 24, lineHeight: 32 },
  materialBody: { fontSize: 14, lineHeight: 20 },
  iosTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  iosBody: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  // TextButton is at least 48dp tall on the Material look.
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  iosButtons: { justifyContent: 'space-between' },
});
