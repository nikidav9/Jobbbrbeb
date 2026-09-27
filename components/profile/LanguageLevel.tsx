import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ProfileColors, ProfileFonts } from '@/constants/profileTheme';

const CEFR_ORDER = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];

/**
 * Уровень языка → сколько из 6 сегментов шкалы закрашено.
 *
 * Шкала в эталоне — ровно шесть уровней CEFR (A1…C2), «Родной» — все шесть.
 * Свободный текст резюме («A2 — Элементарный», «Родной», иногда просто
 * описание без индекса) разбираем мягко: точного письменного стандарта в
 * PDF-резюме нет, поэтому нераспознанный уровень получает середину шкалы,
 * а не пустую или полную — обе крайности были бы такой же выдумкой.
 */
export function languageSegments(level?: string): number {
  if (!level) return 0;
  const v = level.toLowerCase();
  if (/родн|native/.test(v)) return 6;
  const cefr = v.match(/\b([abc][12])\b/);
  if (cefr) {
    const idx = CEFR_ORDER.indexOf(cefr[1]);
    if (idx >= 0) return idx + 1;
  }
  if (/свободн|fluent|продвинут|advanced|в совершенств/.test(v)) return 5;
  if (/выше среднего|upper/.test(v)) return 4;
  if (/средн|intermediate/.test(v)) return 3;
  if (/ниже среднего|pre-intermediate/.test(v)) return 2;
  if (/начальн|элементарн|beginner|basic/.test(v)) return 1;
  return 3;
}

export function LanguageLevel({
  name, level, last,
}: {
  name: string;
  level?: string;
  last?: boolean;
}) {
  const filled = languageSegments(level);
  return (
    <View>
      <View style={s.row}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.name}>{name}</Text>
          {level ? <Text style={s.level}>{level}</Text> : null}
        </View>
        <View style={s.segments}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={[s.segment, i < filled && s.segmentFilled]} />
          ))}
        </View>
      </View>
      {!last ? <View style={s.divider} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, gap: 10 },
  name: { fontFamily: ProfileFonts.textSemi, fontSize: 15, color: ProfileColors.ink },
  level: { fontFamily: ProfileFonts.textRegular, fontSize: 12, color: ProfileColors.muted, marginTop: 1 },
  segments: { flexDirection: 'row', gap: 3 },
  segment: { width: 14, height: 6, borderRadius: 3, backgroundColor: ProfileColors.line },
  segmentFilled: { backgroundColor: ProfileColors.accent },
  divider: { height: 1, backgroundColor: ProfileColors.line },
});
