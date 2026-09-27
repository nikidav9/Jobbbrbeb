import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ProfileColors, ProfileFonts, HAIRLINE, ProfileRadius } from '@/constants/profileTheme';
import { EditIcon } from './icons';

/**
 * Строка «Личных» и «Контактов»: подпись + значение, круглая кнопка
 * редактирования справа. Пустое значение с `ctaLabel` показывает вместо
 * карандаша оранжевую пилюлю-приглашение («Указать»), как в эталоне —
 * поле «Как к вам обращаться».
 */
export function EditableRow({
  icon, label, value, placeholder = 'Не указано', onEdit, ctaLabel, last, editLabel,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: string;
  placeholder?: string;
  onEdit?: () => void;
  ctaLabel?: string;
  last?: boolean;
  editLabel?: string;
}) {
  const showCta = !!onEdit && !value && !!ctaLabel;
  return (
    <View style={[s.row, !last && s.rowBorder]}>
      {icon ? <View style={s.iconBox}>{icon}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.label}>{label}</Text>
        <Text style={[s.value, !value && s.valueEmpty]} numberOfLines={3}>
          {value || placeholder}
        </Text>
      </View>
      {showCta ? (
        <TouchableOpacity onPress={onEdit} style={s.cta} activeOpacity={0.75}>
          <Text style={s.ctaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      ) : onEdit ? (
        <TouchableOpacity
          onPress={onEdit}
          style={s.editBtn}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel={editLabel ?? `Изменить: ${label}`}
        >
          <EditIcon size={15} color={ProfileColors.ink} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: ProfileColors.line },
  iconBox: {
    width: 36, height: 36, borderRadius: ProfileRadius.icon, backgroundColor: ProfileColors.subtleBg,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  label: { fontFamily: ProfileFonts.textRegular, fontSize: 12, color: ProfileColors.muted },
  value: { fontFamily: ProfileFonts.textSemi, fontSize: 15, color: ProfileColors.ink, marginTop: 2 },
  valueEmpty: { fontFamily: ProfileFonts.textMedium, color: ProfileColors.placeholder },
  editBtn: {
    width: 34, height: 34, borderRadius: ProfileRadius.pill,
    borderWidth: HAIRLINE, borderColor: ProfileColors.ink, backgroundColor: ProfileColors.surface,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cta: {
    height: 34, borderRadius: ProfileRadius.pill, borderWidth: HAIRLINE, borderColor: ProfileColors.ink,
    backgroundColor: ProfileColors.accent, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  ctaText: { fontFamily: ProfileFonts.textBold, fontSize: 13, color: ProfileColors.ink },
});
