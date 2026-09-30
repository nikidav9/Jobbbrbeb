/**
 * Токены экранов редактирования профиля («карандаш ✎» и «+» в профиле).
 *
 * Источник — `docs/design/profile-edit/README.md` и
 * `docs/design/profile-edit/{resume,personal}/*.html`. Отдельный модуль от
 * `constants/profileTheme.ts`: тот эталон — вкладки профиля целиком (Onest),
 * этот — только 20 экранов редактирования (Manrope), цвета местами совпадают,
 * но не все, и путать источники нельзя.
 */
import { StyleSheet } from 'react-native';

export const EditColors = {
  accent: '#FF6B1A',
  ink: '#141414',
  bg: '#F5EFE6',
  surface: '#FFFFFF',
  accentSoft: '#FFE2CC',
  border: '#CFC4B6',
  borderSoft: '#E3D9CC',
  disabledBg: '#E8DED1',
  disabledText: '#9A9086',
  fieldDisabledBg: '#EFE7DC',
  placeholder: '#9A9086',
  label: '#4A443D',
  textTertiary: '#6B645C',
  danger: '#C2410C',
  overlay: 'rgba(20,20,20,.5)',
};

export const EditFonts = {
  heading: 'Unbounded_700Bold',
  text500: 'Manrope_500Medium',
  text600: 'Manrope_600SemiBold',
  text700: 'Manrope_700Bold',
  text800: 'Manrope_800ExtraBold',
};

export const EditRadius = {
  field: 16,
  chip: 20,
  button: 30,
  sheet: 28,
  card: 18,
  icon: 12,
};

export const editTypography = StyleSheet.create({
  heading: {
    fontFamily: EditFonts.heading,
    fontSize: 20,
    letterSpacing: -0.01 * 20,
    color: EditColors.ink,
  },
  label: {
    fontFamily: EditFonts.text700,
    fontSize: 14,
    color: EditColors.label,
  },
  labelOptional: {
    fontFamily: EditFonts.text600,
    fontSize: 14,
    color: EditColors.textTertiary,
  },
  fieldText: {
    fontFamily: EditFonts.text600,
    fontSize: 16,
    color: EditColors.ink,
  },
});
