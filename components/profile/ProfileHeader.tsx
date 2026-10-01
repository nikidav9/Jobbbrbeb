import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { HardShadowCard } from './HardShadowCard';
import { TabLogo, TAB_TOP } from '@/components/ui/TabLogo';
import { HelpIcon, BellIcon, GearIcon, CameraIcon, StarIcon } from './icons';
import {
  ProfileColors, ProfileFonts, HAIRLINE, ProfileRadius,
} from '@/constants/profileTheme';

const CIRCLE_BTN = 40;

function HeaderIconButton({
  onPress, children, accessibilityLabel, hasDot,
}: {
  onPress: () => void;
  children: React.ReactNode;
  accessibilityLabel: string;
  hasDot?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={s.iconBtn}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {children}
      {hasDot ? <View style={s.dot} /> : null}
    </TouchableOpacity>
  );
}

// Верхняя строка профиля: логотип и кнопки «Помощь», «Уведомления»,
// «Настройки». Стоит над прокруткой, а не в ней — как шапки ленты и
// «Откликов» (просьба владельца 01.10.2026); логотип и поля — общие (TAB_TOP).
export function ProfileTopBar({ onHelp, onNotifications, onSettings, hasUnread }: {
  onHelp: () => void;
  onNotifications: () => void;
  onSettings: () => void;
  hasUnread: boolean;
}) {
  return (
    <View style={[TAB_TOP.row, s.topRow]}>
      <TabLogo />
      <View style={s.iconRow}>
        <HeaderIconButton onPress={onHelp} accessibilityLabel="Помощь">
          <HelpIcon size={18} color={ProfileColors.ink} />
        </HeaderIconButton>
        <HeaderIconButton onPress={onNotifications} accessibilityLabel="Уведомления" hasDot={hasUnread}>
          <BellIcon size={18} color={ProfileColors.ink} />
        </HeaderIconButton>
        <HeaderIconButton onPress={onSettings} accessibilityLabel="Настройки">
          <GearIcon size={18} color={ProfileColors.ink} />
        </HeaderIconButton>
      </View>
    </View>
  );
}

export function ProfileHeader({
  name, roleLabel, email, avatarUrl, initials,
  uploading, onAvatarPress,
  ratingAvg, ratingCount, onRatingsPress,
}: {
  name: string;
  roleLabel: string;
  email?: string;
  avatarUrl?: string;
  initials: string;
  uploading: boolean;
  onAvatarPress: () => void;
  ratingAvg: number;
  ratingCount: number;
  onRatingsPress: () => void;
}) {
  return (
    <View style={s.wrap}>
      <View style={s.titleWrap}>
        <Text style={s.title}>Профиль</Text>
        <Text style={s.subtitle}>Так вас видят работодатели</Text>
      </View>

      <HardShadowCard style={s.cardOuter} offset={4} radius={ProfileRadius.card}>
        <View style={s.card}>
          <TouchableOpacity onPress={onAvatarPress} activeOpacity={0.8} style={s.avatarWrap}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={s.avatarImg} contentFit="cover" transition={200} />
            ) : (
              <View style={s.avatarFallback}>
                <Text style={s.avatarInitials}>{initials}</Text>
              </View>
            )}
            {uploading ? (
              <View style={s.avatarOverlay}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            ) : (
              <View style={s.cameraBtn}>
                <CameraIcon size={14} color={ProfileColors.ink} />
              </View>
            )}
          </TouchableOpacity>

          <View style={s.info}>
            <View style={s.nameRow}>
              <Text style={s.name} numberOfLines={1}>{name}</Text>
              <View style={s.roleBadge}>
                <Text style={s.roleText}>{roleLabel}</Text>
              </View>
            </View>
            {email ? <Text style={s.email} numberOfLines={1}>{email}</Text> : null}
            <TouchableOpacity onPress={onRatingsPress} activeOpacity={0.7} style={s.ratingRow}>
              <View style={s.stars}>
                {[1, 2, 3, 4, 5].map(n => (
                  <StarIcon key={n} size={14} color={ratingAvg >= n - 0.5 ? ProfileColors.accent : '#CFC5B7'} />
                ))}
              </View>
              <Text style={s.ratingText}>
                {ratingCount > 0 ? `${ratingAvg.toFixed(1)} (${ratingCount} отз.)` : 'Нет оценок'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </HardShadowCard>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 14 },
  topRow: { justifyContent: 'space-between' },
  iconRow: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: CIRCLE_BTN, height: CIRCLE_BTN, borderRadius: ProfileRadius.pill,
    borderWidth: HAIRLINE, borderColor: ProfileColors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  dot: {
    position: 'absolute', top: 6, right: 7, width: 9, height: 9, borderRadius: 5,
    backgroundColor: ProfileColors.accent, borderWidth: HAIRLINE, borderColor: ProfileColors.bg,
  },
  titleWrap: { gap: 4 },
  title: { fontFamily: ProfileFonts.headingExtra, fontSize: 28, lineHeight: 32, letterSpacing: -0.5, color: ProfileColors.ink },
  subtitle: { fontFamily: ProfileFonts.textRegular, fontSize: 13, color: ProfileColors.muted },
  cardOuter: {},
  card: {
    padding: 16, flexDirection: 'row', gap: 14, alignItems: 'center',
  },
  avatarWrap: { width: 68, height: 68 },
  avatarImg: { width: 68, height: 68, borderRadius: 34, borderWidth: HAIRLINE, borderColor: ProfileColors.ink },
  avatarFallback: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: ProfileColors.peach,
    borderWidth: HAIRLINE, borderColor: ProfileColors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: { fontFamily: ProfileFonts.headingExtra, fontSize: 20, color: ProfileColors.ink },
  avatarOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 34,
    backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center',
  },
  cameraBtn: {
    position: 'absolute', right: -4, bottom: -4, width: 28, height: 28, borderRadius: 14,
    backgroundColor: ProfileColors.accent, borderWidth: HAIRLINE, borderColor: ProfileColors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  info: { flex: 1, minWidth: 0, gap: 5 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontFamily: ProfileFonts.headingBold, fontSize: 16, lineHeight: 19, color: ProfileColors.ink, flexShrink: 1 },
  roleBadge: {
    backgroundColor: ProfileColors.accent, borderWidth: HAIRLINE, borderColor: ProfileColors.ink,
    borderRadius: ProfileRadius.pill, paddingHorizontal: 8, paddingVertical: 1,
  },
  roleText: { fontFamily: ProfileFonts.textBold, fontSize: 11, color: ProfileColors.ink },
  email: { fontFamily: ProfileFonts.textRegular, fontSize: 13, color: ProfileColors.muted },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stars: { flexDirection: 'row', gap: 2 },
  ratingText: { fontFamily: ProfileFonts.textRegular, fontSize: 12, color: ProfileColors.muted },
});
