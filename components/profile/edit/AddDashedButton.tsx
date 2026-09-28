import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';
import { PlusIcon } from './icons';

/** Кнопка «+ Добавить …» внутри экрана: пунктирный контур, прозрачный фон. */
export function AddDashedButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.75} onPress={onPress} style={s.btn}>
      <PlusIcon size={18} />
      <Text style={s.text}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  btn: {
    height: 56, borderRadius: 18, borderWidth: 2, borderColor: EditColors.ink, borderStyle: 'dashed',
    backgroundColor: 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  text: { fontFamily: EditFonts.text800, fontSize: 16, color: EditColors.ink },
});
