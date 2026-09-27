import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ProfileColors, ProfileFonts, HAIRLINE, ProfileRadius } from '@/constants/profileTheme';
import { PlusIcon } from './icons';

/**
 * Строка «добавить» — пустой раздел резюме («Ещё можно добавить») или
 * пункт «Ещё о себе»: иконка, заголовок (+ подпись), оранжевый «+» с
 * жёсткой тенью 2×2.
 */
export function AddRow({
  icon, iconBg = ProfileColors.subtleBg, iconSize = 36,
  title, subtitle, onPress, last, accessibilityLabel,
}: {
  icon: React.ReactNode;
  iconBg?: string;
  iconSize?: number;
  title: string;
  subtitle?: string;
  onPress: () => void;
  last?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <View style={[s.row, !last && s.rowBorder]}>
      <View style={[s.iconBox, { width: iconSize, height: iconSize, borderRadius: iconSize >= 40 ? ProfileRadius.iconLg : ProfileRadius.icon, backgroundColor: iconBg }]}>
        {icon}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={subtitle ? s.titleWithSub : s.title}>{title}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `Добавить: ${title}`}
        style={s.plusWrap}
      >
        <View pointerEvents="none" style={s.plusShadow} />
        <View style={s.plusBtn}>
          <PlusIcon size={16} color={ProfileColors.ink} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const PLUS = 32;

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: ProfileColors.line },
  iconBox: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { fontFamily: ProfileFonts.textSemi, fontSize: 14, color: ProfileColors.ink },
  titleWithSub: { fontFamily: ProfileFonts.textBold, fontSize: 14, color: ProfileColors.ink },
  subtitle: { fontFamily: ProfileFonts.textRegular, fontSize: 12, lineHeight: 17, color: ProfileColors.muted, marginTop: 2 },
  plusWrap: { width: PLUS, height: PLUS, flexShrink: 0 },
  plusShadow: {
    position: 'absolute', top: 2, left: 2, right: -2, bottom: -2,
    backgroundColor: ProfileColors.ink, borderRadius: PLUS / 2,
  },
  plusBtn: {
    width: PLUS, height: PLUS, borderRadius: PLUS / 2, backgroundColor: ProfileColors.accent,
    borderWidth: HAIRLINE, borderColor: ProfileColors.ink, alignItems: 'center', justifyContent: 'center',
  },
});
