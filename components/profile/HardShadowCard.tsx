import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import { ProfileColors, HAIRLINE, ProfileRadius } from '@/constants/profileTheme';

/**
 * Жёсткая тень без размытия: `box-shadow: Npx Npx 0 color` из эталона.
 *
 * На Android `elevation` всегда размыт, а на iOS `shadowRadius: 0` даёт
 * резкий, но не идентичный на обеих платформах результат. Поэтому не тень
 * системы, а подложка — View того же радиуса, сдвинутая на offset и
 * положенная под карточку: выглядит одинаково на iOS, Android и вебе.
 */
export function HardShadowCard({
  children,
  style,
  offset = 4,
  radius = ProfileRadius.card,
  shadowColor = ProfileColors.ink,
  backgroundColor = ProfileColors.surface,
  borderColor = ProfileColors.ink,
  borderWidth = HAIRLINE,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  offset?: number;
  radius?: number;
  shadowColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
}) {
  return (
    <View style={style}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: offset, left: offset, right: -offset, bottom: -offset,
          backgroundColor: shadowColor,
          borderRadius: radius,
        }}
      />
      <View
        style={{
          backgroundColor, borderRadius: radius,
          borderWidth, borderColor,
        }}
      >
        {children}
      </View>
    </View>
  );
}
