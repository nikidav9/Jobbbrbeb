import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import { NotifBell } from '@/components/ui/NotifBell';
import {
  APP_HEADER_GAP,
  AppHeaderRow,
  BrandLogo,
} from '@/components/ui/BrandLogo';

import { rs, rf } from '@/constants/scale';

// Единая шапка для всех вкладок: одинаковая высота, шрифт и размеры иконок.
// title отсутствует → показываем логотип JobToo. badge — доп. плашка слева
// (например «N ждут»). right — кастомный правый блок (профиль с шестерёнкой).
export function TabHeader({
  title, badge, left, right, primaryAction,
}: {
  title?: string;
  badge?: React.ReactNode;
  left?: React.ReactNode;
  right?: React.ReactNode;
  primaryAction?: React.ReactNode;
}) {
  return (
    <AppHeaderRow borderBottom backgroundColor={Colors.bg}>
      <View style={h.left}>
        {left ?? (title ? (
          <Text style={h.title} numberOfLines={1}>{title}</Text>
        ) : (
          <BrandLogo />
        ))}
        {badge ?? null}
      </View>
      {right ?? (
        <View style={h.right}>
          {primaryAction ?? null}
          <NotifBell />
        </View>
      )}
    </AppHeaderRow>
  );
}

// Общие размеры для правого блока (используются и в кастомном right профиля)
export const HEADER_ICON = 22;

const h = StyleSheet.create({
  left: { flexDirection: 'row', alignItems: 'center', gap: rs(APP_HEADER_GAP), flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: rs(APP_HEADER_GAP) },
  title: { fontSize: rf(18), fontWeight: '800', color: Colors.textPrimary },
});
