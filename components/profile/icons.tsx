import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { ProfileColors } from '@/constants/profileTheme';

/**
 * Линейные иконки нового дизайна профиля — 1:1 с путями из
 * `docs/design/profile/screens/*.html` (класс `.i`: stroke 1.9, скруглённые
 * концы, без заливки). Ionicons такого штриха не даёт, поэтому отдельный
 * набор на react-native-svg (уже в сборке, нативного кода не добавляет).
 */

type ProfileIconProps = { size?: number; color?: string };

type Shape =
  | { type: 'path'; d: string }
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'rect'; x: number; y: number; width: number; height: number; rx?: number };

function StrokeIcon({
  shapes, size = 18, color = ProfileColors.ink, strokeWidth = 1.9,
}: ProfileIconProps & { shapes: Shape[]; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {shapes.map((shape, i) => {
        const common = {
          fill: 'none' as const,
          stroke: color,
          strokeWidth,
          strokeLinecap: 'round' as const,
          strokeLinejoin: 'round' as const,
        };
        if (shape.type === 'path') return <Path key={i} {...common} d={shape.d} />;
        if (shape.type === 'circle') return <Circle key={i} {...common} cx={shape.cx} cy={shape.cy} r={shape.r} />;
        return <Rect key={i} {...common} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />;
      })}
    </Svg>
  );
}

function icon(shapes: Shape[], strokeWidth?: number) {
  function Icon(props: ProfileIconProps) {
    return <StrokeIcon shapes={shapes} strokeWidth={strokeWidth} {...props} />;
  }
  return Icon;
}

export const HelpIcon = icon([
  { type: 'circle', cx: 12, cy: 12, r: 9 },
  { type: 'path', d: 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14' },
  { type: 'path', d: 'M12 17h.01' },
]);

export const BellIcon = icon([
  { type: 'path', d: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9' },
  { type: 'path', d: 'M10.3 21a1.9 1.9 0 0 0 3.4 0' },
]);

export const GearIcon = icon([
  { type: 'circle', cx: 12, cy: 12, r: 3 },
  { type: 'path', d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' },
]);

export const CameraIcon = icon([
  { type: 'path', d: 'M4 8h3l2-3h6l2 3h3v11H4z' },
  { type: 'circle', cx: 12, cy: 13, r: 3.5 },
]);

export const EditIcon = icon([
  { type: 'path', d: 'M4 20h4L19 9l-4-4L4 16z' },
  { type: 'path', d: 'M13.5 6.5l4 4' },
]);

export const UploadIcon = icon([
  { type: 'path', d: 'M12 16V4M7 9l5-5 5 5' },
  { type: 'path', d: 'M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' },
]);

export const PlusIcon = icon([
  { type: 'path', d: 'M12 5v14M5 12h14' },
]);

export const ChevronRightIcon = icon([
  { type: 'path', d: 'M9 6l6 6-6 6' },
]);

export const BriefcaseIcon = icon([
  { type: 'rect', x: 3, y: 7, width: 18, height: 13, rx: 2 },
  { type: 'path', d: 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18' },
]);

export const GlobeIcon = icon([
  { type: 'circle', cx: 12, cy: 12, r: 9 },
  { type: 'path', d: 'M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18' },
]);

/** Заполненная звезда-искра (иконка «Навыки»): заливка accent, обводка ink. */
export function SparkleSkillIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z"
        fill={ProfileColors.accent}
        stroke={ProfileColors.ink}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export const GradCapIcon = icon([
  { type: 'path', d: 'M2 9l10-5 10 5-10 5z' },
  { type: 'path', d: 'M6 11v5c3 2 9 2 12 0v-5' },
]);

export const ExamIcon = icon([
  { type: 'rect', x: 5, y: 4, width: 14, height: 17, rx: 2 },
  { type: 'path', d: 'M9 4h6v3H9zM9 13l2 2 4-4' },
]);

export const CertIcon = icon([
  { type: 'circle', cx: 12, cy: 9, r: 6 },
  { type: 'path', d: 'M8.5 14l-1.5 7 5-3 5 3-1.5-7' },
]);

export const CourseIcon = icon([
  { type: 'path', d: 'M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z' },
  { type: 'path', d: 'M4 19V5' },
]);

export const StarIcon = icon([
  { type: 'path', d: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z' },
]);

export const HeartIcon = icon([
  { type: 'path', d: 'M12 20s-8-4.8-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.2 12 20 12 20z' },
]);

export const MailIcon = icon([
  { type: 'rect', x: 3, y: 5, width: 18, height: 14, rx: 2 },
  { type: 'path', d: 'M3 7l9 6 9-6' },
]);

export const BookmarkIcon = icon([
  { type: 'path', d: 'M6 4h12v17l-6-4-6 4z' },
]);

export const SearchIcon = icon([
  { type: 'circle', cx: 11, cy: 11, r: 6.5 },
  { type: 'path', d: 'M16 16l4.5 4.5' },
]);

export const PhoneIcon = icon([
  { type: 'path', d: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z' },
]);

export const LockIcon = icon([
  { type: 'rect', x: 5, y: 11, width: 14, height: 10, rx: 2 },
  { type: 'path', d: 'M8 11V8a4 4 0 0 1 8 0v3' },
]);

export const LinkIcon = icon([
  { type: 'path', d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1' },
  { type: 'path', d: 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' },
]);

export const PinIcon = icon([
  { type: 'path', d: 'M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z' },
  { type: 'circle', cx: 12, cy: 10, r: 2.5 },
]);

export const CarIcon = icon([
  { type: 'path', d: 'M4 17V12l2.5-5h11l2.5 5v5z' },
  { type: 'circle', cx: 8, cy: 17, r: 1.8 },
  { type: 'circle', cx: 16, cy: 17, r: 1.8 },
  { type: 'path', d: 'M4 12h16' },
]);

export const ShieldIcon = icon([
  { type: 'path', d: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z' },
  { type: 'path', d: 'M12 8v5M12 16h.01' },
]);

export const EyeIcon = icon([
  { type: 'path', d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z' },
  { type: 'circle', cx: 12, cy: 12, r: 3 },
]);

export const TrashIcon = icon([
  { type: 'path', d: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13' },
]);

export const CheckIcon = icon([
  { type: 'path', d: 'M5 12l5 5 9-10' },
], 3);

export const DocPageIcon = icon([
  { type: 'path', d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' },
  { type: 'path', d: 'M14 3v5h5' },
]);
