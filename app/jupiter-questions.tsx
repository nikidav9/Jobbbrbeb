// Вопросы от работодателей (решение владельца 30.09.2026). Юпитер дошёл до
// анкеты, которой нужен ответ, которого нет в профиле, — человек отвечает
// здесь по одному вопросу, и отклик уходит сам. Ответ на факт (Telegram, дата
// выхода, зарплата) сохраняется и дальше подставляется без спроса; вопрос под
// вакансию задаётся каждый раз, прежний ответ — черновиком.
//
// Без нативных модулей: дата — кнопками и вводом «ДД.ММ.ГГГГ», а не
// системным выбором даты (его нет в собранном бинарнике).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View, type KeyboardTypeOptions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { useWarmSystemBar } from '@/hooks/useWarmSystemBar';
import { JT, JT_FONT } from '@/constants/jt';
import { JTButton, JTProgress } from '@/components/ui/jt';
import { HardShadowBox } from '@/components/profile/edit/HardShadowBox';
import { BackIcon } from '@/components/profile/edit/icons';
import {
  jupiterAnswerQuestion, jupiterQuestions, jupiterSkipQuestion, type JupiterQuestion,
} from '@/services/db';
import { dateAfter, usableDraft } from '@/services/jupiterQuestions';

const KEYBOARD: Partial<Record<JupiterQuestion['type'], KeyboardTypeOptions>> = {
  number: 'numeric', phone: 'phone-pad', email: 'email-address', url: 'url', date: 'numbers-and-punctuation',
};

type Phase = 'loading' | 'ready' | 'sending' | 'done' | 'error';

export default function JupiterQuestionsScreen() {
  useWarmSystemBar(true, JT.background);
  const router = useRouter();
  const { currentUser, showToast } = useApp();
  const [items, setItems] = useState<JupiterQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [value, setValue] = useState('');
  const [sentApps, setSentApps] = useState(0);

  const current = items[0];
  const step = total - items.length + 1;

  const load = useCallback(async (keepTotal = false) => {
    if (!currentUser?.id) return;
    try {
      const list = await jupiterQuestions(currentUser.id);
      setItems(list);
      if (!keepTotal) setTotal(list.length);
      setValue(list[0] ? usableDraft(list[0]) : '');
      setPhase(list.length ? 'ready' : 'done');
    } catch (e: any) {
      showToast(e?.message || 'Не удалось загрузить вопросы', 'error');
      setPhase('error');
    }
  }, [currentUser?.id, showToast]);

  useEffect(() => { void load(); }, [load]);

  const goBack = () => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/matches'); };

  // Ответ на факт закрывает этот же вопрос в других откликах — поэтому после
  // каждого ответа список берём с сервера заново, а не сдвигаем локально.
  const answer = async () => {
    const text = value.trim();
    if (!current || !currentUser?.id || !text || phase !== 'ready') return;
    setPhase('sending');
    try {
      const r = await jupiterAnswerQuestion(currentUser.id, current.id, text);
      setSentApps(n => n + (r?.applications ?? 0));
      await load(true);
    } catch (e: any) {
      showToast(e?.message || 'Не удалось сохранить ответ', 'error');
      setPhase('ready');
    }
  };

  const skip = async () => {
    if (!current || !currentUser?.id || phase !== 'ready') return;
    setPhase('sending');
    try {
      await jupiterSkipQuestion(currentUser.id, current.id);
      await load(true);
    } catch (e: any) {
      showToast(e?.message || 'Не получилось пропустить', 'error');
      setPhase('ready');
    }
  };

  const busy = phase === 'sending';
  const dateChips = useMemo(() => [
    { label: 'Сразу', value: dateAfter(0) },
    { label: 'Через 2 недели', value: dateAfter(14) },
    { label: 'Через месяц', value: dateAfter(30) },
  ], []);

  const renderInput = (q: JupiterQuestion) => {
    if (q.type === 'choice' && q.options.length > 0) {
      return (
        <View style={s.options}>
          {q.options.map(o => (
            <Choice key={`${o.value}|${o.label}`} label={o.label} on={value === o.label} onPress={() => setValue(o.label)} />
          ))}
        </View>
      );
    }
    if (q.type === 'yesno') {
      return (
        <View style={s.row}>
          <Choice label="Да" on={value === 'да'} onPress={() => setValue('да')} grow />
          <Choice label="Нет" on={value === 'нет'} onPress={() => setValue('нет')} grow />
        </View>
      );
    }
    return (
      <>
        {q.type === 'date' ? (
          <View style={s.chips}>
            {dateChips.map(c => (
              <Choice key={c.label} label={c.label} on={value === c.value} onPress={() => setValue(c.value)} small />
            ))}
          </View>
        ) : null}
        <TextInput
          style={[s.input, q.type === 'text_long' && s.inputLong]}
          value={value}
          onChangeText={setValue}
          placeholder={q.type === 'date' ? 'ДД.ММ.ГГГГ' : q.type === 'number' ? 'Число' : 'Ваш ответ'}
          placeholderTextColor={JT.textTertiary}
          multiline={q.type === 'text_long'}
          keyboardType={KEYBOARD[q.type] ?? 'default'}
          autoCapitalize={q.type === 'email' || q.type === 'url' ? 'none' : 'sentences'}
          editable={!busy}
          accessibilityLabel={q.question}
          testID="question-input"
        />
      </>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <TouchableOpacity style={s.back} onPress={goBack} activeOpacity={0.72}
          accessibilityRole="button" accessibilityLabel="Назад" testID="back-button">
          <BackIcon />
        </TouchableOpacity>
        <Text style={s.headerTitle} pointerEvents="none">Вопросы</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {phase === 'loading' ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={JT.accent} />
          ) : phase === 'done' || phase === 'error' || !current ? (
            <HardShadowBox offset={5} radius={24}>
              <View style={s.card}>
                <Text style={s.doneTitle}>{phase === 'error' ? 'Не получилось загрузить' : 'Все вопросы отвечены'}</Text>
                <Text style={s.hint}>
                  {phase === 'error'
                    ? 'Проверьте интернет и попробуйте ещё раз.'
                    : sentApps > 0
                      ? 'Юпитер дозаполнит анкеты и отправит отклики сам — статус увидите в «Откликах».'
                      : 'Новых вопросов от работодателей нет.'}
                </Text>
                <JTButton label={phase === 'error' ? 'Повторить' : 'К откликам'} arrow={false}
                  onPress={phase === 'error' ? () => { setPhase('loading'); void load(); } : goBack}
                  style={{ marginTop: 20 }} />
              </View>
            </HardShadowBox>
          ) : (
            <>
              <JTProgress step={Math.min(step, total)} total={Math.max(total, 1)} />
              <Text style={s.question} testID="question-text">{current.question}</Text>
              <Text style={s.hint}>
                {current.kind === 'fact'
                  ? 'Сохраним ответ и дальше подставим сами — поправить можно в профиле.'
                  : 'Этот ответ — только для этой вакансии.'}
              </Text>

              <View style={s.answerBox}>{renderInput(current)}</View>

              <HardShadowBox offset={4} radius={18} style={{ marginTop: 22 }}>
                <View style={s.appCard}>
                  <Text style={s.appCompany} numberOfLines={1}>{current.company?.trim() || 'Карьерный сайт'}</Text>
                  {current.applications_waiting > 1 ? (
                    <Text style={s.appWaiting}>Ждут этого ответа: {current.applications_waiting} откл.</Text>
                  ) : null}
                </View>
              </HardShadowBox>

              <JTButton label="Ответить" arrow={false} onPress={() => void answer()}
                disabled={!value.trim()} busy={busy} style={{ marginTop: 22 }} testID="answer-button" />
              <TouchableOpacity style={s.skip} onPress={() => void skip()} disabled={busy}
                activeOpacity={0.7} accessibilityRole="button" testID="skip-button">
                <Text style={s.skipTxt}>Пропустить — заполню на сайте сам</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Choice({ label, on, onPress, grow, small }: {
  label: string; on: boolean; onPress: () => void; grow?: boolean; small?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[s.choice, small && s.choiceSmall, grow && { flex: 1 }, on && s.choiceOn]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
    >
      <Text style={[s.choiceTxt, small && s.choiceTxtSmall]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: JT.background },
  header: { height: 44, marginTop: 12, marginHorizontal: 20, justifyContent: 'center', alignItems: 'flex-start' },
  back: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.surface,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  headerTitle: {
    position: 'absolute', left: 0, right: 0, textAlign: 'center', fontFamily: JT_FONT.head, fontSize: 17, color: JT.ink,
  },
  content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center' },
  question: { marginTop: 22, fontFamily: JT_FONT.head, fontSize: 22, lineHeight: 29, color: JT.ink, letterSpacing: -0.3 },
  hint: { marginTop: 8, fontFamily: JT_FONT.medium, fontSize: 14, lineHeight: 20, color: JT.textSecondary },
  answerBox: { marginTop: 18 },
  input: {
    marginTop: 12, minHeight: 56, borderRadius: 18, borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.surface,
    paddingHorizontal: 16, paddingVertical: 14, fontFamily: JT_FONT.bold, fontSize: 17, color: JT.ink,
  },
  inputLong: { minHeight: 130, textAlignVertical: 'top' },
  options: { gap: 10 },
  row: { flexDirection: 'row', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    minHeight: 52, paddingHorizontal: 16, borderRadius: 16, borderWidth: 2, borderColor: JT.ink,
    backgroundColor: JT.surface, justifyContent: 'center', alignItems: 'center',
  },
  choiceSmall: { minHeight: 40, borderRadius: 20, paddingHorizontal: 14 },
  choiceOn: { backgroundColor: JT.accent },
  choiceTxt: { fontFamily: JT_FONT.bold, fontSize: 16, color: JT.ink, textAlign: 'center' },
  choiceTxtSmall: { fontSize: 14 },
  appCard: {
    padding: 14, borderRadius: 18, borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.surface, gap: 4,
  },
  appCompany: { fontFamily: JT_FONT.heavy, fontSize: 15, color: JT.ink },
  appWaiting: { fontFamily: JT_FONT.medium, fontSize: 13, color: JT.textTertiary },
  skip: { marginTop: 10, alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  skipTxt: { fontFamily: JT_FONT.bold, fontSize: 15, color: JT.textTertiary },
  card: { padding: 22, borderRadius: 24, backgroundColor: JT.surface, borderWidth: 2, borderColor: JT.ink },
  doneTitle: { fontFamily: JT_FONT.head, fontSize: 20, lineHeight: 26, color: JT.ink },
});
