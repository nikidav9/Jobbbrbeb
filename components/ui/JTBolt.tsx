/**
 * Молния счётчика откликов — 1:1 с доской «Лента вакансий» (холст «JT —
 * стартовый экран»): путь `M14 2L4 14h7l-2 8l10-12h-7z`, оранжевая заливка и
 * чёрный контур 1.8. У Ionicons `flash` другой силуэт и нет контура.
 * react-native-svg уже в сборке — нативного кода не добавляет.
 */
import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { JT } from '@/constants/jt';

export function JTBolt({ size = 20, fill = JT.accent }: { size?: number; fill?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M14 2L4 14h7l-2 8l10-12h-7z" fill={fill} stroke={JT.ink} strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
  );
}
