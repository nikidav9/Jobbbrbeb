import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';

/** Переключатель 52×32: «Есть личный автомобиль» и подобные да/нет-настройки. */
export function Toggle({
  value, onValueChange, label, subtitle,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  label?: string;
  subtitle?: string;
}) {
  const track = (
    <View style={[s.track, value ? s.trackOn : s.trackOff]}>
      <View style={s.thumb} />
    </View>
  );

  if (!label) {
    return (
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => onValueChange(!value)}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
      >
        {track}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={() => onValueChange(!value)}
      style={s.row}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.label}>{label}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
      {track}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  track: {
    flexShrink: 0, width: 52, height: 32, borderRadius: 16, borderWidth: 2, borderColor: EditColors.ink,
    justifyContent: 'center', paddingHorizontal: 3,
  },
  trackOn: { backgroundColor: EditColors.accent, alignItems: 'flex-end' },
  trackOff: { backgroundColor: EditColors.disabledBg, alignItems: 'flex-start' },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: EditColors.surface, borderWidth: 2, borderColor: EditColors.ink },
  label: { fontFamily: EditFonts.text800, fontSize: 15, color: EditColors.ink },
  subtitle: { marginTop: 2, fontFamily: EditFonts.text600, fontSize: 13, color: EditColors.textTertiary },
});
