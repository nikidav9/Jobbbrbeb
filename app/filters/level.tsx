/**
 * «Грейд» — отдельный экран, как «Формат работы» (решение владельца
 * 28.09.2026: у грейда и даты публикации свои экраны, как у остальных
 * фильтров). Несколько сразу. Junior включает стажёров — отдельной кнопки
 * стажёра в макете нет.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FilterScaffold, FCheck, GRADES, toggleIn } from '@/components/filters/kit';
import { JT, JT_FONT } from '@/constants/jt';
import { rs, rf } from '@/constants/scale';
import { applyFor, filtersFor, type FilterOrigin } from '@/services/feedFilterStore';
import type { VacancyLevel } from '@/services/vacancyFacets';

const SUB: Record<string, string> = {
  Junior: 'Стажёры и начинающие',
  Middle: 'Уверенный опыт',
  Senior: 'Старшие специалисты',
  'Lead / Manager': 'Тимлиды и руководители групп',
  'C-level': 'Директора и Head of',
};

export default function LevelFilter() {
  const router = useRouter();
  const { from: fromParam } = useLocalSearchParams<{ from?: string }>();
  const from: FilterOrigin = fromParam === 'all' ? 'all' : 'feed';
  const [levels, setLevels] = useState<VacancyLevel[]>(() => filtersFor(from).levels);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/feed'));
  const picked = GRADES.filter(g => g.ids.every(id => levels.includes(id))).length;

  return (
    <FilterScaffold
      title="Грейд"
      subtitle={`Можно выбрать несколько · выбрано ${picked}`}
      onBack={close}
      onReset={() => setLevels([])}
      button={{ label: 'Применить', count: picked, onPress: () => { applyFor(from, { levels }); close(); } }}
    >
      <View style={st.card}>
        {GRADES.map((g, i) => {
          const on = g.ids.every(id => levels.includes(id));
          return (
            <TouchableOpacity
              key={g.label}
              style={[st.row, i < GRADES.length - 1 && st.divider]}
              onPress={() => setLevels(cur => toggleIn(cur, g.ids))}
              activeOpacity={0.8}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              testID={`level-${g.ids[g.ids.length - 1]}`}
            >
              <View style={{ flex: 1, gap: rs(2) }}>
                <Text style={st.title}>{g.label}</Text>
                <Text style={st.sub}>{SUB[g.label]}</Text>
              </View>
              <FCheck on={on} />
            </TouchableOpacity>
          );
        })}
      </View>
    </FilterScaffold>
  );
}

const st = StyleSheet.create({
  card: { marginTop: rs(16), borderRadius: rs(22), backgroundColor: JT.surface, paddingHorizontal: rs(20) },
  row: { minHeight: rs(66), flexDirection: 'row', alignItems: 'center', gap: rs(12), paddingVertical: rs(12) },
  divider: { borderBottomWidth: 1.5, borderBottomColor: '#EFE7DC' },
  title: { fontFamily: JT_FONT.heavy, fontSize: rf(16), color: JT.ink },
  sub: { fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT.textTertiary },
});
