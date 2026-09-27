/**
 * «Зарплата» (макет «JT-filters» 04-salary, 27.09.2026): один вариант из
 * чипов или своя сумма (ввод числа снимает чип, выбор чипа очищает поле) и
 * переключатель «Только с указанной зарплатой».
 */
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FilterScaffold, Chips, FChip, ToggleRow, SALARY_CHIPS } from '@/components/filters/kit';
import { JT, JT_FONT } from '@/constants/jt';
import { rs, rf } from '@/constants/scale';
import { applyFor, filtersFor, type FilterOrigin } from '@/services/feedFilterStore';

const MAX = 10_000_000;

export default function SalaryFilter() {
  const router = useRouter();
  const { from: fromParam } = useLocalSearchParams<{ from?: string }>();
  const from: FilterOrigin = fromParam === 'all' ? 'all' : 'feed';
  const start = filtersFor(from);
  const startCustom = start.salaryFrom > 0 && !SALARY_CHIPS.some(c => c.value === start.salaryFrom);
  const [chip, setChip] = useState<number | null>(startCustom ? null : start.salaryFrom);
  const [custom, setCustom] = useState(startCustom ? String(start.salaryFrom) : '');
  const [known, setKnown] = useState(start.salaryKnown);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/feed'));

  const customNum = Math.min(MAX, parseInt(custom.replace(/\D/g, ''), 10) || 0);
  const value = chip ?? customNum;
  const shown = custom ? customNum.toLocaleString('ru-RU') : '';

  return (
    <FilterScaffold
      title="Зарплата"
      subtitle="₽ в месяц на руки"
      onBack={close}
      onReset={() => { setChip(0); setCustom(''); setKnown(false); }}
      button={{ label: 'Применить', onPress: () => { applyFor(from, { salaryFrom: value, salaryKnown: known }); close(); } }}
    >
      <View style={{ height: rs(14) }} />
      <Chips>
        {SALARY_CHIPS.map(o => (
          <FChip key={o.value} big label={o.label} on={chip === o.value}
            onPress={() => { setChip(o.value); setCustom(''); }} />
        ))}
      </Chips>

      <Text style={st.label}>Или укажите свою сумму</Text>
      <View style={[st.field, custom !== '' && st.fieldOn]}>
        <Text style={st.affix}>от</Text>
        <TextInput
          value={shown}
          onChangeText={t => { setCustom(t.replace(/\D/g, '').slice(0, 8)); setChip(null); }}
          placeholder="180 000"
          placeholderTextColor={JT.textTertiary}
          keyboardType="number-pad"
          inputMode="numeric"
          style={st.input}
          accessibilityLabel="Своя сумма, рублей в месяц"
          testID="salary-custom"
        />
        <Text style={st.affix}>₽</Text>
      </View>

      <View style={{ height: rs(14) }} />
      <ToggleRow
        title="Только с указанной зарплатой"
        sub="Скрыть вакансии без суммы"
        on={known}
        onPress={() => setKnown(v => !v)}
        testID="salary-known"
      />
    </FilterScaffold>
  );
}

const st = StyleSheet.create({
  label: { marginTop: rs(28), marginBottom: rs(10), fontFamily: JT_FONT.bold, fontSize: rf(15), color: JT.textBody },
  field: {
    height: rs(58), flexDirection: 'row', alignItems: 'center', gap: rs(10), paddingHorizontal: rs(18),
    borderRadius: rs(18), borderWidth: 1.5, borderColor: JT.borderSoft, backgroundColor: JT.surface,
  },
  fieldOn: { borderWidth: 2, borderColor: JT.ink },
  affix: { fontFamily: JT_FONT.heavy, fontSize: rf(17), color: JT.textTertiary },
  input: { flex: 1, minWidth: 0, padding: 0, fontFamily: JT_FONT.heavy, fontSize: rf(17), color: JT.ink },
});
