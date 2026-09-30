/**
 * «Формат работы» (макет «JT-filters» 03-work-format, 27.09.2026). Лента —
 * только Москва и удалёнка (решение владельца 26.09), поэтому строк три:
 * Москва · офис, Москва · гибрид, полная удалёнка. Несколько сразу.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FilterScaffold, FCheck, FORMATS, toggleIn } from '@/components/filters/kit';
import { JT, JT_FONT } from '@/constants/jt';
import { rs, rf } from '@/constants/scale';
import { applyFor, filtersFor, type FilterOrigin } from '@/services/feedFilterStore';
import type { VacancyFormat } from '@/services/vacancyFacets';

export default function FormatFilter() {
  const router = useRouter();
  const { from: fromParam } = useLocalSearchParams<{ from?: string }>();
  const from: FilterOrigin = fromParam === 'all' ? 'all' : 'feed';
  const [formats, setFormats] = useState<VacancyFormat[]>(() => filtersFor(from).formats);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/feed'));

  return (
    <FilterScaffold
      title="Формат работы"
      titleSize={20}
      subtitle={`Можно выбрать несколько · выбрано ${formats.length}`}
      onBack={close}
      onReset={() => setFormats([])}
      button={{ label: 'Применить', count: formats.length, onPress: () => { applyFor(from, { formats }); close(); } }}
    >
      <View style={st.card}>
        {FORMATS.map((o, i) => {
          const on = formats.includes(o.id);
          return (
            <TouchableOpacity
              key={o.id}
              style={[st.row, i < FORMATS.length - 1 && st.divider]}
              onPress={() => setFormats(cur => toggleIn(cur, [o.id]))}
              activeOpacity={0.8}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              testID={`format-${o.id}`}
            >
              <View style={{ flex: 1, gap: rs(2) }}>
                <Text style={st.title}>{o.title}</Text>
                <Text style={st.sub}>{o.sub}</Text>
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
