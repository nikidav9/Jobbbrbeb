import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';
import { InfoIcon } from './icons';

/** Белая плашка-подсказка с иконкой (i) — пояснение под полем или блоком. */
export function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.box}>
      <InfoIcon size={20} color={EditColors.textTertiary} />
      <Text style={s.text}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, backgroundColor: EditColors.surface,
  },
  text: { flex: 1, fontFamily: EditFonts.text600, fontSize: 13, lineHeight: 19, color: EditColors.label },
});
