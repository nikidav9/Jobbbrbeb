import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';
import { CheckIcon } from './icons';

/** Чекбокс 26×26 со скруглением 8: подтверждения, согласия, множественный выбор. */
export function Checkbox({
  label, checked, onToggle, subtitle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  subtitle?: string;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onToggle}
      style={s.row}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[s.box, checked && s.boxChecked]}>
        {checked ? <CheckIcon size={14} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.label}>{label}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: {
    width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: EditColors.ink,
    backgroundColor: EditColors.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  boxChecked: { backgroundColor: EditColors.accent },
  label: { fontFamily: EditFonts.text700, fontSize: 15, color: EditColors.ink },
  subtitle: { marginTop: 2, fontFamily: EditFonts.text600, fontSize: 13, color: EditColors.textTertiary },
});
