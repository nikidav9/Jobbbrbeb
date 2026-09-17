import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';

import { rs, rf } from '@/constants/scale';

type ChipVariant = 'work' | 'time' | 'metro' | 'exp' | 'salary' | 'urgent' | 'date' | 'neutral';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface ChipProps {
  label: string;
  variant?: ChipVariant;
  icon?: IoniconName;
}

const VARIANT_STYLES: Record<ChipVariant, { bg: string; text: string; fontWeight?: string }> = {
  work:   { bg: '#FFF3ED', text: '#FF6B1A' },
  time:   { bg: '#EFF6FF', text: '#2563EB' },
  metro:  { bg: '#EFF6FF', text: '#2563EB' },
  exp:    { bg: '#F0FDF4', text: '#16A34A' },
  salary: { bg: '#FFF3ED', text: '#FF6B1A', fontWeight: '800' },
  urgent: { bg: '#FEF2F2', text: '#DC2626' },
  date:   { bg: '#F5F3FF', text: '#7C3AED' },
  // Спокойный чип для карточек колоды: там их пять-шесть подряд, и
  // разноцветные превращают карточку в светофор. Цветом остаётся только то,
  // ради чего карточку открывают, — деньги.
  neutral: { bg: '#F3F4F6', text: Colors.textSecondary },
};

export function Chip({ label, variant = 'work', icon }: ChipProps) {
  const s = VARIANT_STYLES[variant];
  return (
    <View style={[styles.chip, { backgroundColor: s.bg }]}>
      {icon ? (
        <Ionicons name={icon} size={13} color={s.text} style={{ marginRight: rs(5) }} />
      ) : null}
      {/* Чип всегда в одну строку. Длинный адрес иначе переносится внутри
          чипа, и тот превращается в абзац с закруглениями. */}
      <Text numberOfLines={1} style={[styles.chipText, { color: s.text, fontWeight: (s.fontWeight as any) ?? '600' }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    maxWidth: '100%',
    borderRadius: rs(100),
    paddingHorizontal: rs(13),
    paddingVertical: rs(8),
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipText: {
    fontSize: rf(13),
  },
});
