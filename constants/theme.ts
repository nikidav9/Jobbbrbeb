export const Colors = {
  primary: '#FF6B1A',
  primaryLight: '#FFF3ED',
  primaryBorder: '#FFD4BC',

  bg: '#FFFFFF',
  // Тёплая подложка ленты вакансий. Отдельным токеном, а не подменой bg:
  // тем же bg покрашена сама карточка, и она должна остаться белой — иначе
  // колода сливается с фоном и перестаёт читаться как карточка.
  bgWarm: '#FFF4EC',
  outerBg: '#F5F5F5',
  card: '#FFFFFF',
  divider: '#F3F4F6',
  inputBorder: '#E5E7EB',

  textPrimary: '#111111',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',

  green: '#16A34A',
  greenLight: '#F0FDF4',
  red: '#DC2626',
  redLight: '#FEF2F2',
  blue: '#2563EB',
  blueLight: '#EFF6FF',
  purple: '#7C3AED',
  purpleLight: '#F5F3FF',
  // Звёзды рейтинга: жёлтый смайлик ⭐ рисовала система и на каждом телефоне
  // по-своему, поэтому теперь иконка, а цвет — отсюда.
  amber: '#F59E0B',
  amberLight: '#FFFBEB',

  surface: '#F9FAFB',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 100,
};

export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  strong: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
};
