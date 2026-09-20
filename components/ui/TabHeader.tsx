import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import { NotifBell } from '@/components/ui/NotifBell';
import {
  APP_HEADER_BOTTOM,
  APP_HEADER_GAP,
  APP_HEADER_HORIZONTAL,
  APP_HEADER_TOP,
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
    <View style={h.header}>
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
    </View>
  );
}

// Общие размеры для правого блока (используются и в кастомном right профиля)
export const HEADER_ICON = 22;

const h = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(APP_HEADER_HORIZONTAL),
    paddingTop: rs(APP_HEADER_TOP),
    paddingBottom: rs(APP_HEADER_BOTTOM),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
    backgroundColor: Colors.bg,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: rs(APP_HEADER_GAP), flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: rs(APP_HEADER_GAP) },
  title: { fontSize: rf(18), fontWeight: '800', color: Colors.textPrimary },
});
