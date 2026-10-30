import { useState } from 'react';
import {
  Modal,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  TextInput,
  type TargetedEvent,
  View,
} from 'react-native';

import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { systemBarStyle, useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';
import { useKeyboardHeight } from '@/design/use-keyboard-height';
import { folderName } from '@/notes/folders';
import { followFocusRingIn } from '../../modules/berean-shortcuts';
import { ModalNavigationBarStyle } from '../../modules/berean-system-bars';

type NameDialogProps = {
  title: string;
  initial: string;
  confirmLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
};

const followRing = (e: NativeSyntheticEvent<TargetedEvent>) => followFocusRingIn(e.nativeEvent.target);

/**
 * New Folder and Rename: a name field and two buttons. Material: an M3
 * dialog. iOS look: an alert-style card. Mounted only while open, so each
 * opening starts from `initial`.
 */
export function NameDialog({ title, initial, confirmLabel, onSubmit, onCancel }: NameDialogProps) {
  const { look, scheme, colors, m3, type } = useBerean();
  const material = look === 'material';
  const keyboard = useKeyboardHeight();
  const [text, setText] = useState(initial);
  const name = folderName(text);
  const submit = () => {
    if (name !== undefined) onSubmit(name);
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onCancel}>
      <ModalNavigationBarStyle barStyle={systemBarStyle(scheme)} />
      <View style={[styles.root, { paddingBottom: keyboard }]}>
        <Pressable
          accessible={false}
          onPress={onCancel}
          style={[StyleSheet.absoluteFill, { backgroundColor: material ? m3.scrim : m3.scrimWarm }]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.card,
            material
              ? { backgroundColor: m3.surfaceContainerHigh, borderRadius: radii.sheet, padding: spacing.xl }
              : { backgroundColor: colors.surfaceRaised, borderRadius: 14, padding: spacing.lg },
          ]}
        >
          <UIText
            accessibilityRole="header"
            style={[
              material ? styles.materialTitle : styles.iosTitle,
              { color: material ? m3.onSurface : colors.text },
            ]}
          >
            {title}
          </UIText>
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            selectTextOnFocus
            accessibilityLabel="Folder name"
            placeholder="Name"
            placeholderTextColor={colors.textSecondary}
            returnKeyType="done"
            onSubmitEditing={submit}
            onFocus={followRing}
            style={[
              type.ui.body,
              styles.input,
              { color: colors.text, minHeight: material ? 56 : 44 },
              material
                ? { borderColor: m3.primary, borderWidth: 2, borderRadius: 4 }
                : { backgroundColor: colors.surface, borderRadius: 8 },
            ]}
          />
          <View style={[styles.buttons, !material && styles.iosButtons]}>
            <TextButton title="Cancel" onPress={onCancel} onFocus={followRing} />
            <TextButton title={confirmLabel} disabled={name === undefined} onPress={submit} onFocus={followRing} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 360, gap: spacing.lg },
  // M3 dialog headline small.
  materialTitle: { fontSize: 24, lineHeight: 32 },
  iosTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  input: { paddingHorizontal: spacing.md },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  iosButtons: { justifyContent: 'space-between' },
});
