import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { PrimaryButton } from './PrimaryButton';

import { rs, rf } from '@/constants/scale';

interface Props {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({ visible, title, body, confirmLabel = 'Подтвердить', cancelLabel = 'Отмена', danger, onCancel, onConfirm }: Props) {
  return (
    <Modal statusBarTranslucent navigationBarTranslucent visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <PrimaryButton label={cancelLabel} onPress={onCancel} secondary small={false} />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton label={confirmLabel} onPress={onConfirm} danger={danger} small={false} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: rs(24) },
  card: {
    backgroundColor: Colors.bg,
    borderRadius: Radius.xl,
    padding: rs(28),
    width: '100%',
    ...Shadow.strong,
    gap: rs(12),
  },
  title: { fontSize: rf(18), fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  body: { fontSize: rf(14), color: Colors.textSecondary, textAlign: 'center', lineHeight: rf(20) },
  row: { flexDirection: 'row', gap: rs(12), marginTop: rs(8) },
});
