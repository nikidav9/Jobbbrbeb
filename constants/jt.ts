/**
 * Токены макета владельца «JT-design» (27.09.2026, README макета).
 * Один источник для первого экрана, ленты, «Откликов» и нижнего меню —
 * второй набор тех же цветов разошёлся бы с первым через месяц.
 */
export const JT = {
  accent: '#FF6B1A',
  ink: '#141414',
  background: '#F5EFE6',
  surface: '#FFFFFF',
  accentSoft: '#FFE2CC',
  stack1: '#F1E9DE',
  stack2: '#E8DED1',
  borderSoft: '#CFC4B6',
  muted: '#D9CFC2',
  textSecondary: '#5C554D',
  textTertiary: '#6B645C',
  textBody: '#4A443D',
} as const;

// Имена совпадают с ключами useFonts в app/_layout.tsx.
export const JT_FONT = {
  head: 'Unbounded-700',
  medium: 'Manrope-500',
  // 600 своего файла не имеет — то же начертание из @expo-google-fonts.
  semi: 'Manrope_600SemiBold',
  bold: 'Manrope-700',
  heavy: 'Manrope-800',
} as const;
