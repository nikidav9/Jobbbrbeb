// Карточка отклика Юпитера: статус, действие и история шагов — как у Sorce.
//
// Сюда ведёт строка отклика в «Откликах». Шаги пишет триггер базы
// (миграция 111, jm_jupiter_events), экран их только показывает. Согласие для
// Сбера и повторная постановка в очередь после включения автоотклика —
// действия этого экрана (перенесены сюда из строки списка, где раньше были
// кнопками под строкой).
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, Radius } from '@/constants/theme';
import type { JupiterApplication } from '@/constants/types';
import { useApp } from '@/hooks/useApp';
import {
  jupiterApplicationEvents, jupiterMyApplications, jupiterGrantThirdPartyConsent,
  jupiterRequeueLive, dbGetResumeFiles,
} from '@/services/db';
import { requestJupiterLive } from '@/services/jupiterLive';
import { jupiterManualEligible } from '@/services/jupiterFill';
import { buildTimeline, jupiterNeedsSberConsent, jupiterStatus, TimelineStep } from '@/services/jupiterTimeline';
import { getInitials, nameColorFromString } from '@/services/storage';
import { CompanyMark } from '@/components/ui/CompanyMark';
import { companyLogo } from '@/constants/companyLogos';
import { rf, rs } from '@/constants/scale';

const SBER_TERMS_URL = 'https://rabota.sber.ru/terms';

const TONE: Record<TimelineStep['tone'], { icon: React.ComponentProps<typeof Ionicons>['name']; fg: string; bg: string }> = {
  done: { icon: 'checkmark', fg: '#047857', bg: '#D1FAE5' },
  wait: { icon: 'hand-left-outline', fg: '#B45309', bg: '#FEF3C7' },
  fail: { icon: 'close', fg: '#DC2626', bg: '#FEE2E2' },
  info: { icon: 'time-outline', fg: '#1D4ED8', bg: '#DBEAFE' },
};

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').split(/[/?#]/)[0].replace(/^www\./, '');
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function JupiterApplicationScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentUser, showToast } = useApp();
  const [app, setApp] = useState<JupiterApplication | null>(null);
  const [steps, setSteps] = useState<TimelineStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!currentUser?.id || !id) return;
    try {
      const [apps, events] = await Promise.all([
        jupiterMyApplications(currentUser.id),
        jupiterApplicationEvents(currentUser.id, id),
      ]);
      const own = apps.find(a => a.id === id) ?? null;
      setApp(own);
      setSteps(buildTimeline(events));
      setError(own ? '' : 'Отклик не найден');
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить отклик');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, id]);

  useEffect(() => { load(); }, [load]);

  const company = app?.company?.trim() || 'Карьерный сайт';
  const vacancyTitle = app?.vacancyTitle?.trim() || '';
  const status = app ? jupiterStatus(app) : null;
  const canFill = !!app && jupiterManualEligible(app);
  const waiting = app?.state === 'submitted';
  const needsSberConsent = !!app && jupiterNeedsSberConsent(app);
  // Автоотклик был выключен, когда заявка встала в очередь (или его отозвали
  // именно для неё) — пока человек не включит его заново, Юпитер к заявке не
  // вернётся.
  const needsRequeue = !!app && (
    (app.state === 'ready_to_submit' && !app.submissionAuthorizedAt)
    || (app.state === 'action_required' && app.reasonCode === 'LIVE_AUTHORIZATION_REVOKED')
  );

  const openSite = () => {
    if (!app) return;
    Linking.openURL(app.vacancyUrl).catch(() => showToast('Не удалось открыть сайт компании', 'error'));
  };
  const openForm = () => {
    if (!app) return;
    // На вебе встроенного браузера нет — там анкета открывается на сайте.
    if (Platform.OS === 'web') { openSite(); return; }
    router.push({ pathname: '/jupiter-fill', params: { id: app.id, company } });
  };
  const openSberTerms = () => {
    Linking.openURL(app?.thirdPartyTermsUrl || SBER_TERMS_URL)
      .catch(() => showToast('Не удалось открыть условия Сбера', 'error'));
  };
  // Перенесено из matches.tsx без изменения поведения: те же вызовы, та же
  // проверка резюме и тот же текст согласия.
  const grantSberConsent = async () => {
    if (!app || !currentUser?.id) return;
    const message = 'Сбер просит согласие на обработку персональных данных. Если продолжить, JobToo передаст Сберу имя, фамилию, телефон, ваш адрес JobToo и выбранное PDF-резюме только для этой вакансии.';
    // Alert.alert в веб-сборке (сайт и мини-приложение в Телеграме) ничего не
    // показывает — кнопка выглядела бы мёртвой. На вебе — window.confirm,
    // как в services/jupiterLive.ts.
    const approved = Platform.OS === 'web'
      ? typeof window !== 'undefined' && window.confirm(message)
      : await new Promise<boolean>(resolve => Alert.alert('Согласие для отклика в Сбер', message, [
          { text: 'Отмена', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Согласен и отправить', onPress: () => resolve(true) },
        ], { cancelable: true, onDismiss: () => resolve(false) }));
    if (!approved) return;
    try {
      await jupiterGrantThirdPartyConsent(currentUser.id, app.id, SBER_TERMS_URL);
      showToast('Согласие сохранено. Юпитер отправляет отклик в Сбер', 'success');
      await load();
    } catch (error: any) {
      showToast(error?.message || 'Не удалось запустить отклик в Сбер', 'error');
    }
  };
  const requeueLive = async () => {
    if (!app || !currentUser?.id) return;
    try {
      const resumes = await dbGetResumeFiles();
      if (!resumes.some(file => file.selected && file.storagePath)) {
        showToast('Сначала загрузите PDF-резюме в профиле', 'error');
        router.push({ pathname: '/(tabs)/profile', params: { tab: 'files' } });
        return;
      }
      if (!await requestJupiterLive(currentUser.id)) return;
      await jupiterRequeueLive(currentUser.id, app.id);
      showToast('Юпитер повторно откроет анкету и отправит отклик', 'success');
      await load();
    } catch (error: any) {
      showToast(error?.message || 'Не удалось поставить отклик в очередь', 'error');
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Отклик</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: rs(40) }} color={Colors.primary} />
      ) : !app ? (
        <Text style={s.error}>{error || 'Отклик не найден'}</Text>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.hero}>
            {companyLogo(company) ? <CompanyMark company={company} size={rs(56)} /> : (
              <View style={[s.logo, { backgroundColor: nameColorFromString(company) }]}>
                <Text style={s.logoTxt}>{getInitials(company)}</Text>
              </View>
            )}
            {vacancyTitle ? <Text style={s.vacancyTitle} numberOfLines={2}>{vacancyTitle}</Text> : null}
            <Text style={vacancyTitle ? s.companySub : s.company} numberOfLines={2}>{company}</Text>
            <TouchableOpacity onPress={openSite} accessibilityLabel="Открыть сайт вакансии">
              <Text style={s.host} numberOfLines={1}>{hostOf(app.vacancyUrl)} ↗</Text>
            </TouchableOpacity>
            {status ? (
              <View style={[s.pill, { backgroundColor: status.bg }]}>
                <Text style={[s.pillTxt, { color: status.fg }]}>{status.label}</Text>
              </View>
            ) : null}
          </View>

          {canFill ? (
            <TouchableOpacity style={s.primaryBtn} onPress={openForm} activeOpacity={0.85}>
              <Text style={s.primaryBtnTxt}>Открыть анкету и отправить</Text>
            </TouchableOpacity>
          ) : null}

          {needsRequeue ? (
            <TouchableOpacity style={s.requeueBtn} onPress={() => void requeueLive()} activeOpacity={0.85}>
              <Text style={s.requeueBtnTxt}>Отправить через Юпитер</Text>
            </TouchableOpacity>
          ) : null}

          {/* Согласие для Сбера — в стиле «Add experience» у Sorce: мягкая
              подложка, иконка слева, пояснение и основная кнопка. */}
          {needsSberConsent ? (
            <View style={s.consentCard}>
              <View style={s.consentIcon}>
                <Ionicons name="shield-checkmark-outline" size={20} color={Colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.consentTitle}>Сбер просит ваше согласие</Text>
                <Text style={s.consentText}>
                  Без него Сбер не примет отклик. Юпитер отправит его сразу после согласия.
                </Text>
                <TouchableOpacity onPress={openSberTerms} accessibilityLabel="Условия Сбера">
                  <Text style={s.consentLink}>Условия Сбера</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.consentBtn} onPress={() => void grantSberConsent()} activeOpacity={0.85}>
                  <Text style={s.consentBtnTxt}>Согласиться и отправить</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <View style={s.card}>
            {waiting ? (
              <View style={s.step}>
                <View style={s.rail}>
                  <View style={[s.dot, s.dotPending]}><Ionicons name="ellipsis-horizontal" size={14} color="#9CA3AF" /></View>
                  <View style={s.line} />
                </View>
                <View style={s.stepBody}>
                  <Text style={[s.stepTitle, { color: '#6B7280' }]}>Ждём ответа работодателя</Text>
                  <Text style={s.stepNote}>Письма придут в «Почту JobToo»</Text>
                </View>
              </View>
            ) : null}
            {steps.length === 0 ? (
              <Text style={s.empty}>Истории пока нет — она появится со следующим шагом.</Text>
            ) : steps.map((step, i) => {
              const tone = TONE[step.tone];
              return (
                <View key={`${step.at}-${i}`} style={s.step}>
                  <View style={s.rail}>
                    <View style={[s.dot, { backgroundColor: tone.bg }]}>
                      <Ionicons name={tone.icon} size={14} color={tone.fg} />
                    </View>
                    {i < steps.length - 1 ? <View style={s.line} /> : null}
                  </View>
                  <View style={s.stepBody}>
                    <Text style={s.stepTitle}>{step.title}</Text>
                    {step.note ? <Text style={s.stepNote}>{step.note}</Text> : null}
                    <Text style={s.stepAt}>{when(step.at)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingVertical: rs(10),
  },
  headerTitle: { fontSize: rf(17), fontWeight: '700', color: Colors.textPrimary },
  content: { padding: rs(16), paddingBottom: rs(40) },
  error: { margin: rs(20), color: '#B91C1C', textAlign: 'center' },
  hero: { alignItems: 'center', marginBottom: rs(16) },
  logo: { width: rs(56), height: rs(56), borderRadius: rs(14), alignItems: 'center', justifyContent: 'center' },
  logoTxt: { color: '#fff', fontWeight: '800', fontSize: rf(20) },
  vacancyTitle: { fontSize: rf(20), fontWeight: '700', color: Colors.textPrimary, marginTop: rs(10), textAlign: 'center' },
  company: { fontSize: rf(20), fontWeight: '700', color: Colors.textPrimary, marginTop: rs(10), textAlign: 'center' },
  companySub: { fontSize: rf(14), color: Colors.textMuted, marginTop: rs(3), textAlign: 'center' },
  host: { fontSize: rf(13), color: Colors.primary, marginTop: rs(4) },
  pill: { marginTop: rs(10), borderRadius: 999, paddingHorizontal: rs(12), paddingVertical: rs(5) },
  pillTxt: { fontSize: rf(12), fontWeight: '700' },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: rs(13),
    alignItems: 'center', marginBottom: rs(16),
  },
  primaryBtnTxt: { color: '#fff', fontWeight: '800', fontSize: rf(15) },
  requeueBtn: {
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.primary, paddingVertical: rs(12),
    alignItems: 'center', marginBottom: rs(16),
  },
  requeueBtnTxt: { color: Colors.primary, fontWeight: '800', fontSize: rf(15) },
  // Как «Add experience» у Sorce: мягкая серая подложка, а не яркая плашка —
  // это подсказка, а не ошибка.
  consentCard: {
    flexDirection: 'row', gap: rs(12), backgroundColor: Colors.surface,
    borderRadius: Radius.lg, padding: rs(16), marginBottom: rs(16),
  },
  consentIcon: {
    width: rs(36), height: rs(36), borderRadius: rs(10), backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  consentTitle: { fontSize: rf(15), fontWeight: '700', color: Colors.textPrimary },
  consentText: { fontSize: rf(13), color: Colors.textSecondary, marginTop: rs(3), lineHeight: rf(18) },
  consentLink: { fontSize: rf(13), fontWeight: '600', color: Colors.primary, marginTop: rs(8) },
  consentBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: rs(11),
    alignItems: 'center', marginTop: rs(10),
  },
  consentBtnTxt: { color: '#fff', fontWeight: '800', fontSize: rf(14) },
  card: { backgroundColor: '#fff', borderRadius: Radius.lg, padding: rs(16) },
  empty: { color: '#6B7280', fontSize: rf(13) },
  step: { flexDirection: 'row' },
  rail: { width: rs(32), alignItems: 'center' },
  dot: { width: rs(28), height: rs(28), borderRadius: rs(14), alignItems: 'center', justifyContent: 'center' },
  dotPending: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#D1D5DB', backgroundColor: '#fff' },
  line: { width: 2, flex: 1, minHeight: rs(14), backgroundColor: '#E5E7EB', marginVertical: rs(2) },
  stepBody: { flex: 1, paddingLeft: rs(10), paddingBottom: rs(16) },
  stepTitle: { fontSize: rf(15), fontWeight: '600', color: Colors.textPrimary },
  stepNote: { fontSize: rf(13), color: '#4B5563', marginTop: rs(2) },
  stepAt: { fontSize: rf(12), color: '#9CA3AF', marginTop: rs(2) },
});
