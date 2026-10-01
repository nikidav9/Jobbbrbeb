/**
 * «Фильтры» — все фильтры сразу (макет «JT-filters» 01-all-filters,
 * 27.09.2026). Отдельный полноэкранный экран поверх ленты, без нижнего меню.
 * Правит черновик (services/feedFilterStore.ts): лента меняется только по
 * «Показать N вакансий», число пересчитывается на сервере при каждом изменении.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import {
  FilterScaffold, SectionTitle, Chips, FChip, ToggleRow, Chevron,
  SALARY_CHIPS, GRADES, FORMATS, POSTED, toggleIn,
} from '@/components/filters/kit';
import { JT, JT_FONT } from '@/constants/jt';
import { rs, rf } from '@/constants/scale';
import { commitDraft, getFeedQuery, setDraft, useDraft } from '@/services/feedFilterStore';
import { EMPTY_FEED_FILTERS, pluralVacancies, toExtFeedFilters } from '@/services/feedFilters';
import { VACANCY_SPECS } from '@/services/vacancyFacets';
import { dbCountExtFeed } from '@/services/db';


// Короткая подпись для плашки в поле «Специализация» (как в макете).
function specShort(id: string): string {
  const s = VACANCY_SPECS.find(x => x.id === id);
  return s?.short ?? s?.label ?? id;
}

export default function AllFilters() {
  const router = useRouter();
  const f = useDraft();
  const [count, setCount] = useState<number | null>(null);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/feed'));

  // Число «Показать N» — с паузой 300 мс после последнего изменения.
  const key = JSON.stringify(f);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      dbCountExtFeed({ ...toExtFeedFilters(f), companies: [], query: getFeedQuery() })
        .then(n => { if (!cancelled) setCount(n); })
        .catch(() => { if (!cancelled) setCount(null); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const custom = f.salaryFrom > 0 && !SALARY_CHIPS.some(c => c.value === f.salaryFrom);

  return (
    <FilterScaffold
      title="Фильтры"
      onBack={close}
      onReset={() => setDraft(EMPTY_FEED_FILTERS)}
      button={{
        label: count === null ? 'Показать вакансии' : `Показать ${count.toLocaleString('ru-RU')} ${pluralVacancies(count)}`,
        onPress: () => { commitDraft(); close(); },
        testID: 'filters-show',
      }}
    >
      <SectionTitle title="Специализация" />
      <TouchableOpacity
        style={{
          minHeight: rs(58), paddingVertical: rs(10), paddingLeft: rs(16), paddingRight: rs(14),
          borderRadius: rs(18), borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.surface,
          flexDirection: 'row', alignItems: 'center', gap: rs(10),
        }}
        onPress={() => router.push({ pathname: '/filters/spec', params: { from: 'all' } })}
        accessibilityRole="button" testID="filters-spec-field"
      >
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: rs(6) }}>
          {f.specs.length ? f.specs.map(id => (
            <View key={id} style={{ height: rs(28), paddingHorizontal: rs(10), borderRadius: rs(14), backgroundColor: JT.accentSoft, justifyContent: 'center', maxWidth: '100%' }}>
              <Text style={{ fontFamily: JT_FONT.heavy, fontSize: rf(13), color: JT.ink }} numberOfLines={1}>
                {specShort(id)}
              </Text>
            </View>
          )) : <Text style={{ fontFamily: JT_FONT.bold, fontSize: rf(15), color: JT.textTertiary }}>Любая</Text>}
        </View>
        <Chevron />
      </TouchableOpacity>

      <SectionTitle title="Формат работы" link={{ label: 'Все', onPress: () => router.push({ pathname: '/filters/format', params: { from: 'all' } }) }} />
      <Chips>
        {FORMATS.map(o => (
          <FChip key={o.id} label={o.chip} on={f.formats.includes(o.id)}
            onPress={() => setDraft(d => ({ ...d, formats: toggleIn(d.formats, [o.id]) }))} />
        ))}
      </Chips>

      <SectionTitle title="Зарплата" hint="₽/мес на руки"
        link={{ label: 'Своя сумма', onPress: () => router.push({ pathname: '/filters/salary', params: { from: 'all' } }) }} />
      <Chips>
        {SALARY_CHIPS.map(o => (
          <FChip key={o.value} label={o.label} on={f.salaryFrom === o.value}
            onPress={() => setDraft(d => ({ ...d, salaryFrom: o.value }))} />
        ))}
        {custom ? <FChip label={`от ${f.salaryFrom.toLocaleString('ru-RU')}`} on onPress={() => router.push({ pathname: '/filters/salary', params: { from: 'all' } })} /> : null}
      </Chips>

      <View>
        <SectionTitle title="Грейд" />
        <Chips>
          {GRADES.map(g => (
            <FChip key={g.label} label={g.label} on={g.ids.every(id => f.levels.includes(id))}
              onPress={() => setDraft(d => ({ ...d, levels: toggleIn(d.levels, g.ids) }))} />
          ))}
        </Chips>
      </View>

      <SectionTitle title="Видимость вакансий" />
      <ToggleRow
        title="Скрыть просмотренные"
        sub="Не показывать вакансии, которые вы уже свайпнули"
        on={f.hideSeen}
        onPress={() => setDraft(d => ({ ...d, hideSeen: !d.hideSeen }))}
        testID="filters-hide-seen"
      />

      <SectionTitle title="Дата публикации" />
      <Chips>
        {POSTED.map(o => (
          <FChip key={o.id} label={o.label} on={f.posted === o.id}
            onPress={() => setDraft(d => ({ ...d, posted: d.posted === o.id ? 'all' : o.id }))} />
        ))}
      </Chips>
      <View style={{ height: rs(8) }} />
    </FilterScaffold>
  );
}
