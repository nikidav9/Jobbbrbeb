import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';

/** Подзаголовок внутри экрана («Ваши навыки», «Часто ищут в IT»). */
export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={s.row}>
      <Text style={s.title} numberOfLines={1}>{children}</Text>
      {right}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  title: { flexShrink: 1, fontFamily: EditFonts.heading, fontSize: 15, color: EditColors.ink },
});
