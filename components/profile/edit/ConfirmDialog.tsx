import React from 'react';
import { Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback, StyleSheet } from 'react-native';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';

/**
 * Свой модал подтверждения — `Alert.alert` на вебе не работает (одна из
 * трёх поверхностей приложения), а «Выход без сохранения» нужен и там.
 */
export function ConfirmDialog({
  visible, title, message, confirmLabel, cancelLabel, onConfirm, onCancel, onDismiss,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onDismiss}>
      <TouchableWithoutFeedback onPress={onDismiss}>
        <View style={s.overlay} />
      </TouchableWithoutFeedback>
      <View style={s.center} pointerEvents="box-none">
        <View style={s.card}>
          <Text style={s.title}>{title}</Text>
          {message ? <Text style={s.message}>{message}</Text> : null}
          <View style={s.actions}>
            <TouchableOpacity activeOpacity={0.75} onPress={onConfirm} style={s.confirmBtn}>
              <Text style={s.confirmText}>{confirmLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.75} onPress={onCancel} style={s.cancelBtn}>
              <Text style={s.cancelText}>{cancelLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: EditColors.overlay },
  center: {
    ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 340, borderRadius: EditRadius.card, borderWidth: 2, borderColor: EditColors.ink,
    backgroundColor: EditColors.surface, padding: 20, gap: 14,
  },
  title: { fontFamily: EditFonts.heading, fontSize: 18, color: EditColors.ink },
  message: { fontFamily: EditFonts.text600, fontSize: 14, lineHeight: 20, color: EditColors.label },
  actions: { gap: 10 },
  confirmBtn: {
    height: 52, borderRadius: 26, borderWidth: 2, borderColor: EditColors.ink, backgroundColor: EditColors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmText: { fontFamily: EditFonts.text800, fontSize: 16, color: EditColors.ink },
  cancelBtn: { height: 52, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: EditFonts.text700, fontSize: 15, color: EditColors.textTertiary },
});
