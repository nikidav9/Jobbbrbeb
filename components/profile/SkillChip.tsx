import React from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { ProfileColors, ProfileFonts, HAIRLINE, ProfileRadius } from '@/constants/profileTheme';

export type ChipTone = 'default' | 'accent' | 'muted';

/**
 * Чип-пилюля: навык, «+N ещё», условие работы (активное/неактивное).
 * Три оттенка эталона — см. `docs/design/profile/screens/1-profile-resume.html`
 * (навыки) и `2-profile-personal.html` (условия работы).
 */
export function SkillChip({ label, tone = 'default', onPress }: { label: string; tone?: ChipTone; onPress?: () => void }) {
  const style = [s.chip, tone === 'accent' && s.accent, tone === 'muted' && s.muted];
  const textStyle = [s.text, tone === 'accent' && s.textAccent, tone === 'muted' && s.textMuted];
  if (onPress) {
    return (
      <TouchableOpacity style={style} onPress={onPress} activeOpacity={0.75}>
        <Text style={textStyle}>{label}</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={style}>
      <Text style={textStyle}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  chip: {
    borderWidth: HAIRLINE, borderColor: ProfileColors.ink, borderRadius: ProfileRadius.chip,
    paddingHorizontal: 11, paddingVertical: 6, backgroundColor: ProfileColors.surface,
  },
  accent: { backgroundColor: ProfileColors.accent },
  muted: { borderColor: ProfileColors.chipBorder },
  text: { fontFamily: ProfileFonts.textSemi, fontSize: 12.5, color: ProfileColors.ink },
  textAccent: { fontFamily: ProfileFonts.textBold },
  textMuted: { fontFamily: ProfileFonts.textSemi, color: ProfileColors.muted },
});
