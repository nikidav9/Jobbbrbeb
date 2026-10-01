import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BottomSheet } from '@/components/profile/edit';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';

/**
 * «Ответьте один раз» (01.10.2026, решение владельца): после свайпа вправо,
 * пока частые вопросы работодателей не заполнены, — короткая шторка. Ответы
 * Юпитер подставляет в анкеты сам и не останавливает отклик на «нужен человек».
 */
export function ApplyAnswersPrompt({ visible, onAnswer, onLater, onNever }: {
  visible: boolean;
  onAnswer: () => void;
  onLater: () => void;
  onNever: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onLater} title="Ответьте один раз — и Юпитер не будет ждать">
      <View style={s.body}>
        <Text style={s.text}>
          Работодатели часто спрашивают зарплату, дату выхода, Telegram и английский. Ответьте за минуту — Юпитер подставит ответы во все анкеты и не остановится на «нужен человек».
        </Text>
        <TouchableOpacity style={s.primary} onPress={onAnswer} accessibilityRole="button" testID="apply-answers-open">
          <Text style={s.primaryText}>Ответить — 1 минута</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.secondary} onPress={onLater} accessibilityRole="button">
          <Text style={s.secondaryText}>Позже</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onNever} accessibilityRole="button">
          <Text style={s.never}>Больше не спрашивать</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  body: { gap: 12, paddingBottom: 8 },
  text: { fontFamily: EditFonts.text600, fontSize: 15, lineHeight: 21, color: EditColors.textTertiary },
  primary: {
    minHeight: 52, borderRadius: 16, borderWidth: 2, borderColor: EditColors.ink,
    backgroundColor: EditColors.accent, alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { fontFamily: EditFonts.text600, fontSize: 16, color: EditColors.ink },
  secondary: {
    minHeight: 48, borderRadius: 16, borderWidth: 2, borderColor: EditColors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  secondaryText: { fontFamily: EditFonts.text600, fontSize: 15, color: EditColors.ink },
  never: { fontFamily: EditFonts.text600, fontSize: 13, color: EditColors.textTertiary, textAlign: 'center', paddingVertical: 6 },
});
