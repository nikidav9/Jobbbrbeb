/**
 * «Дата публикации» — отдельный экран, как «Формат работы» (решение
 * владельца 28.09.2026). Один вариант: повторное нажатие на выбранный
 * снимает его («за всё время»), «Сбросить» — тоже.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FilterScaffold, FCheck, POSTED } from '@/components/filters/kit';
import { JT, JT_FONT } from '@/constants/jt';
import { rs, rf } from '@/constants/scale';
import { applyFor, filtersFor, type FilterOrigin } from '@/services/feedFilterStore';
import type { PostedFilter } from '@/services/feedFilters';

export default function PostedFilterScreen() {
  const router = useRouter();
  const { from: fromParam } = useLocalSearchParams<{ from?: string }>();
  const from: FilterOrigin = fromParam === 'all' ? 'all' : 'feed';
  const [posted, setPosted] = useState<PostedFilter>(() => filtersFor(from).posted);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/feed'));

  return (
    <FilterScaffold
      title="Дата публикации"
      titleSize={20}
      subtitle="Один вариант"
      onBack={close}
      onReset={() => setPosted('all')}
      button={{ label: 'Применить', onPress: () => { applyFor(from, { posted }); close(); } }}
    >
      <View style={st.card}>
        {POSTED.map((o, i) => {
          const on = posted === o.id;
          return (
            <TouchableOpacity
              key={o.id}
              style={[st.row, i < POSTED.length - 1 && st.divider]}
              onPress={() => setPosted(on ? 'all' : o.id)}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              testID={`posted-${o.id}`}
            >
              <Text style={[st.title, { flex: 1 }]}>{o.label}</Text>
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
  row: { minHeight: rs(58), flexDirection: 'row', alignItems: 'center', gap: rs(12), paddingVertical: rs(12) },
  divider: { borderBottomWidth: 1.5, borderBottomColor: '#EFE7DC' },
  title: { fontFamily: JT_FONT.heavy, fontSize: rf(16), color: JT.ink },
});
