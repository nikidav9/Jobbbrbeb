/**
 * «Специализация» (макет «JT-filters» 02-specialization, 27.09.2026): 13
 * пунктов макета и «1С» (решение владельца), несколько сразу. Открывается из
 * ленты (чип «Специализация») или из «Всех фильтров» — `from` решает, куда
 * записать выбор; «назад» ничего не меняет.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FilterScaffold, FCheck, SpecTile, toggleIn } from '@/components/filters/kit';
import { JT, JT_FONT } from '@/constants/jt';
import { rs, rf } from '@/constants/scale';
import { applyFor, filtersFor, type FilterOrigin } from '@/services/feedFilterStore';
import { VACANCY_SPECS, type VacancySpec } from '@/services/vacancyFacets';

export default function SpecFilter() {
  const router = useRouter();
  const { from: fromParam } = useLocalSearchParams<{ from?: string }>();
  const from: FilterOrigin = fromParam === 'all' ? 'all' : 'feed';
  const [specs, setSpecs] = useState<VacancySpec[]>(() => filtersFor(from).specs);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/feed'));

  return (
    <FilterScaffold
      title="Специализация"
      titleSize={20}
      subtitle={`Можно выбрать несколько · выбрано ${specs.length}`}
      onBack={close}
      onReset={() => setSpecs([])}
      button={{ label: 'Применить', count: specs.length, onPress: () => { applyFor(from, { specs }); close(); } }}
    >
      <View style={st.card}>
        {VACANCY_SPECS.map((s, i) => {
          const on = specs.includes(s.id);
          return (
            <TouchableOpacity
              key={s.id}
              style={[st.row, i < VACANCY_SPECS.length - 1 && st.divider]}
              onPress={() => setSpecs(cur => toggleIn(cur, [s.id]))}
              activeOpacity={0.8}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              testID={`spec-${s.id}`}
            >
              <SpecTile spec={s.id} on={on} />
              <Text style={[st.label, on && st.labelOn]}>{s.label}</Text>
              <FCheck on={on} />
            </TouchableOpacity>
          );
        })}
      </View>
    </FilterScaffold>
  );
}

const st = StyleSheet.create({
  card: { marginTop: rs(16), borderRadius: rs(22), backgroundColor: JT.surface, paddingHorizontal: rs(14) },
  row: { minHeight: rs(58), flexDirection: 'row', alignItems: 'center', gap: rs(12), paddingVertical: rs(10) },
  divider: { borderBottomWidth: 1.5, borderBottomColor: '#EFE7DC' },
  label: { flex: 1, fontFamily: JT_FONT.bold, fontSize: rf(15), color: JT.ink },
  labelOn: { fontFamily: JT_FONT.heavy },
});
