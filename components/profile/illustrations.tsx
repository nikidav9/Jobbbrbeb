import React from 'react';
import Svg, { Circle, Rect, Path, G, Polygon } from 'react-native-svg';
import { ProfileColors } from '@/constants/profileTheme';

/**
 * Иллюстрации из эталона (`docs/design/profile/screens/3-profile-files.html`,
 * `4-profile-reviews.html`) — перенесены в react-native-svg 1:1 по координатам.
 */

const { ink, accent, peach, chipBorder } = {
  ink: ProfileColors.ink,
  accent: ProfileColors.accent,
  peach: ProfileColors.peach,
  chipBorder: ProfileColors.chipBorder,
};

/** «Сейф резюме» — вкладка «Файлы». */
export function SafeIllustration({ size = 76 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 76 76">
      <Circle cx={38} cy={40} r={34} fill={peach} />
      <Rect x={24} y={14} width={32} height={42} rx={5} fill="#FFFFFF" stroke={ink} strokeWidth={2.2} transform="rotate(8 40 35)" />
      <Rect x={16} y={20} width={32} height={42} rx={5} fill="#FFFFFF" stroke={ink} strokeWidth={2.2} />
      <Rect x={22} y={28} width={14} height={6} rx={3} fill={accent} />
      <Rect x={22} y={39} width={20} height={4} rx={2} fill={ink} />
      <Rect x={22} y={47} width={13} height={4} rx={2} fill={chipBorder} />
      <Circle cx={52} cy={56} r={10} fill={accent} stroke={ink} strokeWidth={2.2} />
      <Path d="M47.5 56l3 3 5-6" fill="none" stroke={ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const starPoints = '0,-11 2.7,-3.72 10.46,-3.4 4.37,1.42 6.47,8.9 0,4.6 -6.47,8.9 -4.37,1.42 -10.46,-3.4 -2.7,-3.72';

/** «Рейтинг ещё не считается» — пустое состояние вкладки «Отзывы». */
export function ReviewsEmptyIllustration({ width = 200, height = 140 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 200 150">
      <Circle cx={100} cy={78} r={64} fill={peach} />
      <G transform="rotate(-6 100 75)">
        <Rect x={48} y={40} width={104} height={70} rx={12} fill="#FFFFFF" stroke={ink} strokeWidth={3} />
        <Polygon transform="translate(74 64)" points={starPoints} fill={accent} stroke={ink} strokeWidth={2.2} strokeLinejoin="round" />
        <Polygon transform="translate(100 64)" points={starPoints} fill="#FFFFFF" stroke={ink} strokeWidth={2.2} strokeLinejoin="round" />
        <Polygon transform="translate(126 64)" points={starPoints} fill="#FFFFFF" stroke={ink} strokeWidth={2.2} strokeLinejoin="round" />
        <Rect x={64} y={84} width={72} height={7} rx={3.5} fill={ink} />
        <Rect x={64} y={96} width={44} height={7} rx={3.5} fill={chipBorder} />
      </G>
      <Circle cx={152} cy={110} r={20} fill={ink} />
      <Path
        d="M145 100h14M145 120h14M147 100c0 6 10 8 10 10s-10 4-10 10M157 100c0 6-10 8-10 10s10 4 10 10"
        stroke="#FFFFFF" strokeWidth={2.2} fill="none" strokeLinecap="round"
      />
      <Path transform="translate(40 36)" d="M0 -12 L3 -3 L12 0 L3 3 L0 12 L-3 3 L-12 0 L-3 -3Z" fill={accent} stroke={ink} strokeWidth={2} strokeLinejoin="round" />
      <Path d="M162 30l6-6M168 40h8M36 118h-8" stroke={ink} strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
  );
}
