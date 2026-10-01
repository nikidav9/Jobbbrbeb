import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { WorkType } from '@/constants/types';

import { rs, rf } from '@/constants/scale';

import { JT_FONT } from '@/constants/jt';
export const WORK_TYPE_META: Record<WorkType, { label: string; desc: string }> = {
  stocker:          { label: 'Кладовщик',     desc: 'Хранение, приёмка и учёт товаров на складе' },
  cook:             { label: 'Повар',          desc: 'Приготовление блюд на кухне' },
  shift_supervisor: { label: 'Старший смены', desc: 'Управление процессами и персоналом смены' },
  picker:           { label: 'Сборщик',       desc: 'Комплектация и сборка заказов' },
};

const WORK_TYPES = (Object.keys(WORK_TYPE_META) as WorkType[]).map(type => ({
  type,
  ...WORK_TYPE_META[type],
}));

interface Props {
  selected: WorkType[];
  onToggle: (t: WorkType) => void;
  single?: boolean;
}

export function WorkTypeSelector({ selected, onToggle }: Props) {
  return (
    <View style={styles.container}>
      {WORK_TYPES.map(wt => {
        const isSelected = selected.includes(wt.type);
        return (
          <TouchableOpacity
            key={wt.type}
            style={[styles.card, isSelected && styles.cardSelected]}
            onPress={() => onToggle(wt.type)}
            activeOpacity={0.8}
          >
            <View style={styles.info}>
              <Text style={styles.title}>{wt.label}</Text>
              <Text style={styles.desc}>{wt.desc}</Text>
            </View>
            <View style={[styles.circle, isSelected && styles.circleSelected]}>
              {isSelected ? <Text style={styles.check}>✓</Text> : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: rs(12) },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(14),
    backgroundColor: Colors.bg,
    borderRadius: Radius.lg,
    padding: rs(18),
    borderWidth: 2,
    borderColor: Colors.inputBorder,
    ...Shadow.card,
  },
  cardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
    shadowColor: Colors.primary,
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  info: { flex: 1 },
  title: { fontSize: rf(16), fontFamily: JT_FONT.bold, color: Colors.textPrimary },
  desc: { fontFamily: JT_FONT.medium, fontSize: rf(13), color: Colors.textMuted, marginTop: rs(2) },
  circle: {
    width: rs(24),
    height: rs(24),
    borderRadius: rs(12),
    borderWidth: 1.5,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  check: { color: '#fff', fontSize: rf(13), fontFamily: JT_FONT.bold },
});
