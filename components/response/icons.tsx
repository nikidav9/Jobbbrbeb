import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { EditColors } from '@/constants/profileEditTheme';

/**
 * Иконки экрана «Отклик» — 1:1 с путями из
 * `docs/design/response-status/assets/icons/*.svg` (24×24, обводка без заливки).
 * Стрелка «назад» и крестик — из `components/profile/edit/icons.tsx`.
 * Толщина линии у иконки своя в разных местах макета, поэтому её можно задать.
 */
type ResponseIconProps = { size?: number; color?: string; strokeWidth?: number };

function icon(defaultSize: number, defaultStroke: number, children: (color: string) => React.ReactNode) {
  function Icon({ size = defaultSize, color = EditColors.ink, strokeWidth = defaultStroke }: ResponseIconProps) {
    return (
      <Svg
        width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      >
        {children(color)}
      </Svg>
    );
  }
  return Icon;
}

export const HandIcon = icon(15, 2.4, () => (
  <Path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7c-2.5 0-4-1.5-5.5-4l-1.8-3.2a1.5 1.5 0 0 1 2.6-1.5L8 14" />
));

export const ClockIcon = icon(19, 2.3, () => (
  <>
    <Circle cx={12} cy={12} r={8} />
    <Path d="M12 8v4l3 2" />
  </>
));

export const CheckMarkIcon = icon(18, 3, () => <Path d="M5 12l5 5l9-10" />);

export const ExternalLinkIcon = icon(14, 2.8, () => <Path d="M7 17L17 7M9 7h8v8" />);

export const LockIcon = icon(14, 2.6, () => (
  <>
    <Rect x={5} y={11} width={14} height={10} rx={2} />
    <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>
));

export const SendIcon = icon(18, 2.6, () => (
  <>
    <Path d="M21 3L3 11l7 3l3 7z" />
    <Path d="M10 14L21 3" />
  </>
));

export const ShieldCheckIcon = icon(22, 2, () => (
  <>
    <Path d="M12 3l8 3v6c0 4.5-3.4 8-8 9c-4.6-1-8-4.5-8-9V6z" />
    <Path d="M9 12l2 2l4-4" />
  </>
));
