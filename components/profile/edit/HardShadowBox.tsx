import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import { EditColors } from '@/constants/profileEditTheme';

/**
 * Жёсткая тень без размытия (`box-shadow: Npx Npx 0 color` в эталоне) —
 * общая подложка для кнопок, полей в фокусе и радио-карточек экранов
 * редактирования. Тот же приём, что `components/profile/HardShadowCard.tsx`:
 * подложка-View, а не `shadow*`/`elevation` — на Android они всегда размыты.
 */
export function HardShadowBox({
  children, style, offset = 4, radius = 16, shadowColor = EditColors.ink,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  offset?: number;
  radius?: number;
  shadowColor?: string;
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
      {children}
    </View>
  );
}
