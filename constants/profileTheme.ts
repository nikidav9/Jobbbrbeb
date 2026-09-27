/**
 * Токены нового дизайна вкладки «Профиль» соискателя.
 *
 * Источник — `docs/design/profile/README.md` и `docs/design/profile/screens/*.html`
 * (решение владельца 27.09: «смотри исключительно на этот дизайн»). Отдельный
 * модуль, а не правка `constants/theme`: остальные экраны приложения в этот
 * дизайн не переезжают, и их токены трогать нельзя.
 */
import { StyleSheet, ViewStyle } from 'react-native';

export const ProfileColors = {
  bg: '#F4EEE5',
  surface: '#FFFFFF',
  ink: '#151413',
  accent: '#FF6A1F',
  peach: '#FFE2CC',
  muted: '#756E66',
  mutedDark: '#5E554C',
  line: '#EFE8DD',
  chipBorder: '#E2D8CA',
  placeholder: '#9A9187',
  countText: '#9A9187',
  subtleBg: '#F4EEE5',
  danger: '#C2410C',
};

export const ProfileFonts = {
  headingSemi: 'Unbounded_600SemiBold',
  headingBold: 'Unbounded_700Bold',
  headingExtra: 'Unbounded_800ExtraBold',
  textRegular: 'Onest_400Regular',
  textMedium: 'Onest_500Medium',
  textSemi: 'Onest_600SemiBold',
  textBold: 'Onest_700Bold',
};

export const ProfileRadius = {
  card: 20,
  cardSmall: 14,
  pill: 999,
  chip: 999,
  icon: 10,
  iconLg: 12,
};

/** Ширина обводки фирменных карточек и кнопок-пилюль. */
export const HAIRLINE = 1.5;

/**
 * Жёсткая тень без размытия — `box-shadow: Npx Npx 0 color` в HTML-эталоне.
 *
 * shadow* в RN на Android не умеет резкую тень без blur (elevation всегда
 * размыт), поэтому это не стиль, а геометрия для HardShadow — подложки-View
 * со сдвигом позади карточки. Одинаково выглядит на iOS, Android и вебе,
 * потому что нигде не использует нативный движок теней.
 */
export const HardShadowOffset = {
  sm: 2,
  md: 3,
  lg: 4,
};

/** Общий стиль для белых карточек-секций без тени и обводки. */
export const cardBase: ViewStyle = {
  backgroundColor: ProfileColors.surface,
  borderRadius: ProfileRadius.card,
};

export const profileTypography = StyleSheet.create({
  h1: {
    fontFamily: ProfileFonts.headingExtra,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: ProfileColors.ink,
  },
  h2: {
    fontFamily: ProfileFonts.headingExtra,
    fontSize: 21,
    lineHeight: 25,
    letterSpacing: -0.3,
    color: ProfileColors.ink,
  },
  h3: {
    fontFamily: ProfileFonts.headingBold,
    fontSize: 16,
    color: ProfileColors.ink,
  },
  eyebrow: {
    fontFamily: ProfileFonts.textBold,
    fontSize: 11,
    letterSpacing: 0.08 * 11,
    color: ProfileColors.muted,
    textTransform: 'uppercase',
  },
});
