import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { EditColors, EditFonts, EditRadius } from '@/constants/profileEditTheme';

/** Радио-карточка: выбрана — белая, контур 2 + жёсткая тень 4, точка `accent`. */
export function RadioCard({
  title, subtitle, selected, onPress,
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <View style={selected ? s.wrapSelected : undefined}>
      {selected ? <View pointerEvents="none" style={s.shadowBacking} /> : null}
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={onPress}
        style={[s.card, selected ? s.cardSelected : s.cardDefault]}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
      >
        <View style={[s.dot, selected && s.dotSelected]}>
          {selected ? <View style={s.dotInner} /> : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title}>{title}</Text>
          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        </View>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrapSelected: {},
  shadowBacking: {
    position: 'absolute', top: 4, left: 4, right: -4, bottom: -4,
    backgroundColor: EditColors.ink, borderRadius: EditRadius.card,
  },
  card: {
    height: 56, paddingHorizontal: 14, borderRadius: EditRadius.card,
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: EditColors.surface,
  },
  cardDefault: { borderWidth: 1.5, borderColor: EditColors.borderSoft },
  cardSelected: { borderWidth: 2, borderColor: EditColors.ink },
  dot: {
    flexShrink: 0, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: EditColors.ink,
    backgroundColor: EditColors.surface, alignItems: 'center', justifyContent: 'center',
  },
  dotSelected: {},
  dotInner: { width: 11, height: 11, borderRadius: 6, backgroundColor: EditColors.accent },
  title: { fontFamily: EditFonts.text800, fontSize: 15, color: EditColors.ink },
  subtitle: { marginTop: 2, fontFamily: EditFonts.text600, fontSize: 13, color: EditColors.textTertiary },
});
