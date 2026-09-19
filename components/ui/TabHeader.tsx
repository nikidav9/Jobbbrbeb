import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import { NotifBell } from '@/components/ui/NotifBell';

import { rs, rf } from '@/constants/scale';

// Единая шапка для всех вкладок: одинаковая высота, шрифт и размеры иконок.
// title отсутствует → показываем логотип JobToo. badge — доп. плашка слева
// (например «N ждут»). right — кастомный правый блок (профиль с шестерёнкой).
export function TabHeader({
  title, badge, right, primaryAction,
}: {
  title?: string;
  badge?: React.ReactNode;
  right?: React.ReactNode;
  primaryAction?: React.ReactNode;
}) {
  return (
    <View style={h.header}>
      <View style={h.left}>
        {title ? (
          <Text style={h.title} numberOfLines={1}>{title}</Text>
        ) : (
          <Text style={h.logo}>
            <Text style={h.logoB}>Job</Text>
            <Text style={h.logoO}>Too</Text>
          </Text>
        )}
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
    paddingHorizontal: rs(16), paddingTop: rs(14), paddingBottom: rs(12),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
    backgroundColor: Colors.bg,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: rs(8), flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: rs(6) },
  title: { fontSize: rf(18), fontWeight: '800', color: Colors.textPrimary },
  logo: { fontSize: rf(18) },
  logoB: { fontWeight: '800', color: Colors.textPrimary },
  logoO: { fontWeight: '800', color: Colors.primary },
});
