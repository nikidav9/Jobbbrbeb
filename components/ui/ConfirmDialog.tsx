import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';
import { JT, JT_FONT } from '@/constants/jt';
import { JT_ERROR } from './jt';
import { HardShadowBox } from '@/components/profile/edit/HardShadowBox';

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

/**
 * Окно вопроса «да/нет» в фирменном стиле JT (01.10.2026): кремовая карточка
 * с чёрным контуром и жёсткой тенью, как шторка уведомлений и окна профиля.
 * Кнопки друг под другом — длинная подпись («Согласен и отправить») больше
 * не обрезается многоточием.
 */
export function ConfirmDialog({ visible, title, body, confirmLabel = 'Подтвердить', cancelLabel = 'Отмена', danger, onCancel, onConfirm }: Props) {
  return (
    <Modal statusBarTranslucent navigationBarTranslucent visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableWithoutFeedback onPress={onCancel}>
        <View style={s.overlay} />
      </TouchableWithoutFeedback>
      <View style={s.center} pointerEvents="box-none">
        <HardShadowBox offset={5} radius={rs(24)} style={s.cardWrap}>
          <View style={s.card} accessibilityViewIsModal>
            <Text style={s.title} accessibilityRole="header">{title}</Text>
            <Text style={s.body}>{body}</Text>
            <HardShadowBox offset={3} radius={rs(26)} style={s.confirmWrap}>
              <TouchableOpacity
                style={[s.confirm, danger && s.confirmDanger]}
                onPress={onConfirm}
                activeOpacity={0.85}
                accessibilityRole="button"
                testID="confirm-dialog-ok"
              >
                <Text style={[s.confirmTxt, danger && s.confirmTxtDanger]}>{confirmLabel}</Text>
              </TouchableOpacity>
            </HardShadowBox>
            <TouchableOpacity
              style={s.cancel}
              onPress={onCancel}
              activeOpacity={0.7}
              accessibilityRole="button"
              testID="confirm-dialog-cancel"
            >
              <Text style={s.cancelTxt}>{cancelLabel}</Text>
            </TouchableOpacity>
          </View>
        </HardShadowBox>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,20,20,0.45)' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: rs(24) },
  cardWrap: { width: '100%', maxWidth: 400 },
  card: {
    backgroundColor: JT.background, borderRadius: rs(24), borderWidth: 2, borderColor: JT.ink,
    paddingHorizontal: rs(22), paddingTop: rs(24), paddingBottom: rs(12),
  },
  title: { fontFamily: JT_FONT.head, fontSize: rf(19), lineHeight: rf(24), color: JT.ink },
  body: { marginTop: rs(10), fontFamily: JT_FONT.medium, fontSize: rf(15), lineHeight: rf(21), color: JT.textSecondary },
  confirmWrap: { marginTop: rs(20) },
  confirm: {
    minHeight: rs(52), borderRadius: rs(26), borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: rs(16), paddingVertical: rs(10),
  },
  confirmDanger: { backgroundColor: JT_ERROR },
  confirmTxt: { fontFamily: JT_FONT.heavy, fontSize: rf(16), color: JT.ink, textAlign: 'center' },
  confirmTxtDanger: { color: '#FFFFFF' },
  cancel: { minHeight: rs(48), alignItems: 'center', justifyContent: 'center', marginTop: rs(6) },
  cancelTxt: { fontFamily: JT_FONT.bold, fontSize: rf(15), color: JT.textTertiary },
});
