import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';

/** Подпись поля: «Должность», «Email · необязательно». */
export function FieldLabel({ label, optional }: { label: string; optional?: boolean }) {
  return (
    <Text style={s.label}>
      {label}
      {optional ? <Text style={s.optional}> · необязательно</Text> : null}
    </Text>
  );
}

const s = StyleSheet.create({
  label: { fontFamily: EditFonts.text700, fontSize: 14, color: EditColors.label },
  optional: { fontFamily: EditFonts.text600, color: EditColors.textTertiary },
});
