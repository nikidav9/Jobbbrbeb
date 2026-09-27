import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ProfileColors, ProfileFonts, ProfileRadius } from '@/constants/profileTheme';

/** Пустое состояние с иллюстрацией — вкладка «Отзывы» без оценок. */
export function EmptyState({
  illustration, title, subtitle, progress,
}: {
  illustration: React.ReactNode;
  title: string;
  subtitle: string;
  progress?: { segments: number; filled: number; label: string; value: string };
}) {
  return (
    <View style={s.card}>
      {illustration}
      <Text style={s.title}>{title}</Text>
      <Text style={s.subtitle}>{subtitle}</Text>
      {progress ? (
        <View style={s.progressWrap}>
          <View style={s.progressBar}>
            {Array.from({ length: progress.segments }).map((_, i) => (
              <View key={i} style={[s.progressSeg, i < progress.filled && s.progressSegFilled]} />
            ))}
          </View>
          <View style={s.progressRow}>
            <Text style={s.progressLabel}>{progress.label}</Text>
            <Text style={s.progressValue}>{progress.value}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: ProfileColors.surface, borderRadius: ProfileRadius.card,
    paddingVertical: 24, paddingHorizontal: 20, alignItems: 'center', gap: 12,
  },
  title: {
    fontFamily: ProfileFonts.headingExtra, fontSize: 19, lineHeight: 24, color: ProfileColors.ink,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: ProfileFonts.textRegular, fontSize: 14, lineHeight: 20, color: ProfileColors.muted,
    textAlign: 'center', maxWidth: 290,
  },
  progressWrap: { width: '100%', gap: 8, marginTop: 6 },
  progressBar: { flexDirection: 'row', gap: 6 },
  progressSeg: { flex: 1, height: 8, borderRadius: 4, backgroundColor: ProfileColors.line },
  progressSegFilled: { backgroundColor: ProfileColors.accent },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { fontFamily: ProfileFonts.textSemi, fontSize: 12, color: ProfileColors.muted },
  progressValue: { fontFamily: ProfileFonts.textBold, fontSize: 12, color: ProfileColors.ink },
});
