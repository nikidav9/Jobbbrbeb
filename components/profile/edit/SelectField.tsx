import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';
import { FieldLabel } from './FieldLabel';
import { ChevronDownIcon } from './icons';

/** Поле-выбор: как `Field`, но открывает шторку/пикер вместо клавиатуры. */
export function SelectField({
  label, optional, value, placeholder, onPress, disabled,
}: {
  label?: string;
  optional?: boolean;
  value?: string;
  placeholder: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const filled = !!value;
  return (
    <View style={{ gap: 8 }}>
      {label ? <FieldLabel label={label} optional={optional} /> : null}
      <TouchableOpacity
        activeOpacity={0.75}
        disabled={disabled}
        onPress={onPress}
        style={[s.box, filled && s.filled, disabled && s.disabled]}
      >
        <Text style={[s.text, !filled && s.placeholder, disabled && s.textDisabled]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <ChevronDownIcon size={18} color={disabled ? EditColors.textTertiary : EditColors.ink} />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    height: 56, borderRadius: EditRadius.field, paddingHorizontal: 16,
    borderWidth: 1.5, borderColor: EditColors.border, backgroundColor: EditColors.surface,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
  filled: { borderWidth: 2, borderColor: EditColors.ink },
  disabled: { backgroundColor: EditColors.fieldDisabledBg, borderWidth: 1.5, borderColor: EditColors.borderSoft },
  text: { flex: 1, minWidth: 0, fontFamily: EditFonts.text700, fontSize: 16, color: EditColors.ink },
  placeholder: { fontFamily: EditFonts.text600, color: EditColors.placeholder },
  textDisabled: { color: EditColors.textTertiary },
});
