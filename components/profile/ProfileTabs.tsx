import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { ProfileColors, ProfileFonts, HAIRLINE, ProfileRadius } from '@/constants/profileTheme';

type ProfileTabKey = 'resume' | 'personal' | 'files' | 'reviews';

const TABS: { key: ProfileTabKey; label: string }[] = [
  { key: 'resume', label: 'Резюме' },
  { key: 'personal', label: 'Личные' },
  { key: 'files', label: 'Файлы' },
  { key: 'reviews', label: 'Отзывы' },
];

/**
 * Табы-пилюли Резюме / Личные / Файлы / Отзывы.
 *
 * На 320–360 px пилюли с надписями впритык не влезают в ряд — заворачиваем
 * в горизонтальную прокрутку (эталон это допускает: «если не влезают —
 * горизонтальная прокрутка табов», решение по объёму задачи 27.09).
 */
export function ProfileTabs({
  value, onChange, filesCount,
}: {
  value: ProfileTabKey;
  onChange: (tab: ProfileTabKey) => void;
  filesCount: number;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.scrollContent}
    >
      {TABS.map(tab => {
        const active = value === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[s.tab, active && s.tabActive]}
            onPress={() => onChange(tab.key)}
            activeOpacity={0.75}
          >
            <Text style={[s.tabText, active && s.tabTextActive]}>{tab.label}</Text>
            {tab.key === 'files' ? (
              <View style={s.badge}>
                <Text style={s.badgeText}>{filesCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scrollContent: { flexGrow: 1, gap: 6, minWidth: '100%' },
  tab: {
    // flexGrow тянет пилюли во всю ширину строки, когда они помещаются
    // (390 px и шире, как в эталоне). flexShrink: 0 — главное: без него flex
    // сжимает пилюли уже их текста, вместо того чтобы пустить лишнее в
    // горизонтальную прокрутку (на 320–360 px из-за этого «Отзывы»
    // превращались в «От…» без всякой прокрутки — контент как бы
    // помещался, просто обрезанный).
    flexGrow: 1, flexShrink: 0, flexBasis: 'auto', minWidth: 78, height: 40, paddingHorizontal: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderWidth: HAIRLINE, borderColor: ProfileColors.ink, borderRadius: ProfileRadius.pill,
    backgroundColor: ProfileColors.surface,
  },
  tabActive: { backgroundColor: ProfileColors.accent },
  tabText: { fontFamily: ProfileFonts.textSemi, fontSize: 13, color: ProfileColors.ink },
  tabTextActive: { fontFamily: ProfileFonts.textBold },
  badge: {
    minWidth: 18, height: 18, borderRadius: ProfileRadius.pill, backgroundColor: ProfileColors.ink,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { fontFamily: ProfileFonts.textBold, fontSize: 10, color: '#FFFFFF' },
});
