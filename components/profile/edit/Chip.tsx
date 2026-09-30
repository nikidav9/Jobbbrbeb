import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';
import { PlusIcon, CloseIcon } from './icons';

/** Чип выбора: занятость, формат, уровень языка и т.п. */
export function Chip({
  label, selected, onPress, size = 'md',
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  size?: 'md' | 'sm';
}) {
  const height = size === 'sm' ? 34 : 40;
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={[s.chip, { height, borderRadius: height / 2 }, selected ? s.chipSelected : s.chipDefault]}
    >
      <Text style={[s.text, selected && s.textSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Чип-подсказка «+ добавить»: пунктирный контур, прозрачный фон. */
export function SuggestChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.75} onPress={onPress} style={s.suggest}>
      <PlusIcon size={14} />
      <Text style={s.suggestText}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Чип навыка с кнопкой «×». */
export function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <View style={s.removable}>
      <Text style={s.removableText}>{label}</Text>
      <TouchableOpacity
        onPress={onRemove}
        style={s.removeBtn}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Убрать навык: ${label}`}
      >
        <CloseIcon size={10} />
      </TouchableOpacity>
    </View>
  );
}

/** Обёртка-контейнер для рядов чипов: перенос строк, отступ 8. */
export function ChipGroup({ children }: { children?: React.ReactNode }) {
  return <View style={s.group}>{children}</View>;
}

const s = StyleSheet.create({
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  chipDefault: { borderWidth: 1.5, borderColor: EditColors.border, backgroundColor: EditColors.surface },
  chipSelected: { borderWidth: 2, borderColor: EditColors.ink, backgroundColor: EditColors.accent },
  text: { fontFamily: EditFonts.text700, fontSize: 15, color: EditColors.ink },
  textSelected: { fontFamily: EditFonts.text800 },
  suggest: {
    height: 36, paddingLeft: 10, paddingRight: 14, borderRadius: 18,
    borderWidth: 1.5, borderColor: EditColors.textTertiary, borderStyle: 'dashed',
    backgroundColor: 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  suggestText: { fontFamily: EditFonts.text700, fontSize: 14, color: EditColors.ink },
  removable: {
    height: 36, paddingLeft: 14, paddingRight: 8, borderRadius: 18,
    borderWidth: 2, borderColor: EditColors.ink, backgroundColor: EditColors.surface,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  removableText: { fontFamily: EditFonts.text700, fontSize: 14, color: EditColors.ink },
  removeBtn: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: EditColors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
});
