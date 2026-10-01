import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';
import { User, WorkType } from '@/constants/types';
import { dbGetSkillResults, SkillResult } from '@/services/db';
import { WORK_TYPE_META } from '@/components/feature/WorkTypeSelector';
import { SKILL_TESTS } from '@/constants/skillTests';

import { JT_FONT } from '@/constants/jt';
/**
 * Подтверждённые навыки.
 *
 * ⚠️ СЕЙЧАС НИГДЕ НЕ ПОКАЗЫВАЕТСЯ. Раздел убран из профиля до того, как
 * будут утверждены вопросы: тест, который спрашивает не то, хуже, чем
 * отсутствие теста — по нему начнут судить о людях. Код, экран теста и
 * таблица результатов на месте и рабочие; вернуть — добавить <SkillBadges />
 * обратно в app/(tabs)/profile.tsx и app/user-profile.tsx.
 * См. docs/план-разработки.md.
 *
 * У себя — со списком того, что ещё можно подтвердить, и кнопкой пройти.
 * У чужого профиля — только подтверждённое: непройденный тест это не изъян,
 * и показывать работодателю «не подтвердил четыре из четырёх» значит
 * наказать человека за то, чего он просто не делал.
 */
export function SkillBadges({ user, own = false }: { user: User; own?: boolean }) {
  const router = useRouter();
  const [results, setResults] = useState<SkillResult[] | null>(null);

  const load = useCallback(() => {
    dbGetSkillResults(user.id).then(setResults).catch(() => setResults([]));
  }, [user.id]);

  useEffect(load, [load]);
  // Вернулись с теста — перечитываем: иначе значок появится только после
  // перезапуска, и человек решит, что тест не засчитался.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (user.role !== 'worker') return null;

  const свои = (user.workTypes ?? []).filter(w => !!SKILL_TESTS[w]) as WorkType[];
  const подтверждено = new Set((results ?? []).filter(r => r.passed).map(r => r.workType));

  // В чужом профиле молчим, пока подтверждать нечего.
  if (!own && подтверждено.size === 0) return null;
  if (own && свои.length === 0) return null;

  const показать = own ? свои : свои.filter(w => подтверждено.has(w));

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Ionicons name="ribbon-outline" size={rf(17)} color={Colors.primary} />
        <Text style={s.title}>Подтверждённые навыки</Text>
      </View>

      {own ? (
        <Text style={s.sub}>
          Пять вопросов на минуту. Подтверждённый навык видят работодатели —
          он отличает «умею» от галочки в анкете.
        </Text>
      ) : null}

      <View style={s.rows}>
        {показать.map(w => {
          const ок = подтверждено.has(w);
          return (
            <View key={w} style={s.row}>
              <Ionicons
                name={ок ? 'checkmark-circle' : 'ellipse-outline'}
                size={rf(18)}
                color={ок ? Colors.green : Colors.textMuted}
              />
              <Text style={[s.rowTxt, ок ? { fontFamily: JT_FONT.bold, color: Colors.textPrimary } : null]}>
                {WORK_TYPE_META[w].label}
              </Text>
              {own && !ок ? (
                <TouchableOpacity
                  style={s.btn}
                  activeOpacity={0.8}
                  onPress={() => router.push({ pathname: '/skill-test', params: { workType: w } })}
                >
                  <Text style={s.btnTxt}>Пройти</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.card, borderRadius: rs(14), padding: rs(16),
    borderWidth: 1, borderColor: Colors.divider,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: rs(8) },
  title: { fontSize: rf(15), fontFamily: JT_FONT.heavy, color: Colors.textPrimary },
  sub: { fontFamily: JT_FONT.medium, fontSize: rf(12.5), color: Colors.textMuted, marginTop: rs(6), lineHeight: rf(18) },
  rows: { marginTop: rs(12), gap: rs(10) },
  row: { flexDirection: 'row', alignItems: 'center', gap: rs(8) },
  rowTxt: { flex: 1, fontFamily: JT_FONT.medium, fontSize: rf(14), color: Colors.textSecondary },
  btn: {
    paddingHorizontal: rs(12), paddingVertical: rs(6), borderRadius: rs(100),
    backgroundColor: Colors.primaryLight,
  },
  btnTxt: { fontSize: rf(12.5), fontFamily: JT_FONT.bold, color: Colors.primary },
});
