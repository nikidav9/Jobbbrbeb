import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';
import { useApp } from '@/hooks/useApp';
import { WorkType } from '@/constants/types';
import { SKILL_TESTS, SKILL_PASS, SKILL_ATTEMPTS_PER_DAY } from '@/constants/skillTests';
import { WORK_TYPE_META } from '@/components/feature/WorkTypeSelector';
import { dbSubmitSkillTest } from '@/services/db';

import { JT_FONT } from '@/constants/jt';
/**
 * Микро-тест по профессии: пять вопросов, минута времени.
 *
 * Отвечать можно только вперёд — вернувшись, ответ не поменяешь. Не из
 * строгости: с возможностью переигрывать тест превращается в перебор, и
 * «подтверждённый навык» перестаёт отличать умеющего от нажимающего, ради
 * чего он и заведён.
 *
 * После каждого ответа сразу видно, верно или нет, и почему. Тест заодно и
 * учит — а человеку, который ошибся, полезнее узнать правильный ответ
 * сейчас, чем на смене.
 */
export default function SkillTestScreen() {
  const router = useRouter();
  const { workType } = useLocalSearchParams<{ workType: WorkType }>();
  const { currentUser, showToast } = useApp();

  const вопросы = useMemo(
    () => (workType && SKILL_TESTS[workType]) ? SKILL_TESTS[workType] : [],
    [workType],
  );

  const [шаг, setШаг] = useState(0);
  const [выбран, setВыбран] = useState<number | null>(null);
  const [верных, setВерных] = useState(0);
  const [итог, setИтог] = useState<null | { passed: boolean; осталось: number }>(null);
  const [busy, setBusy] = useState(false);

  if (!currentUser || !workType || !вопросы.length) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <Text style={s.emptyTxt}>Тест по этой профессии пока не готов</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => router.back()}>
            <Text style={s.primaryTxt}>Назад</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const вопрос = вопросы[шаг];
  const последний = шаг === вопросы.length - 1;

  async function дальше() {
    if (выбран === null) return;
    const верно = выбран === вопрос.answer;
    const счёт = верных + (верно ? 1 : 0);

    if (!последний) {
      setВерных(счёт);
      setВыбран(null);
      setШаг(шаг + 1);
      return;
    }

    setBusy(true);
    try {
      const res = await dbSubmitSkillTest(
        currentUser!.id, workType!, счёт, вопросы.length, счёт >= SKILL_PASS,
      );
      if (res?.error_попытки) {
        showToast(`Сегодня попытки закончились. Попробуйте завтра.`, 'error');
        router.back();
        return;
      }
      setВерных(счёт);
      setИтог({ passed: !!res?.passed, осталось: res?.осталось ?? 0 });
    } catch (e: any) {
      showToast(String(e?.message || 'Не удалось сохранить результат'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (итог) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <View style={[s.resultCircle, { borderColor: итог.passed ? Colors.green : Colors.red }]}>
            <Ionicons
              name={итог.passed ? 'checkmark' : 'close'}
              size={rf(38)}
              color={итог.passed ? Colors.green : Colors.red}
            />
          </View>
          <Text style={s.resultTitle}>
            {итог.passed ? 'Навык подтверждён' : 'Пока не засчитано'}
          </Text>
          <Text style={s.resultSub}>
            Верных ответов: {верных} из {вопросы.length}.
            {итог.passed
              ? ` Значок «${WORK_TYPE_META[workType].label} — подтверждён» появится в вашем профиле, и его видят работодатели.`
              : ` Нужно ${SKILL_PASS}. Попыток сегодня осталось: ${итог.осталось}.`}
          </Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => router.back()} activeOpacity={0.85}>
            <Text style={s.primaryTxt}>Готово</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const отвечено = выбран !== null;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={rf(22)} color={Colors.textSecondary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{WORK_TYPE_META[workType].label}</Text>
        <Text style={s.counter}>{шаг + 1}/{вопросы.length}</Text>
      </View>

      <View style={s.progress}>
        <View style={[s.progressFill, { width: `${((шаг) / вопросы.length) * 100}%` }]} />
      </View>

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.question}>{вопрос.q}</Text>

        {вопрос.options.map((o, i) => {
          const этот = выбран === i;
          const правильный = i === вопрос.answer;
          // Подсвечиваем только после ответа: до него все варианты равны.
          const тон = !отвечено ? 'plain'
            : правильный ? 'good'
            : этот ? 'bad' : 'plain';
          return (
            <TouchableOpacity
              key={i}
              style={[
                s.option,
                тон === 'good' ? s.optionGood : null,
                тон === 'bad' ? s.optionBad : null,
                !отвечено && этот ? s.optionPicked : null,
              ]}
              activeOpacity={отвечено ? 1 : 0.8}
              disabled={отвечено}
              onPress={() => setВыбран(i)}
            >
              <Text style={[
                s.optionTxt,
                тон === 'good' ? { color: Colors.green, fontFamily: JT_FONT.bold } : null,
                тон === 'bad' ? { color: Colors.red } : null,
              ]}>{o}</Text>
              {отвечено && правильный ? (
                <Ionicons name="checkmark-circle" size={rf(18)} color={Colors.green} />
              ) : null}
              {отвечено && этот && !правильный ? (
                <Ionicons name="close-circle" size={rf(18)} color={Colors.red} />
              ) : null}
            </TouchableOpacity>
          );
        })}

        {отвечено && вопрос.why ? (
          <View style={s.why}>
            <Text style={s.whyTxt}>{вопрос.why}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={s.footer}>
        <TouchableOpacity
          style={[s.primaryBtn, (!отвечено || busy) && { opacity: 0.5 }]}
          onPress={дальше}
          disabled={!отвечено || busy}
          activeOpacity={0.85}
        >
          {busy
            ? <ActivityIndicator color="#FFFFFF" />
            : <Text style={s.primaryTxt}>{последний ? 'Завершить' : 'Дальше'}</Text>}
        </TouchableOpacity>
        <Text style={s.note}>
          Вернуться к прошлому вопросу нельзя: иначе тест превращается в перебор.
          Попыток в сутки — {SKILL_ATTEMPTS_PER_DAY}.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: rs(28) },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingVertical: rs(14),
  },
  headerTitle: { fontSize: rf(16), fontFamily: JT_FONT.bold, color: Colors.textPrimary },
  counter: { fontSize: rf(14), fontFamily: JT_FONT.semi, color: Colors.textMuted },
  progress: { height: rs(4), backgroundColor: Colors.surface, marginHorizontal: rs(16), borderRadius: rs(2) },
  progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: rs(2) },

  body: { padding: rs(20), gap: rs(10) },
  question: { fontSize: rf(18), fontFamily: JT_FONT.bold, color: Colors.textPrimary, lineHeight: rf(25), marginBottom: rs(6) },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    padding: rs(14), borderRadius: rs(12),
    backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.inputBorder,
  },
  optionPicked: { borderColor: Colors.primary },
  optionGood: { borderColor: Colors.green, backgroundColor: '#F0FDF4' },
  optionBad: { borderColor: Colors.red, backgroundColor: '#FEF2F2' },
  optionTxt: { flex: 1, fontFamily: JT_FONT.medium, fontSize: rf(14.5), color: Colors.textPrimary, lineHeight: rf(20) },

  why: {
    marginTop: rs(6), padding: rs(12), borderRadius: rs(10),
    backgroundColor: Colors.surface,
  },
  whyTxt: { fontFamily: JT_FONT.medium, fontSize: rf(13.5), color: Colors.textSecondary, lineHeight: rf(19) },

  footer: { padding: rs(20), gap: rs(8) },
  primaryBtn: {
    height: rs(52), borderRadius: rs(14), backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', width: '100%',
  },
  primaryTxt: { fontSize: rf(16), fontFamily: JT_FONT.heavy, color: '#FFFFFF' },
  note: { fontFamily: JT_FONT.medium, fontSize: rf(12), color: Colors.textMuted, textAlign: 'center', lineHeight: rf(17) },

  resultCircle: {
    width: rs(84), height: rs(84), borderRadius: rs(42), borderWidth: rs(3),
    alignItems: 'center', justifyContent: 'center', marginBottom: rs(18),
  },
  resultTitle: { fontSize: rf(22), fontFamily: JT_FONT.heavy, color: Colors.textPrimary, textAlign: 'center' },
  resultSub: {
    fontFamily: JT_FONT.medium, fontSize: rf(14.5), color: Colors.textSecondary, textAlign: 'center',
    lineHeight: rf(21), marginTop: rs(8), marginBottom: rs(24),
  },
  emptyTxt: { fontFamily: JT_FONT.medium, fontSize: rf(15), color: Colors.textMuted, textAlign: 'center', marginBottom: rs(20) },
});
