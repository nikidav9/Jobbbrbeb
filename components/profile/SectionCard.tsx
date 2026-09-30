import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ProfileColors, ProfileFonts, HAIRLINE, ProfileRadius } from '@/constants/profileTheme';
import { EditIcon, PlusIcon } from './icons';

/**
 * Белая карточка-секция резюме: иконка в персиковом квадрате, заголовок,
 * счётчик, круглая кнопка редактирования — «Опыт работы», «Языки», «Навыки».
 * У разделов-списков (образование, курсы…) вместо карандаша «+»: каждая запись
 * открывается своим тапом, а кнопка в шапке добавляет новую.
 */
export function SectionCard({
  icon, title, count, onEdit, onAdd, editLabel, children, gap = 16,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  onEdit?: () => void;
  onAdd?: () => void;
  editLabel?: string;
  children?: React.ReactNode;
  gap?: number;
}) {
  return (
    <View style={s.card}>
      <View style={s.header}>
        <View style={s.iconBox}>{icon}</View>
        <Text style={s.title}>
          {title}
          {count != null ? <Text style={s.count}> {count}</Text> : null}
        </Text>
        {onEdit ? (
          <TouchableOpacity
            onPress={onEdit}
            style={s.editBtn}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={editLabel ?? `Редактировать: ${title}`}
          >
            <EditIcon size={15} color={ProfileColors.ink} />
          </TouchableOpacity>
        ) : null}
        {onAdd ? (
          <TouchableOpacity
            onPress={onAdd}
            style={s.editBtn}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={`Добавить: ${title}`}
          >
            <PlusIcon size={15} color={ProfileColors.ink} />
          </TouchableOpacity>
        ) : null}
      </View>
      {children ? <View style={{ gap }}>{children}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: ProfileColors.surface, borderRadius: ProfileRadius.card,
    padding: 18, gap: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: {
    width: 36, height: 36, borderRadius: ProfileRadius.icon, backgroundColor: ProfileColors.peach,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { flex: 1, fontFamily: ProfileFonts.headingBold, fontSize: 16, color: ProfileColors.ink },
  count: { fontFamily: ProfileFonts.headingBold, fontSize: 16, color: ProfileColors.countText },
  editBtn: {
    width: 34, height: 34, borderRadius: ProfileRadius.pill,
    borderWidth: HAIRLINE, borderColor: ProfileColors.ink, backgroundColor: ProfileColors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
});
