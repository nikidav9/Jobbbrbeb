import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { HardShadowCard } from './HardShadowCard';
import { CheckIcon, EyeIcon, TrashIcon } from './icons';
import { ProfileColors, ProfileFonts, HAIRLINE, ProfileRadius } from '@/constants/profileTheme';

/** Карточка PDF в «Сейфе резюме» — активная (с жёсткой тенью) или другая версия. */
export function ResumeFileCard({
  active, fileName, meta, onOpen, onSelect, onDelete, busy,
}: {
  active: boolean;
  fileName: string;
  meta: string;
  onOpen: () => void;
  onSelect?: () => void;
  onDelete?: () => void;
  busy?: boolean;
}) {
  const body = (
    <View style={s.inner}>
      <View style={s.top}>
        <View style={[s.pdfIcon, active ? s.pdfIconActive : s.pdfIconMuted]}>
          {busy ? (
            <ActivityIndicator size="small" color={active ? ProfileColors.ink : ProfileColors.muted} />
          ) : (
            <Text style={[s.pdfText, !active && s.pdfTextMuted]}>PDF</Text>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          {active ? (
            <View style={s.activePill}>
              <CheckIcon size={12} color="#FFFFFF" />
              <Text style={s.activePillText}>Активное</Text>
            </View>
          ) : null}
          <Text style={s.name} numberOfLines={2}>{fileName}</Text>
          {meta ? <Text style={s.meta} numberOfLines={1}>{meta}</Text> : null}
        </View>
      </View>

      {active ? (
        <TouchableOpacity style={s.previewBtn} onPress={onOpen} disabled={busy} activeOpacity={0.78}>
          <EyeIcon size={17} color={ProfileColors.ink} />
          <Text style={s.previewText}>Посмотреть PDF</Text>
        </TouchableOpacity>
      ) : (
        <View style={s.actionsRow}>
          <TouchableOpacity style={s.selectBtn} onPress={onSelect} disabled={busy} activeOpacity={0.78}>
            <Text style={s.selectText}>Сделать активным</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.squareBtn} onPress={onOpen} disabled={busy} activeOpacity={0.78}
            accessibilityRole="button" accessibilityLabel="Посмотреть PDF"
          >
            <EyeIcon size={17} color={ProfileColors.ink} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.squareBtn} onPress={onDelete} disabled={busy} activeOpacity={0.78}
            accessibilityRole="button" accessibilityLabel="Удалить резюме"
          >
            <TrashIcon size={17} color={ProfileColors.danger} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  if (active) {
    return (
      <HardShadowCard shadowColor={ProfileColors.accent} radius={ProfileRadius.card} offset={4}>
        {body}
      </HardShadowCard>
    );
  }
  return <View style={s.plainCard}>{body}</View>;
}

const s = StyleSheet.create({
  plainCard: { backgroundColor: ProfileColors.surface, borderRadius: ProfileRadius.card },
  inner: { padding: 16, gap: 14 },
  top: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  pdfIcon: {
    width: 48, height: 58, borderRadius: ProfileRadius.icon, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  pdfIconActive: { backgroundColor: ProfileColors.peach, borderWidth: HAIRLINE, borderColor: ProfileColors.ink },
  pdfIconMuted: { backgroundColor: ProfileColors.bg, borderWidth: HAIRLINE, borderColor: ProfileColors.chipBorder },
  pdfText: { fontFamily: ProfileFonts.headingExtra, fontSize: 11, color: ProfileColors.ink },
  pdfTextMuted: { color: ProfileColors.muted },
  activePill: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: ProfileColors.ink, borderRadius: ProfileRadius.pill, paddingHorizontal: 9, paddingVertical: 3,
  },
  activePillText: { fontFamily: ProfileFonts.textBold, fontSize: 11, color: '#FFFFFF' },
  name: { fontFamily: ProfileFonts.textBold, fontSize: 14, lineHeight: 19, color: ProfileColors.ink },
  meta: { fontFamily: ProfileFonts.textRegular, fontSize: 12, color: ProfileColors.muted },
  previewBtn: {
    height: 44, borderWidth: HAIRLINE, borderColor: ProfileColors.ink, borderRadius: ProfileRadius.pill,
    backgroundColor: ProfileColors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  previewText: { fontFamily: ProfileFonts.textSemi, fontSize: 14, color: ProfileColors.ink },
  actionsRow: { flexDirection: 'row', gap: 8 },
  selectBtn: {
    flex: 1, height: 44, borderWidth: HAIRLINE, borderColor: ProfileColors.ink, borderRadius: ProfileRadius.pill,
    backgroundColor: ProfileColors.surface, alignItems: 'center', justifyContent: 'center',
  },
  selectText: { fontFamily: ProfileFonts.textBold, fontSize: 14, color: ProfileColors.ink },
  squareBtn: {
    width: 44, height: 44, borderWidth: HAIRLINE, borderColor: ProfileColors.ink, borderRadius: ProfileRadius.pill,
    backgroundColor: ProfileColors.surface, alignItems: 'center', justifyContent: 'center',
  },
});
