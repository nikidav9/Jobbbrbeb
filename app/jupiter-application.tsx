// Карточка отклика Юпитера: статус, действие и история шагов — как у Sorce.
//
// Сюда ведёт строка отклика в «Откликах». Шаги пишет триггер базы
// (миграция 111, jm_jupiter_events), экран их только показывает. Согласие
// для Сбера и «Отправить через Юпитер» остаются кнопками под строкой в
// списке: там они уже отлажены.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, Radius } from '@/constants/theme';
import type { JupiterApplication } from '@/constants/types';
import { useApp } from '@/hooks/useApp';
import { jupiterApplicationEvents, jupiterMyApplications } from '@/services/db';
import { jupiterManualEligible } from '@/services/jupiterFill';
import { buildTimeline, jupiterStatus, TimelineStep } from '@/services/jupiterTimeline';
import { getInitials, nameColorFromString } from '@/services/storage';
import { rf, rs } from '@/constants/scale';

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
  const status = app ? jupiterStatus(app) : null;
  const canFill = !!app && jupiterManualEligible(app);
  const waiting = app?.state === 'submitted';

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
            <View style={[s.logo, { backgroundColor: nameColorFromString(company) }]}>
              <Text style={s.logoTxt}>{getInitials(company)}</Text>
            </View>
            <Text style={s.company} numberOfLines={2}>{company}</Text>
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
  company: { fontSize: rf(20), fontWeight: '700', color: Colors.textPrimary, marginTop: rs(10), textAlign: 'center' },
  host: { fontSize: rf(13), color: Colors.primary, marginTop: rs(4) },
  pill: { marginTop: rs(10), borderRadius: 999, paddingHorizontal: rs(12), paddingVertical: rs(5) },
  pillTxt: { fontSize: rf(12), fontWeight: '700' },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: rs(13),
    alignItems: 'center', marginBottom: rs(16),
  },
  primaryBtnTxt: { color: '#fff', fontWeight: '800', fontSize: rf(15) },
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
