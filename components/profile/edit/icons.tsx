import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { EditColors } from '@/constants/profileEditTheme';

/**
 * Иконки экранов редактирования профиля — 1:1 с путями из
 * `docs/design/profile-edit/assets/icons/*.svg` (24×24, обводка без заливки).
 * Отдельный набор от `components/profile/icons.tsx`: тот штрих чуть другой
 * (1.9 везде), здесь у каждой иконки своя толщина линии из эталона.
 */
export type EditIconProps = { size?: number; color?: string };

function icon(children: (color: string) => React.ReactNode) {
  function Icon({ size = 20, color = EditColors.ink }: EditIconProps) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {children(color)}
      </Svg>
    );
  }
  return Icon;
}

export const BackIcon = icon((color) => (
  <Path d="M15 6l-6 6l6 6" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
));

export const PlusIcon = icon((color) => (
  <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth={2.8} strokeLinecap="round" />
));

export const CloseIcon = icon((color) => (
  <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={2.8} strokeLinecap="round" />
));

export const CheckIcon = icon((color) => (
  <Path d="M5 12l5 5l9-10" stroke={color} strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" />
));

export const ChevronDownIcon = icon((color) => (
  <Path d="M6 9l6 6l6-6" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
));

export const ChevronRightIcon = icon((color) => (
  <Path d="M9 6l6 6l-6 6" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
));

export const SearchIcon = icon((color) => (
  <>
    <Circle cx={11} cy={11} r={7} stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    <Path d="M20 20l-4-4" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
  </>
));

export const InfoIcon = icon((color) => (
  <>
    <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    <Path d="M12 11v5M12 8h.01" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
  </>
));

export const CalendarIcon = icon((color) => (
  <>
    <Rect x={3} y={5} width={18} height={16} rx={3} stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M3 10h18M8 3v4M16 3v4" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </>
));

export const LockIcon = icon((color) => (
  <>
    <Rect x={5} y={11} width={14} height={10} rx={2} stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M8 11V8a4 4 0 0 1 8 0v3" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </>
));

export const LinkIcon = icon((color) => (
  <>
    <Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" stroke={color} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" stroke={color} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
  </>
));

export const MailIcon = icon((color) => (
  <>
    <Rect x={3} y={5} width={18} height={14} rx={3} stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
    <Path d="M4 7l8 6l8-6" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
  </>
));

export const PhoneIcon = icon((color) => (
  <Path
    d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"
    stroke={color}
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
  />
));

export const PinIcon = icon((color) => (
  <>
    <Path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    <Circle cx={12} cy={9} r={2.5} stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
  </>
));

export const CarIcon = icon((color) => (
  <>
    <Path d="M5 17h14v-4l-2-5H7l-2 5z" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M5 13h14" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    <Circle cx={8} cy={17} r={1.6} stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    <Circle cx={16} cy={17} r={1.6} stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </>
));

export const UploadIcon = icon((color) => (
  <>
    <Path d="M12 15V4M7 9l5-5l5 5" stroke={color} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke={color} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" />
  </>
));
