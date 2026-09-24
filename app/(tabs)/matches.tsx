import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, RefreshControl, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { Like, User, Vacancy, PermApplication, PermApplicationStatus, PermVacancy, Chat, ReportableOutcome, JupiterApplication, JupiterApplicationState } from '@/constants/types';
import { formatDate, getInitials, nameColorFromString } from '@/services/storage';
import {
  dbUpsertLike, dbCheckAndCreateMatch, dbSetShiftOutcome,
  dbApprovePermApplication, dbSetPermApplicationStatus, jupiterMyApplications,
  jupiterLiveStatus, jupiterSetLive, jupiterRequeueLive, dbGetResumeFiles,
} from '@/services/db';
import { requestJupiterLive } from '@/services/jupiterLive';
import { plural } from '@/services/time';
import { dayKey, groupByDay } from '@/services/dayGroups';
import { TabHeader } from '@/components/ui/TabHeader';
import GuestGate from '@/components/GuestGate';
import { ScoreBadge } from '@/components/feature/ScoreCard';
import { rankCandidate } from '@/services/matching';
import { useMissingUsers } from '@/hooks/useMissingUsers';
import { employerLikes, employerPending, employerMatched, employerCompleted,
  employerPermApps } from '@/services/matchCounts';
import { ApplySheet } from '@/components/feature/ApplySheet';
import { PERM_APPROVE_SUGGESTIONS } from '@/constants/chatSuggestions';
import { OnboardingTarget } from '@/components/OnboardingTarget';

import { rs, rf } from '@/constants/scale';

// ─── Status badge ─────────────────────────────────────────────────────────────
function MatchStatus({ like, isWorker }: { like: Like; isWorker: boolean }) {
  if (like.cancelled) {
    // Смены до августа 2026 (`cancelled_legacy`) и те, где исход почему-то не
    // записался, показываем прежней общей надписью: причины у них нет, и
    // выдумывать её задним числом нельзя.
    const почему =
      like.outcome === 'no_show' ? 'Работник не вышел'
      : like.outcome === 'worker_cancelled' ? 'Работник отказался'
      : like.outcome === 'employer_cancelled' ? 'Смену отменил работодатель'
      : like.outcome === 'other_cancelled' ? 'Смена отменена'
      : 'Смена отменена';
    return (
      <View style={[s.statusBadge, { backgroundColor: '#FEE2E2' }]}>
        <Ionicons name="close-circle" size={14} color={Colors.red} />
        <Text style={[s.statusTxt, { color: Colors.red }]}>{почему}</Text>
      </View>
    );
  }
  if (like.shiftCompleted) {
    // Опоздание не прячем: оно и так уже в рейтинге, а увидеть его на карточке
    // честнее, чем узнать о нём только из цифры в профиле.
    const опоздал = (like.lateMinutes ?? 0) > 0;
    return (
      <View style={[s.statusBadge, { backgroundColor: опоздал ? '#FEF3C7' : '#D1FAE5' }]}>
        <Ionicons
          name={опоздал ? 'alert-circle' : 'checkmark-circle'}
          size={14}
          color={опоздал ? '#B45309' : Colors.green}
        />
        <Text style={[s.statusTxt, { color: опоздал ? '#B45309' : Colors.green }]}>
          {опоздал ? 'Завершена, с опозданием' : 'Смена завершена'}
        </Text>
      </View>
    );
  }
  if (like.isMatch) {
    if (isWorker) {
      if (like.shiftCompleted && !like.workerRated)
        return (
          <View style={[s.statusBadge, { backgroundColor: '#FFF7ED' }]}>
            <Ionicons name="star" size={14} color="#92400E" />
            <Text style={[s.statusTxt, { color: '#92400E' }]}>Оставьте отзыв о работодателе!</Text>
          </View>
        );
    } else {
      if (!like.employerConfirmed)
        return (
          <View style={[s.statusBadge, { backgroundColor: Colors.primaryLight }]}>
            <Ionicons name="time-outline" size={14} color={Colors.primary} />
            <Text style={[s.statusTxt, { color: Colors.primary }]}>Подтвердите смену</Text>
          </View>
        );
      if (like.employerConfirmed && !like.employerRated)
        return (
          <View style={[s.statusBadge, { backgroundColor: '#FFF7ED' }]}>
            <Ionicons name="star" size={14} color="#92400E" />
            <Text style={[s.statusTxt, { color: '#92400E' }]}>Оцените работника!</Text>
          </View>
        );
    }
    return (
      <View style={[s.statusBadge, { backgroundColor: Colors.primaryLight }]}>
        <Ionicons name="heart" size={14} color={Colors.primary} />
        <Text style={[s.statusTxt, { color: Colors.primary }]}>Мэтч!</Text>
      </View>
    );
  }
  if (like.employerLiked === false) {
    return (
      <View style={[s.statusBadge, { backgroundColor: '#FEE2E2' }]}>
        <Ionicons name="close-circle" size={14} color={Colors.red} />
        <Text style={[s.statusTxt, { color: Colors.red }]}>Отказ</Text>
      </View>
    );
  }
  return (
    <View style={[s.statusBadge, { backgroundColor: Colors.surface }]}>
      <Ionicons name="time-outline" size={14} color={Colors.textMuted} />
      <Text style={[s.statusTxt, { color: Colors.textMuted }]}>На рассмотрении</Text>
    </View>
  );
}

// ─── Отметка исхода смены (у работодателя) ────────────────────────────────────
//
// Раньше здесь была галочка и крестик: смена либо «завершена», либо
// «отменена». Отменённой оказывалась и та, где работник не вышел, и та, где
// он честно предупредил накануне, и та, которую отменил сам работодатель.
// Три разных факта, из которых для рейтинга годится только первый, лежали в
// базе одной строкой и были неразличимы.
//
// Спрашиваем в два касания, не больше: чем длиннее опрос, тем чаще его
// пропускают, а пропущенная отметка — это дыра в истории работника.

// Опоздание спрашиваем корзинами, а не минутами: точную цифру никто не
// помнит, а «до пятнадцати» помнят все. Пишем середину корзины — на проценте
// пунктуальности разница неощутима, а в споре видно, о каком порядке речь.
const LATE_BUCKETS: { label: string; minutes: number }[] = [
  { label: 'до 15 минут',   minutes: 10 },
  { label: '15–30 минут',   minutes: 22 },
  { label: '30–60 минут',   minutes: 45 },
  { label: 'больше часа',   minutes: 90 },
];

function DialogRow({ title, sub, tone = 'plain', onPress }: {
  title: string;
  sub?: string;
  tone?: 'plain' | 'good' | 'bad';
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={s.choiceRow} onPress={onPress} activeOpacity={0.75}>
      <View style={{ flex: 1 }}>
        <Text style={[
          s.choiceTitle,
          tone === 'good' ? { color: Colors.green } : null,
          tone === 'bad' ? { color: Colors.red } : null,
        ]}>{title}</Text>
        {sub ? <Text style={s.choiceSub}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={rf(16)} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

function ConfirmBanner({ onOutcome, loading }: {
  onOutcome: (outcome: ReportableOutcome, lateMinutes?: number) => void;
  loading: boolean;
}) {
  // null — окно закрыто; 'came' — вышел ли; 'late' — насколько опоздал;
  // 'failed' — почему не состоялась.
  const [step, setStep] = useState<null | 'came' | 'late' | 'failed'>(null);
  const close = () => setStep(null);

  return (
    <>
      <View style={s.confirmBanner}>
        <Ionicons name="time-outline" size={22} color="#92400E" />
        <View style={{ flex: 1 }}>
          <Text style={s.confirmBannerTitle}>Отметьте смену</Text>
          <Text style={s.confirmBannerSub}>Вышел ли работник — и вовремя ли</Text>
        </View>
        <View style={s.confirmBannerActions}>
          <TouchableOpacity
            style={s.confirmBannerBtn}
            onPress={() => setStep('came')}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator size="small" color="#fff" />
              : <><Ionicons name="checkmark" size={14} color="#fff" /><Text style={s.confirmBannerBtnTxt}>Состоялась</Text></>
            }
          </TouchableOpacity>
          <TouchableOpacity
            style={s.cancelShiftBtn}
            onPress={() => setStep('failed')}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={s.cancelShiftBtnTxt}>Отменить смену</Text>
          </TouchableOpacity>
        </View>
      </View>

      {step === 'came' ? (
        <View style={s.dialogOverlay}>
          <View style={s.dialogCard}>
            <Text style={s.dialogTitle}>Как прошла смена?</Text>
            <Text style={s.dialogBody}>
              Ответ попадёт в рейтинг работника — его видят другие работодатели.
            </Text>
            <View style={s.choices}>
              <DialogRow
                title="Вышел вовремя"
                tone="good"
                onPress={() => { close(); onOutcome('worked', 0); }}
              />
              <DialogRow
                title="Вышел, но опоздал"
                onPress={() => setStep('late')}
              />
            </View>
            <TouchableOpacity style={s.dialogCancelBtn} onPress={close} activeOpacity={0.8}>
              <Text style={s.dialogCancelTxt}>Позже</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {step === 'late' ? (
        <View style={s.dialogOverlay}>
          <View style={s.dialogCard}>
            <Text style={s.dialogTitle}>Насколько опоздал?</Text>
            <View style={s.choices}>
              {LATE_BUCKETS.map(b => (
                <DialogRow
                  key={b.minutes}
                  title={b.label}
                  onPress={() => { close(); onOutcome('worked', b.minutes); }}
                />
              ))}
            </View>
            <TouchableOpacity style={s.dialogCancelBtn} onPress={() => setStep('came')} activeOpacity={0.8}>
              <Text style={s.dialogCancelTxt}>Назад</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {step === 'failed' ? (
        <View style={s.dialogOverlay}>
          <View style={s.dialogCard}>
            <Text style={s.dialogTitle}>Что произошло?</Text>
            <Text style={s.dialogBody}>
              Смена уйдёт в «Завершённые». Оценивать никого не нужно.
            </Text>
            <View style={s.choices}>
              <DialogRow
                title="Не вышел"
                sub="Не пришёл и не предупредил — это снизит его рейтинг"
                tone="bad"
                onPress={() => { close(); onOutcome('no_show'); }}
              />
              <DialogRow
                title="Отказался заранее"
                sub="Предупредил до начала смены"
                onPress={() => { close(); onOutcome('worker_cancelled'); }}
              />
              <DialogRow
                title="Отменили мы"
                sub="Смена не понадобилась — на рейтинг работника не влияет"
                onPress={() => { close(); onOutcome('employer_cancelled'); }}
              />
              <DialogRow
                title="Другая причина"
                sub="Нейтральная отмена — рейтинг сторон не изменится"
                onPress={() => { close(); onOutcome('other_cancelled'); }}
              />
            </View>
            <TouchableOpacity style={s.dialogCancelBtn} onPress={close} activeOpacity={0.8}>
              <Text style={s.dialogCancelTxt}>Закрыть</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────────────
// WORKER VIEW
// ─────────────────────────────────────────────────
// ─── Отклики соискателя ───────────────────────────────────────────────────────
// Экран работника «Отклики».
//
// Прежняя версия жила на jm_likes — откликах на смены; смен в сервисе больше
// нет, и без переноса экран остался бы пустым при живых заявках.
//
// Раскладка взята с макета владельца, понятия — наши. Четыре блока оттуда у
// нас физически отсутствуют: автозаполнение анкет («N apps filled today»),
// «вопросы к заполнению» (ACTION), архив и звёздочка. Рисовать их пустыми
// значило бы обещать то, чего нет, поэтому на их месте то, что у нас есть:
// счёт откликов за сегодня, «ждут вашего ответа» = непрочитанные переписки,
// и «Избранное» — единственный из разделов VIEWS, под которым есть данные.

/** Как статус отклика выглядит для человека. */
function permAppStatus(status: PermApplicationStatus): {
  label: string; fg: string; bg: string; icon: React.ComponentProps<typeof Ionicons>['name'];
} {
  switch (status) {
    case 'approved':
      return { label: 'Интервью', fg: '#1D4ED8', bg: '#DBEAFE', icon: 'calendar-outline' };
    case 'rejected':
      return { label: 'Отказ', fg: Colors.red, bg: '#FEE2E2', icon: 'close-circle-outline' };
    case 'hired':
      return { label: 'Оффер', fg: '#047857', bg: '#D1FAE5', icon: 'checkmark-circle-outline' };
    default:
      return { label: 'Рассматривают', fg: '#B45309', bg: '#FEF3C7', icon: 'time-outline' };
  }
}

function jupiterAppStatus(state: JupiterApplicationState): { label: string; fg: string; bg: string } {
  switch (state) {
    case 'ready_to_submit':
      return { label: 'Анкета заполнена · не отправлена', fg: '#B45309', bg: '#FEF3C7' };
    case 'submitted':
      return { label: 'Отправлено', fg: '#047857', bg: '#D1FAE5' };
    case 'action_required':
      return { label: 'Нужно ваше участие', fg: '#B45309', bg: '#FEF3C7' };
    case 'submission_unknown':
      return { label: 'Отправка не подтверждена', fg: '#B45309', bg: '#FEF3C7' };
    case 'failed':
      return { label: 'Не удалось заполнить', fg: Colors.red, bg: '#FEE2E2' };
    case 'retryable_failed':
      return { label: 'Повторит позже', fg: '#B45309', bg: '#FEF3C7' };
    case 'duplicate':
      return { label: 'Повтор не отправлен', fg: '#047857', bg: '#D1FAE5' };
    default:
      return { label: 'Юпитер обрабатывает', fg: '#1D4ED8', bg: '#DBEAFE' };
  }
}

type AppFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'hired';

const APP_FILTERS: { key: AppFilter; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'all', label: 'Все', icon: 'file-tray-outline' },
  { key: 'pending', label: 'Рассматривают', icon: 'time-outline' },
  { key: 'approved', label: 'Интервью', icon: 'chatbubbles-outline' },
  { key: 'hired', label: 'Оффер', icon: 'checkmark-circle-outline' },
  { key: 'rejected', label: 'Отказы', icon: 'close-circle-outline' },
];

function WorkerMatches() {
  const router = useRouter();
  const {
    currentUser, permApplications, permVacancies, users, chats,
    permSavedIds, showToast,
    refreshAll, offline,
  } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<AppFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [jupiterApps, setJupiterApps] = useState<JupiterApplication[]>([]);
  const [jupiterError, setJupiterError] = useState(false);
  const [jupiterLive, setJupiterLive] = useState(false);
  const tabBarHeight = useBottomTabBarHeight();

  const currentUserId = currentUser?.id ?? '';
  const loadJupiter = useCallback(async () => {
    if (!currentUserId || currentUser?.isGuest) return;
    try {
      const [apps, live] = await Promise.all([
        jupiterMyApplications(currentUserId), jupiterLiveStatus(currentUserId),
      ]);
      setJupiterApps(apps);
      setJupiterLive(live);
      setJupiterError(false);
    } catch (error) {
      console.warn('[jupiterMyApplications]', error);
      setJupiterError(true);
    }
  }, [currentUserId, currentUser?.isGuest]);

  useFocusEffect(useCallback(() => { void loadJupiter(); }, [loadJupiter]));

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshAll(), loadJupiter()]);
    } catch {
      showToast('Не удалось обновить отклики. Проверьте связь.', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const myApps = useMemo(
    () => permApplications
      .filter((a: PermApplication) => a.workerId === currentUserId)
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [permApplications, currentUserId],
  );

  const neededEmployerIds = useMemo<string[]>(
    () => Array.from(new Set(myApps.map(a => a.employerId).filter(Boolean))) as string[],
    [myApps],
  );
  const getEmployer = useMissingUsers(users, neededEmployerIds);

  const myChats = useMemo(
    () => chats.filter((c: Chat) => c.workerId === currentUserId),
    [chats, currentUserId],
  );
  const unreadChats = useMemo(
    () => myChats.filter(c => (c.unreadWorker ?? 0) > 0),
    [myChats],
  );

  if (!currentUser) return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;

  const getVacancy = (id: string): PermVacancy | undefined =>
    permVacancies.find((v: PermVacancy) => v.id === id);

  const companyOf = (a: PermApplication): string =>
    getVacancy(a.vacancyId)?.company ?? getEmployer(a.employerId)?.company ?? 'Работодатель';

  // Поиск и фильтр по статусу — над одним и тем же списком, поэтому считаются
  // подряд, а не двумя независимыми выборками.
  const q = search.trim().toLowerCase();
  const shownJupiterApps = filter === 'all'
    ? jupiterApps.filter(a => !q || `${a.company ?? ''} ${a.vacancyUrl}`.toLowerCase().includes(q))
    : [];
  const shownApps = myApps.filter(a => {
    if (filter !== 'all' && a.status !== filter) return false;
    if (!q) return true;
    const v = getVacancy(a.vacancyId);
    return `${v?.title ?? ''} ${companyOf(a)}`.toLowerCase().includes(q);
  });

  // Группировка по дням: заголовок с числом, как «ВЧЕРА · 15 откликов».
  const byDay = groupByDay(shownApps, a => a.createdAt);

  const today = dayKey(new Date().toISOString());
  const todayCount = myApps.filter(a => dayKey(a.createdAt) === today).length
    + jupiterApps.filter(a => a.state === 'submitted' && a.submittedAt && dayKey(a.submittedAt) === today).length;

  // Обрыв связи и пустой список — разные вещи: «нет откликов» человек,
  // только что откликнувшийся, читает как «мой отклик пропал».
  const offlineHere = offline.permApplications && myApps.length === 0 && jupiterApps.length === 0;

  const openApp = (a: PermApplication) =>
    router.push({ pathname: '/perm-vacancy-detail', params: { id: a.vacancyId } });

  // ── Строка отклика ─────────────────────────────────────────────────────────
  const renderApp = (a: PermApplication, last: boolean) => {
    const v = getVacancy(a.vacancyId);
    const company = companyOf(a);
    const st = permAppStatus(a.status);
    const chat = myChats.find(c => c.vacancyId === a.vacancyId);
    const needsYou = (chat?.unreadWorker ?? 0) > 0;

    return (
      <TouchableOpacity
        key={a.id}
        style={[wm.row, needsYou && wm.rowNeedsYou, !last && wm.rowDivider]}
        activeOpacity={0.85}
        onPress={() => (needsYou && chat ? router.push({ pathname: '/chat-room', params: { chatId: chat.id } }) : openApp(a))}
      >
        <View style={[wm.logo, { backgroundColor: nameColorFromString(company) }]}>
          <Text style={wm.logoTxt}>{getInitials(company)}</Text>
        </View>

        <View style={wm.rowBody}>
          <Text style={wm.rowTitle} numberOfLines={2}>{v?.title ?? 'Вакансия'}</Text>
          <Text style={wm.rowCompany} numberOfLines={1}>{company}</Text>
          {needsYou ? (
            <Text style={wm.rowHint} numberOfLines={1}>
              {chat!.unreadWorker ?? 0}{' '}
              {plural(chat!.unreadWorker ?? 0, 'новое сообщение', 'новых сообщения', 'новых сообщений')}
            </Text>
          ) : null}
        </View>

        {needsYou ? (
          <View style={wm.action}>
            <Text style={wm.actionTxt}>ОТВЕТИТЬ</Text>
            <Ionicons name="arrow-forward" size={13} color={Colors.primary} />
          </View>
        ) : (
          <View style={[wm.statusPill, { backgroundColor: st.bg }]}>
            <Text style={[wm.statusTxt, { color: st.fg }]}>{st.label.toUpperCase()}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderJupiterApp = (a: JupiterApplication, last: boolean) => {
    const company = a.company?.trim() || 'Карьерный сайт';
    const status = a.reasonCode === 'LIVE_AUTHORIZATION_REVOKED'
      ? { label: 'Автоотклик выключен · не отправлено', fg: '#B45309', bg: '#FEF3C7' }
      : a.reasonCode === 'UNSUPPORTED_SCRIPT'
        ? { label: 'Нужен браузер · отклик не отправлен', fg: '#B45309', bg: '#FEF3C7' }
        : jupiterAppStatus(a.state);
    const canApplyManually = ['ready_to_submit', 'action_required', 'failed'].includes(a.state);
    return (
      <React.Fragment key={a.id}>
      <TouchableOpacity
        style={[wm.row, !last && wm.rowDivider]}
        activeOpacity={canApplyManually ? 0.85 : 1}
        disabled={!canApplyManually}
        onPress={() => Linking.openURL(a.vacancyUrl).catch(() => showToast('Не удалось открыть сайт компании', 'error'))}
        accessibilityLabel={`${company}. ${status.label}${canApplyManually ? '. Открыть вакансию на сайте' : ''}`}
      >
        <View style={[wm.logo, { backgroundColor: nameColorFromString(company) }]}>
          <Text style={wm.logoTxt}>{getInitials(company)}</Text>
        </View>
        <View style={wm.rowBody}>
          <Text style={wm.rowTitle} numberOfLines={2}>{company}</Text>
          <Text style={wm.rowCompany} numberOfLines={1}>Вакансия на карьерном сайте</Text>
          <View style={[wm.statusPill, { alignSelf: 'flex-start', backgroundColor: status.bg, marginTop: rs(6) }]}>
            <Text style={[wm.statusTxt, { color: status.fg }]}>{status.label}</Text>
          </View>
        </View>
        {canApplyManually ? <Ionicons name="open-outline" size={18} color={Colors.primary} /> : null}
      </TouchableOpacity>
      {((a.state === 'ready_to_submit' && !a.submissionAuthorizedAt)
        || (a.state === 'action_required' && a.reasonCode === 'LIVE_AUTHORIZATION_REVOKED')) ? (
        <TouchableOpacity
          style={{ paddingVertical: rs(10), paddingHorizontal: rs(20), alignSelf: 'flex-start' }}
          onPress={() => { void (async () => {
            try {
              const resumes = await dbGetResumeFiles();
              if (!resumes.some(file => file.selected && file.storagePath)) {
                showToast('Сначала загрузите PDF-резюме в профиле', 'error');
                router.push({ pathname: '/(tabs)/profile', params: { tab: 'files' } });
                return;
              }
              if (!await requestJupiterLive(currentUserId)) return;
              setJupiterLive(true);
              await jupiterRequeueLive(currentUserId, a.id);
              showToast('Юпитер повторно откроет анкету и отправит отклик', 'success');
              await loadJupiter();
            } catch (error: any) {
              showToast(error?.message || 'Не удалось поставить отклик в очередь', 'error');
            }
          })(); }}
        >
          <Text style={{ color: Colors.primary, fontWeight: '700' }}>Отправить через Юпитер</Text>
        </TouchableOpacity>
      ) : null}
      </React.Fragment>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      {/* Шапка: марка слева, действия справа — как на макете. Конверт ведёт
          в переписки, закладка — в избранное, лупа раскрывает поиск. */}
      <View style={wm.header}>
        <Image
          source={require('@/assets/images/header-jt-logo.png')}
          style={wm.logoMark}
          contentFit="contain"
          accessibilityLabel="JobToo"
        />
        <View style={wm.headerActions}>
          <OnboardingTarget targetKey="matches.saved">
            <TouchableOpacity
              style={wm.headerBtn}
              onPress={() => router.push('/saved')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Избранное"
            >
              <Ionicons name="bookmark-outline" size={20} color={Colors.textPrimary} />
            </TouchableOpacity>
          </OnboardingTarget>

          <OnboardingTarget targetKey="matches.chats">
            <TouchableOpacity
              style={wm.headerBtn}
              onPress={() => router.push(currentUser?.role === 'worker' ? '/mail' : '/(tabs)/chats')}
              activeOpacity={0.8}
              accessibilityLabel={currentUser?.role === 'worker' ? 'Почта JobToo' : 'Переписки'}
            >
              <Ionicons name="mail-outline" size={20} color={Colors.textPrimary} />
              {unreadChats.length > 0 ? (
                <View style={wm.headerBadge}>
                  <Text style={wm.headerBadgeTxt}>{unreadChats.length > 9 ? '9+' : unreadChats.length}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </OnboardingTarget>

          <TouchableOpacity
            style={[wm.headerBtn, searchOpen && wm.headerBtnOn]}
            onPress={() => { setSearchOpen(o => !o); if (searchOpen) setSearch(''); }}
            activeOpacity={0.8}
            accessibilityLabel={searchOpen ? 'Закрыть поиск' : 'Искать по откликам'}
          >
            <Ionicons name="search" size={20} color={searchOpen ? Colors.primary : Colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={wm.title}>
        {todayCount} {plural(todayCount, 'отклик', 'отклика', 'откликов')} за сегодня
      </Text>

      {searchOpen ? (
        <View style={wm.searchWrap}>
          <Ionicons name="search" size={18} color={Colors.textMuted} />
          <TextInput
            style={wm.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Должность или компания"
            placeholderTextColor={Colors.textMuted}
            returnKeyType="search"
            autoFocus
            accessibilityLabel="Поиск по откликам"
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Очистить поиск">
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={wm.chipsScroll}
        contentContainerStyle={wm.chipsRow}
      >
          <TouchableOpacity
            style={[wm.chipIcon, filter !== 'all' && wm.chipIconOn]}
            onPress={() => setFilterOpen(true)}
            activeOpacity={0.8}
            accessibilityLabel="Фильтры"
          >
            <Ionicons name="options-outline" size={18} color={filter !== 'all' ? '#FFFFFF' : Colors.textSecondary} />
          </TouchableOpacity>
          {APP_FILTERS.map(f => {
            const on = filter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[wm.chip, on && wm.chipOn]}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Ionicons name={f.icon} size={15} color={on ? Colors.textPrimary : Colors.textSecondary} />
                <Text style={[wm.chipTxt, on && wm.chipTxtOn]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
      </ScrollView>

      <OnboardingTarget targetKey="matches.content" style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[wm.list, { paddingBottom: tabBarHeight + rs(16) }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />
          }
        >
          <>
            {filter === 'all' && (shownJupiterApps.length > 0 || jupiterError || jupiterLive) ? (
              <>
                <View style={wm.sectionHead}>
                  <Text style={wm.sectionTitle}>Юпитер · внешние вакансии</Text>
                </View>
                <Text style={[s.emptySub, { textAlign: 'left', marginBottom: rs(12) }]}>
                  {jupiterLive
                    ? 'Новые отклики Юпитер отправляет работодателям. Неясные вопросы, капча и коды требуют вашего участия.'
                    : 'Автоотклик выключен. Старые заявки остаются в режиме заполнения без отправки.'}
                </Text>
                {jupiterLive ? (
                  <TouchableOpacity onPress={() => { void (async () => {
                    try {
                      await jupiterSetLive(currentUserId, false);
                      setJupiterLive(false);
                      showToast('Будущие отправки остановлены. Уже начатый запрос мог уйти.', 'info');
                    } catch { showToast('Не удалось выключить автоотклик', 'error'); }
                  })(); }} style={{ marginBottom: rs(12) }}>
                    <Text style={{ color: Colors.primary, fontWeight: '600' }}>Выключить автоотклик</Text>
                  </TouchableOpacity>
                ) : null}
                {jupiterError ? <Text style={s.emptySub}>Не удалось обновить статусы Юпитера. Потяните вниз для повтора.</Text> : null}
                {shownJupiterApps.length > 0 ? (
                  <View style={wm.group}>
                    {shownJupiterApps.map((a, i) => renderJupiterApp(a, i === shownJupiterApps.length - 1))}
                  </View>
                ) : null}
              </>
            ) : null}
            {/* Переписки внутри JobToo остаются отдельными от заявок Jupiter:
                ответ работодателю и незаполненная внешняя анкета — разные шаги. */}
            {unreadChats.length > 0 ? (
              <>
                <View style={wm.sectionHead}>
                  <Text style={wm.sectionTitle}>Ждут вашего ответа</Text>
                  <View style={wm.sectionDot} />
                </View>
                <TouchableOpacity
                  style={wm.needsCard}
                  activeOpacity={0.85}
                  onPress={() => router.push('/(tabs)/chats')}
                >
                  <View style={wm.needsIcon}>
                    <Ionicons name="notifications" size={22} color="#B45309" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={wm.needsTitle}>
                      {unreadChats.length}{' '}
                      {plural(unreadChats.length, 'переписка ждёт', 'переписки ждут', 'переписок ждут')} ответа
                    </Text>
                    <Text style={wm.needsSub} numberOfLines={1}>
                      {unreadChats.map(c => c.companyName || c.vacTitle).filter(Boolean).join(', ')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </>
            ) : null}

            {shownApps.length === 0 && shownJupiterApps.length === 0 ? (
              <View style={s.empty}>
                <Ionicons
                  name={offlineHere ? 'cloud-offline-outline' : 'clipboard-outline'}
                  size={56}
                  color={Colors.textMuted}
                />
                <Text style={s.emptyTitle}>
                  {offlineHere ? 'Нет связи с сервером' : 'Пока нет откликов'}
                </Text>
                <Text style={s.emptySub}>
                  {offlineHere
                    ? 'Список не загрузился — дело в связи. Ваши отклики на месте, потяните вниз, чтобы обновить.'
                    : 'Откликайтесь на вакансии — они появятся здесь'}
                </Text>
              </View>
            ) : byDay.map(day => (
              <View key={day.key || 'earlier'}>
                <Text style={wm.dayHead}>
                  {day.label} · {day.items.length} {plural(day.items.length, 'отклик', 'отклика', 'откликов')}
                </Text>
                <View style={wm.group}>
                  {day.items.map((a, i) => renderApp(a, i === day.items.length - 1))}
                </View>
              </View>
            ))}
          </>
        </ScrollView>
      </OnboardingTarget>

      {/* Шторка фильтров. Раздел «Показать» на макете содержит четыре строки;
          у нас данные есть ровно под одну — избранное. Остальные три
          (звёздочка, архив, «вы их пропустили») не хранятся вовсе. */}
      {filterOpen ? (
        <View style={wm.sheetOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setFilterOpen(false)} />
          <View style={[wm.sheet, { paddingBottom: tabBarHeight + rs(24) }]}>
            <View style={wm.sheetGrabber} />
            <View style={wm.sheetHead}>
              <TouchableOpacity style={wm.sheetClose} onPress={() => setFilterOpen(false)} accessibilityLabel="Закрыть">
                <Ionicons name="close" size={20} color={Colors.textPrimary} />
              </TouchableOpacity>
              <Text style={wm.sheetTitle}>Фильтр</Text>
              <TouchableOpacity style={wm.sheetOk} onPress={() => setFilterOpen(false)} accessibilityLabel="Применить">
                <Ionicons name="checkmark" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <Text style={wm.sheetLabel}>СТАТУС</Text>
            <View style={wm.sheetChips}>
              {APP_FILTERS.map(f => {
                const on = filter === f.key;
                return (
                  <TouchableOpacity
                    key={f.key}
                    style={[wm.chip, wm.sheetChip, on && wm.chipOn]}
                    onPress={() => setFilter(f.key)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Ionicons name={f.icon} size={15} color={on ? Colors.textPrimary : Colors.textSecondary} />
                    <Text style={[wm.chipTxt, on && wm.chipTxtOn]}>{f.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={wm.sheetLabel}>ПОКАЗАТЬ</Text>
            <TouchableOpacity
              style={wm.sheetRow}
              activeOpacity={0.8}
              onPress={() => { setFilterOpen(false); router.push('/saved'); }}
            >
              <View style={wm.sheetRowIcon}>
                <Ionicons name="bookmark-outline" size={18} color={Colors.textPrimary} />
              </View>
              <Text style={wm.sheetRowTxt}>Избранное</Text>
              <Text style={wm.sheetRowCount}>{permSavedIds.length}</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const wm = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingTop: rs(6), paddingBottom: rs(4),
  },
  logoMark: { width: rs(40), height: rs(26), flexShrink: 0 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: rs(10) },
  headerBtn: {
    width: rs(44), height: rs(44), borderRadius: rs(22),
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', ...Shadow.card,
  },
  headerBtnOn: { backgroundColor: Colors.primaryLight },
  headerBadge: {
    position: 'absolute', top: rs(1), right: rs(1),
    minWidth: rs(18), height: rs(18), borderRadius: rs(9), paddingHorizontal: rs(4),
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderWidth: 2, borderColor: '#FFFFFF',
  },
  headerBadgeTxt: { color: '#FFFFFF', fontSize: rf(10), fontWeight: '800' },

  title: {
    fontSize: rf(20), fontWeight: '400', color: Colors.textPrimary,
    paddingHorizontal: rs(16), paddingTop: rs(10), paddingBottom: rs(12),
  },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    marginHorizontal: rs(16), marginBottom: rs(10),
    backgroundColor: '#F2F3F5', borderRadius: rs(24),
    paddingHorizontal: rs(14), height: rs(44),
  },
  searchInput: { flex: 1, fontSize: rf(14), color: Colors.textPrimary, padding: 0 },

  chipsScroll: { flexGrow: 0, flexShrink: 0 },
  chipsRow: { flexDirection: 'row', alignItems: 'center', gap: rs(8), paddingHorizontal: rs(16), paddingBottom: rs(12) },
  chipIcon: {
    width: rs(44), height: rs(40), borderRadius: rs(20), flexShrink: 0,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF',
  },
  chipIconOn: { backgroundColor: Colors.primary },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: rs(6), flexShrink: 0,
    height: rs(40), paddingHorizontal: rs(16), borderRadius: rs(20),
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: 'transparent',
  },
  chipOn: { borderColor: Colors.textPrimary },
  chipTxt: { fontSize: rf(14), fontWeight: '600', color: Colors.textSecondary },
  chipTxtOn: { color: Colors.textPrimary, fontWeight: '700' },

  list: { paddingHorizontal: rs(16), gap: rs(4) },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: rs(8), paddingBottom: rs(10) },
  sectionTitle: { fontSize: rf(17), fontWeight: '800', color: Colors.textPrimary },
  sectionDot: {
    width: rs(14), height: rs(14), borderRadius: rs(7),
    backgroundColor: '#B45309', borderWidth: 3, borderColor: '#FDE8CC',
  },

  needsCard: {
    flexDirection: 'row', alignItems: 'center', gap: rs(12),
    backgroundColor: '#FFFFFF', borderRadius: rs(16),
    padding: rs(14), marginBottom: rs(18), ...Shadow.card,
  },
  needsIcon: {
    width: rs(44), height: rs(44), borderRadius: rs(12),
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF3C7',
  },
  needsTitle: { fontSize: rf(16), fontWeight: '800', color: Colors.textPrimary },
  needsSub: { fontSize: rf(13), color: Colors.textMuted, marginTop: rs(2) },

  dayHead: {
    fontSize: rf(12), fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 0.4, paddingTop: rs(10), paddingBottom: rs(8),
  },
  group: { backgroundColor: '#FFFFFF', borderRadius: rs(16), overflow: 'hidden', ...Shadow.card },

  row: { flexDirection: 'row', alignItems: 'center', gap: rs(12), padding: rs(14) },
  rowNeedsYou: { backgroundColor: '#FEF6ED' },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: Colors.divider },
  logo: {
    width: rs(44), height: rs(44), borderRadius: rs(12),
    alignItems: 'center', justifyContent: 'center',
  },
  logoTxt: { color: '#FFFFFF', fontSize: rf(15), fontWeight: '800' },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: rf(15.5), fontWeight: '700', color: Colors.textPrimary, lineHeight: rf(20) },
  rowCompany: { fontSize: rf(13.5), color: Colors.textMuted, marginTop: rs(2) },
  rowHint: { fontSize: rf(13), color: Colors.textSecondary, marginTop: rs(3) },

  statusPill: { borderRadius: rs(8), paddingHorizontal: rs(9), paddingVertical: rs(5), flexShrink: 0 },
  statusTxt: { fontSize: rf(10.5), fontWeight: '800', letterSpacing: 0.3 },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: rs(5), flexShrink: 0,
    borderRadius: rs(8), paddingHorizontal: rs(10), paddingVertical: rs(6),
    borderWidth: 1, borderColor: Colors.primary, borderStyle: 'dashed',
  },
  actionTxt: { fontSize: rf(10.5), fontWeight: '800', color: Colors.primary, letterSpacing: 0.3 },
  unsaveBtn: { padding: rs(4), flexShrink: 0 },

  sheetOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17,17,17,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#F7F8FA', borderTopLeftRadius: rs(24), borderTopRightRadius: rs(24),
    paddingHorizontal: rs(16),
  },
  sheetGrabber: {
    width: rs(44), height: rs(5), borderRadius: rs(3), backgroundColor: Colors.divider,
    alignSelf: 'center', marginTop: rs(8),
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: rs(14) },
  sheetClose: {
    width: rs(40), height: rs(40), borderRadius: rs(20),
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF',
  },
  sheetTitle: { fontSize: rf(17), fontWeight: '800', color: Colors.textPrimary },
  sheetOk: {
    width: rs(44), height: rs(44), borderRadius: rs(22),
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary,
  },
  sheetLabel: {
    fontSize: rf(12), fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 0.4, paddingTop: rs(12), paddingBottom: rs(10),
  },
  sheetChips: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(8) },
  sheetChip: { borderColor: '#FFFFFF' },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: rs(12),
    backgroundColor: '#FFFFFF', borderRadius: rs(14), padding: rs(12),
  },
  sheetRowIcon: {
    width: rs(40), height: rs(40), borderRadius: rs(10),
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F3F5',
  },
  sheetRowTxt: { flex: 1, fontSize: rf(16), fontWeight: '600', color: Colors.textPrimary },
  sheetRowCount: { fontSize: rf(15), fontWeight: '700', color: Colors.textMuted },
});

type EmployerMatchItem = { kind: 'like'; like: Like } | { kind: 'permApp'; app: PermApplication };

function EmployerMatches() {
  const router = useRouter();
  const {
    currentUser, likes, vacancies, users, chats, refreshAll, showToast,
    permApplications, permVacancies, refreshPermApplications, refreshChats,
  } = useApp();
  const [actionLoading, setLoading] = useState<string | null>(null);
  const [approvingApp, setApprovingApp] = useState<PermApplication | null>(null);
  const [localPermStatus, setLocalPermStatus] = useState<Record<string, PermApplication['status']>>({});
  const [tab, setTab] = useState<'pending' | 'matched' | 'completed'>('pending');
  const [refreshing, setRefreshing] = useState(false);
  const tabBarHeight = useBottomTabBarHeight();
  const tabTouched = useRef(false);
  const autoSwitched = useRef(false);

  // Если новых откликов нет, а одобренные кандидаты есть — открываем сразу «Мэтчи»,
  // иначе директор видит пустые «Отклики» и думает, что кандидатов нет вовсе
  useEffect(() => {
    if (!currentUser || tabTouched.current || autoSwitched.current) return;
    const myLikes = employerLikes(likes, vacancies, currentUser.id);
    const perm = employerPermApps(permApplications, currentUser.id);
    const pendingCount =
      employerPending(myLikes).length + perm.filter(a => a.status === 'pending').length;
    const matchedCount =
      employerMatched(myLikes).length + perm.filter(a => a.status === 'approved').length;
    if (pendingCount === 0 && matchedCount > 0) {
      autoSwitched.current = true;
      setTab('matched');
    }
  }, [likes, permApplications, vacancies, currentUser]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } catch {
      showToast('Не удалось обновить отклики. Проверьте связь.', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const currentUserId = currentUser?.id ?? '';
  const allLikes = employerLikes(likes, vacancies, currentUserId);

  // Ожидающие решения — по подбору, а не по времени отклика. При двадцати
  // откликах смотрят первых пятерых, и лучший кандидат может оказаться
  // двенадцатым просто потому, что нажал позже.
  const byRank = (ls: Like[]) => [...ls].sort((a, b) => {
    const va = vacancies.find((v: Vacancy) => v.id === a.vacancyId);
    const vb = vacancies.find((v: Vacancy) => v.id === b.vacancyId);
    const wa = users.find((u: User) => u.id === a.workerId);
    const wb = users.find((u: User) => u.id === b.workerId);
    const sa = va && wa ? rankCandidate(wa, va, likes).score : -1;
    const sb = vb && wb ? rankCandidate(wb, vb, likes).score : -1;
    return sb - sa;
  });

  const pending = byRank(employerPending(allLikes));
  const matched = employerMatched(allLikes);
  const completed = employerCompleted(allLikes);

  // Отклики на постоянные вакансии — тоже сюда, а не только на карточку вакансии
  const myPermApps: PermApplication[] = employerPermApps(permApplications, currentUserId).map(app =>
    localPermStatus[app.id] ? { ...app, status: localPermStatus[app.id] } : app
  );
  const permPending = myPermApps.filter(a => a.status === 'pending');
  const permApproved = myPermApps.filter(a => a.status === 'approved');
  // hired — работодатель нажал «Завершить»: кандидат закрыт, карточка ушла
  // из «Мэтчей» в «Завершённые». Сама вакансия при этом остаётся в поиске.
  const permHired = myPermApps.filter(a => a.status === 'hired');

  const needsConfirm = matched.filter(l => !l.employerConfirmed).length;
  const shown: EmployerMatchItem[] =
    tab === 'pending'
      ? [
          ...permPending.map(app => ({ kind: 'permApp' as const, app })),
          ...pending.map((like: Like) => ({ kind: 'like' as const, like })),
        ]
      : tab === 'matched'
      ? [
          ...permApproved.map(app => ({ kind: 'permApp' as const, app })),
          ...matched.map((like: Like) => ({ kind: 'like' as const, like })),
        ]
      : [
          ...permHired.map(app => ({ kind: 'permApp' as const, app })),
          ...completed.map((like: Like) => ({ kind: 'like' as const, like })),
        ];

  const getVacancy = (id: string) => vacancies.find(v => v.id === id);
  // Имена работников: общий список приходит не сразу, недостающих догружаем
  // поимённо — иначе в карточках висит «Работник · Загрузка…».
  const neededWorkerIds = useMemo(() => {
    const ids = new Set<string>();
    permApplications.forEach((a: PermApplication) => {
      if (a.employerId === currentUserId) ids.add(a.workerId);
    });
    likes.forEach((l: Like) => {
      if (l.employerId === currentUserId) ids.add(l.workerId);
    });
    return Array.from(ids);
  }, [permApplications, likes, currentUserId]);
  const getWorker = useMissingUsers(users, neededWorkerIds);

  if (!currentUser) return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;

  const approve = async (like: Like) => {
    setLoading(like.id);
    try {
      const worker = getWorker(like.workerId);
      const workerName = worker ? `${worker.firstName} ${worker.lastName}` : 'Работник';

      await dbUpsertLike(like.vacancyId, like.workerId, currentUser.id, { employerLiked: true });

      let result: { matched: boolean; chatId?: string } = { matched: false };
      result = await dbCheckAndCreateMatch(like.vacancyId, like.workerId);
      if (!result.matched && !result.chatId) {
        await new Promise(r => setTimeout(r, 400));
        result = await dbCheckAndCreateMatch(like.vacancyId, like.workerId);
      }

      refreshAll().catch(() => {});

      // О мэтче извещает СЕРВЕР при его создании (jt_notify_match): текст
      // собирает тот, кто записал событие, и только другой стороне.
      if (result.matched || result.chatId) {
        showToast(`Мэтч с ${workerName}!`, 'success');
        router.push({ pathname: '/chat-room', params: { chatId: result.chatId } });
      } else {
        showToast('Подтверждено — ждём создания чата', 'info');
        router.push({ pathname: '/(tabs)/chats' });
      }
    } catch {
      showToast('Ошибка', 'error');
    } finally {
      setLoading(null);
    }
  };

  const dismiss = async (like: Like) => {
    const key = like.id + '_d';
    setLoading(key);
    try {
      await dbUpsertLike(like.vacancyId, like.workerId, currentUser.id, { employerLiked: false });
      refreshAll().catch(() => {});
      showToast('Отклонено', 'success');
    } catch {
      showToast('Ошибка', 'error');
    } finally {
      setLoading(null);
    }
  };

  /**
   * Одна отметка на все исходы. Вышел — дальше по-старому: уведомление и
   * экран оценки. Не вышел или сорвалось — уведомление об отмене и всё,
   * оценивать некого.
   */
  const setOutcome = async (like: Like, outcome: ReportableOutcome, lateMinutes?: number) => {
    const key = like.id + '_shift';
    setLoading(key);
    try {
      await dbSetShiftOutcome(like.id, outcome, { lateMinutes, by: currentUser.id });
      refreshAll().catch(() => {});
      const worker = getWorker(like.workerId);
      const vac = getVacancy(like.vacancyId);
      const workerName = worker ? `${worker.firstName} ${worker.lastName}` : 'Работник';
      // Работника об итоге извещает СЕРВЕР (jt_notify_shift_outcome): текст
      // зависит от итога и собирается там, где итог записан.

      if (outcome !== 'worked') {
        showToast('Отмечено', 'success');
        return;
      }

      showToast(
        lateMinutes ? 'Смена засчитана, опоздание отмечено' : 'Смена подтверждена! Оцените работника',
        'success',
      );

      if (worker && vac) {
        router.push({
          pathname: '/rate',
          params: {
            likeId: like.id,
            toUserId: worker.id,
            toName: workerName,
            vacancyId: vac.id,
            role: 'employer',
          },
        });
      }
    } catch {
      showToast('Ошибка', 'error');
    } finally {
      setLoading(null);
    }
  };

  /**
   * Одобрение — это первое сообщение директора, а не уведомление о нём.
   * Шаблон «свяжитесь с кандидатом» уходил обеим сторонам, и обе ждали
   * друг друга: переписка так и оставалась пустой.
   */
  const approvePermApp = async (app: PermApplication, message: string) => {
    const vacancy = permVacancies.find((v: PermVacancy) => v.id === app.vacancyId);
    if (!vacancy) return;
    setLoading(app.id);
    try {
      // Статус, чат и первое сообщение — одна серверная транзакция.
      // Повтор после потерянного ответа идемпотентен и не плодит сообщения.
      const chatId = await dbApprovePermApplication(app.id, message);
      setLocalPermStatus(prev => ({ ...prev, [app.id]: 'approved' }));
      setApprovingApp(null);
      // Транзакция уже завершилась. Последующие чтения только синхронизируют
      // локальный список и не имеют права превратить успех в «Ошибка».
      await Promise.all([
        refreshPermApplications().catch(() => {}),
        refreshChats(currentUser).catch(() => {}),
      ]);
      showToast('Одобрено! Чат открыт 🎉', 'match');
      router.push({ pathname: '/chat-room', params: { chatId } });
    } catch {
      showToast('Ошибка', 'error');
    } finally {
      setLoading(null);
    }
  };

  const rejectPermApp = async (app: PermApplication) => {
    setLoading(app.id + '_d');
    try {
      // Уведомление и строку в чат ставит сервер — см. jt_perm_app_announce.
      await dbSetPermApplicationStatus(app.id, 'rejected');
      setLocalPermStatus(prev => ({ ...prev, [app.id]: 'rejected' }));
      try {
        await refreshPermApplications();
      } catch {
        // Сервер уже принял решение; локальный статус выше остаётся правдой.
      }
      showToast('Отклонено', 'success');
    } catch {
      showToast('Ошибка', 'error');
    } finally {
      setLoading(null);
    }
  };

  // Одобренный отклик оставался в «Мэтчах» навсегда: убрать его оттуда было
  // нечем. Статус hired уводит карточку в «Завершённые».
  //
  // Саму вакансию не закрываем — она остаётся в поиске. Закрыть её можно во
  // вкладке «Активные», и об этом говорим прямо: иначе легко решить, что
  // вакансия снялась, и потом удивляться новым откликам.
  const finishPermApp = async (app: PermApplication) => {
    setLoading(app.id + '_f');
    try {
      await dbSetPermApplicationStatus(app.id, 'hired');
      setLocalPermStatus(prev => ({ ...prev, [app.id]: 'hired' }));
      try {
        await refreshPermApplications();
      } catch {
        // Статус hired уже записан; refresh — только синхронизация списка.
      }
      showToast('Кандидат закрыт. Вакансия осталась в поиске — закрыть её можно во вкладке «Активные»', 'success');
    } catch (e: any) {
      // Голое «Ошибка» ничего не объясняет. Отдельно ловим случай, когда база
      // ещё не знает про статус hired: пока миграция 014 не применена, запись
      // падает на проверке и починить это из приложения нельзя.
      const msg = String(e?.message ?? '');
      showToast(
        msg.includes('status_check')
          ? 'База ещё не знает про статус «завершён». Нужна миграция 014.'
          : 'Не удалось завершить. Попробуйте ещё раз.',
        'error',
      );
    } finally {
      setLoading(null);
    }
  };

  const approveInfo = (() => {
    if (!approvingApp) return [];
    const w = getWorker(approvingApp.workerId);
    const vac = permVacancies.find((v: PermVacancy) => v.id === approvingApp.vacancyId);
    return [
      w ? `${w.firstName} ${w.lastName}`.trim() || 'Кандидат' : 'Кандидат',
      `Вакансия: ${vac?.title ?? '—'}`,
      vac?.metroStation ? `Где: 🚇 ${vac.metroStation}` : `Компания: ${vac?.company ?? '—'}`,
    ];
  })();

  const renderPermApp = (app: PermApplication) => {
    const vacancy = permVacancies.find((v: PermVacancy) => v.id === app.vacancyId);
    const worker = getWorker(app.workerId);
    const workerName = worker
      ? `${worker.firstName} ${worker.lastName}`.trim() || 'Работник'
      : 'Работник';
    const workerColor = nameColorFromString(worker?.id ?? app.workerId);
    const isLoading = actionLoading === app.id;
    const isDLoading = actionLoading === app.id + '_d';
    const isApproved = app.status === 'approved';
    // Завершённый отклик — состояние конечное: решать по нему уже нечего,
    // и кнопки «Подходит / Не подходит» здесь были бы предложением заново
    // выбрать то, что выбрано.
    const isHired = app.status === 'hired';

    const badge = isHired
      ? { bg: '#EEF2FF', color: '#4F46E5', icon: 'checkmark-done' as const, text: 'Кандидат закрыт' }
      : isApproved
      ? { bg: '#D1FAE5', color: Colors.green, icon: 'checkmark-circle' as const, text: 'Одобрен на вакансию' }
      : { bg: '#EEF2FF', color: '#4F46E5', icon: 'briefcase-outline' as const, text: 'Отклик на вакансию' };

    return (
      <View style={[s.card, isApproved && s.matchedCard, isHired && s.completedCard]}>
        <View style={[s.statusBadge, { backgroundColor: badge.bg }]}>
          <Ionicons name={badge.icon} size={14} color={badge.color} />
          <Text style={[s.statusTxt, { color: badge.color }]}>{badge.text}</Text>
        </View>

        <TouchableOpacity
          style={s.workerRow}
          onPress={() => worker
            ? router.push({ pathname: '/user-profile', params: { userId: worker.id } })
            : null}
          activeOpacity={0.8}
        >
          {worker?.avatarUrl ? (
            <Image source={{ uri: worker.avatarUrl }} style={s.avatar} contentFit="cover" transition={150} />
          ) : (
            <View style={[s.avatar, { backgroundColor: workerColor, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={s.avatarTxt}>{getInitials(workerName)}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.workerName}>{workerName}</Text>
            {worker?.age ? <Text style={s.profileSub}>{worker.age} лет</Text> : null}
            {worker?.metroStation ? (
              <View style={s.metroRow}>
                <Ionicons name="subway-outline" size={12} color={Colors.textMuted} />
                <Text style={s.profileSub}> {worker.metroStation}</Text>
              </View>
            ) : null}
            {(worker?.avgRating ?? 0) > 0 ? (
              <View style={s.ratingRow}>
                <Ionicons name="star" size={12} color="#FBBF24" />
                <Text style={s.profileSub}> {(worker?.avgRating ?? 0).toFixed(1)} ({worker?.ratingCount} отз.)</Text>
              </View>
            ) : null}
            {!worker ? <Text style={s.profileSub}>Загрузка…</Text> : null}
          </View>
          {isApproved && worker?.phone ? (
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <View style={s.phoneTag}><Text style={s.phoneTxt}>{worker.phone}</Text></View>
              <Text style={s.profileArrow}>Профиль ›</Text>
            </View>
          ) : (
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              {worker ? <Text style={s.profileArrow}>Профиль ›</Text> : null}
            </View>
          )}
        </TouchableOpacity>

        <Text style={s.vacLabel}>{vacancy?.title ?? 'Вакансия'} · Постоянная работа</Text>

        {isHired ? (
          // Только переписка: решение принято, завершать больше нечего
          <View style={s.actionRow}>
            <TouchableOpacity
              style={s.chatBtn}
              onPress={() => {
                const c = chats.find((c: Chat) => c.employerId === app.employerId && c.workerId === app.workerId);
                if (c) router.push({ pathname: '/chat-room', params: { chatId: c.id } });
                else router.push({ pathname: '/(tabs)/chats' });
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="chatbubble-outline" size={15} color="#fff" />
              <Text style={s.chatBtnTxt}>Чат</Text>
            </TouchableOpacity>
          </View>
        ) : isApproved ? (
          <View style={s.actionRow}>
            <TouchableOpacity
              style={s.chatBtn}
              onPress={() => {
                const c = chats.find((c: Chat) => c.employerId === app.employerId && c.workerId === app.workerId);
                if (c) router.push({ pathname: '/chat-room', params: { chatId: c.id } });
                else router.push({ pathname: '/(tabs)/chats' });
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="chatbubble-outline" size={15} color="#fff" />
              <Text style={s.chatBtnTxt}>Чат</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.finishBtn, actionLoading === app.id + '_f' && { opacity: 0.5 }]}
              onPress={() => finishPermApp(app)}
              disabled={!!actionLoading}
              activeOpacity={0.8}
            >
              {actionLoading === app.id + '_f' ? (
                <ActivityIndicator size="small" color={Colors.green} />
              ) : (
                <>
                  <Ionicons name="checkmark-done" size={15} color={Colors.green} />
                  <Text style={s.finishBtnTxt}>Завершить</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.actionRow}>
            <TouchableOpacity
              style={[s.rejectBtn, isDLoading && { opacity: 0.5 }]}
              onPress={() => rejectPermApp(app)}
              disabled={!!actionLoading}
              activeOpacity={0.8}
            >
              {isDLoading
                ? <ActivityIndicator size="small" color={Colors.red} />
                : (
                  <>
                    <Ionicons name="close" size={15} color={Colors.red} />
                    <Text style={s.rejectBtnTxt}>Не подходит</Text>
                  </>
                )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.acceptBtn, isLoading && { opacity: 0.5 }]}
              onPress={() => setApprovingApp(app)}
              disabled={!!actionLoading}
              activeOpacity={0.8}
            >
              {isLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={15} color="#fff" />
                    <Text style={s.acceptBtnTxt}>Подходит!</Text>
                  </>
                )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderLike = (like: Like) => {
    const vac = getVacancy(like.vacancyId);
    const worker = getWorker(like.workerId);
    if (!vac) return null;
    const workerName = worker
      ? `${worker.firstName} ${worker.lastName}`.trim() || 'Работник'
      : 'Работник';
    const workerColor = nameColorFromString(worker?.id ?? like.workerId);
    const isLoading = actionLoading === like.id;
    const isDLoading = actionLoading === like.id + '_d';
    const isShiftLoading = actionLoading === like.id + '_shift';

    if (like.isMatch) {
      return (
        <View style={[s.card, (like.shiftCompleted || like.cancelled) ? s.completedCard : s.matchedCard]}>
          <MatchStatus like={like} isWorker={false} />

          {!like.shiftCompleted && !like.cancelled && !like.employerConfirmed ? (
            <ConfirmBanner
              onOutcome={(outcome, lateMinutes) => setOutcome(like, outcome, lateMinutes)}
              loading={isShiftLoading}
            />
          ) : null}

          <TouchableOpacity
            style={s.workerRow}
            onPress={() => worker
              ? router.push({ pathname: '/user-profile', params: { userId: worker.id } })
              : null}
            activeOpacity={0.8}
          >
            {worker?.avatarUrl ? (
              <Image source={{ uri: worker.avatarUrl }} style={s.avatar} contentFit="cover" transition={150} />
            ) : (
              <View style={[s.avatar, { backgroundColor: workerColor, alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={s.avatarTxt}>{getInitials(workerName)}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <View style={s.nameRow}>
                <Text style={s.workerName} numberOfLines={1}>{workerName}</Text>
                {/* Рейтинг тут же, у имени: работодатель решает по нему, а
                    не по тому, на какой станции живёт человек. */}
                <ScoreBadge user={worker} />
              </View>
              {worker?.metroStation ? (
                <View style={s.metroRow}>
                  <Ionicons name="subway-outline" size={12} color={Colors.textMuted} />
                  <Text style={s.profileSub}> {worker.metroStation}</Text>
                </View>
              ) : null}
              {(worker?.avgRating ?? 0) > 0 ? (
                <View style={s.ratingRow}>
                  <Ionicons name="star" size={12} color="#FBBF24" />
                  <Text style={s.profileSub}> {(worker?.avgRating ?? 0).toFixed(1)} ({worker?.ratingCount} отз.)</Text>
                </View>
              ) : null}
            </View>
            {worker?.phone ? (
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <View style={s.phoneTag}><Text style={s.phoneTxt}>{worker.phone}</Text></View>
                <Text style={s.profileArrow}>Профиль ›</Text>
              </View>
            ) : null}
          </TouchableOpacity>

          <Text style={s.vacLabel}>{vac.title} · {formatDate(vac.date)}</Text>

          <View style={s.actionRow}>
            <TouchableOpacity
              style={s.chatBtn}
              onPress={() => {
                const c = chats.find(c => c.employerId === like.employerId && c.workerId === like.workerId);
                if (c) router.push({ pathname: '/chat-room', params: { chatId: c.id } });
                else router.push({ pathname: '/(tabs)/chats' });
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="chatbubble-outline" size={15} color="#fff" />
              <Text style={s.chatBtnTxt}>Чат</Text>
            </TouchableOpacity>
            {like.shiftCompleted && !like.employerRated && worker && vac ? (
              <TouchableOpacity
                style={s.rateBtn}
                onPress={() => router.push({
                  pathname: '/rate',
                  params: {
                    likeId: like.id,
                    toUserId: worker.id,
                    toName: workerName,
                    vacancyId: vac.id,
                    role: 'employer',
                  },
                })}
                activeOpacity={0.8}
              >
                <Ionicons name="star-outline" size={15} color="#fff" />
                <Text style={s.rateBtnTxt}>Оценить</Text>
              </TouchableOpacity>
            ) : like.shiftCompleted && like.employerRated ? (
              <View style={s.waitBtn}>
                <Ionicons name="checkmark" size={14} color={Colors.textMuted} />
                <Text style={s.waitBtnTxt}>Оценка оставлена</Text>
              </View>
            ) : null}
          </View>
        </View>
      );
    }

    const displayName = worker
      ? `${worker.firstName} ${worker.lastName}`.trim() || 'Работник'
      : 'Работник';
    return (
      <View style={s.card}>
        <MatchStatus like={like} isWorker={false} />

        <TouchableOpacity
          style={s.workerRow}
          onPress={() => worker
            ? router.push({ pathname: '/user-profile', params: { userId: worker.id } })
            : null}
          activeOpacity={0.8}
        >
          {worker?.avatarUrl ? (
            <Image source={{ uri: worker.avatarUrl }} style={s.avatar} contentFit="cover" transition={150} />
          ) : (
            <View style={[s.avatar, { backgroundColor: workerColor, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={s.avatarTxt}>{getInitials(displayName)}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.workerName}>{displayName}</Text>
            {worker?.age ? <Text style={s.profileSub}>{worker.age} лет</Text> : null}
            {worker?.metroStation ? (
              <View style={s.metroRow}>
                <Ionicons name="subway-outline" size={12} color={Colors.textMuted} />
                <Text style={s.profileSub}> {worker.metroStation}</Text>
              </View>
            ) : null}
            {!worker ? <Text style={s.profileSub}>Загрузка...</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={s.hiddenPhone}><Text style={s.hiddenPhoneTxt}>●●● ●●●</Text></View>
            {worker ? <Text style={s.profileArrow}>Профиль ›</Text> : null}
          </View>
        </TouchableOpacity>

        <Text style={s.vacLabel}>{vac.title} · {formatDate(vac.date)}</Text>

        <View style={s.actionRow}>
          <TouchableOpacity
            style={[s.rejectBtn, isDLoading && { opacity: 0.5 }]}
            onPress={() => dismiss(like)}
            disabled={!!actionLoading}
            activeOpacity={0.8}
          >
            {isDLoading
              ? <ActivityIndicator size="small" color={Colors.red} />
              : (
                <>
                  <Ionicons name="close" size={15} color={Colors.red} />
                  <Text style={s.rejectBtnTxt}>Не подходит</Text>
                </>
              )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.acceptBtn, isLoading && { opacity: 0.5 }]}
            onPress={() => approve(like)}
            disabled={!!actionLoading}
            activeOpacity={0.8}
          >
            {isLoading
              ? <ActivityIndicator size="small" color="#fff" />
              : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={15} color="#fff" />
                  <Text style={s.acceptBtnTxt}>Подходит!</Text>
                </>
              )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderItem = ({ item }: { item: EmployerMatchItem }) =>
    item.kind === 'permApp' ? renderPermApp(item.app) : renderLike(item.like);

  const emptyIcon: Record<typeof tab, React.ComponentProps<typeof Ionicons>['name']> = {
    pending: 'file-tray-outline',
    matched: 'people-outline',
    completed: 'flag-outline',
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <TabHeader
        title="Мэтчи"
        badge={needsConfirm > 0 ? (
          <View style={s.urgentBadge}>
            <Ionicons name="time-outline" size={13} color="#92400E" />
            <Text style={s.urgentBadgeTxt}>{needsConfirm} ждут</Text>
          </View>
        ) : null}
      />

      <View style={s.tabStrip}>
        {([
          { key: 'pending',   label: 'Отклики',    count: permPending.length + pending.length },
          { key: 'matched',   label: 'Мэтчи',      count: permApproved.length + matched.length },
          { key: 'completed', label: 'Завершено',  count: completed.length + permHired.length },
        ] as const).map(t => (
          <TouchableOpacity
            key={t.key}
            style={s.tabItem}
            onPress={() => { tabTouched.current = true; setTab(t.key); }}
            activeOpacity={0.8}
          >
            <Text
              style={[s.tabLabel, tab === t.key && s.tabLabelActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {t.label}{t.count > 0 ? ` (${t.count})` : ''}
            </Text>
            {tab === t.key ? <View style={s.tabUnderline} /> : null}
          </TouchableOpacity>
        ))}
      </View>

      <OnboardingTarget targetKey="matches.content" style={{ flex: 1 }}>
      {shown.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name={emptyIcon[tab]} size={56} color={Colors.textMuted} />
          <Text style={s.emptyTitle}>
            {tab === 'pending' ? 'Нет откликов' : tab === 'matched' ? 'Нет активных мэтчей' : 'Нет завершённых смен'}
          </Text>
          <Text style={s.emptySub}>
            {tab === 'pending'
              ? (permApproved.length + matched.length > 0
                  ? 'Новых откликов нет. Одобренные кандидаты — во вкладке «Мэтчи»'
                  : 'Когда работники откликнутся — они появятся здесь')
              : tab === 'matched'
              ? 'Мэтчи появятся после взаимного подтверждения'
              : 'Здесь будет история завершённых смен'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={item => item.kind === 'permApp' ? item.app.id : item.like.id}
          contentContainerStyle={[s.list, { paddingBottom: tabBarHeight + 16 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
          renderItem={renderItem}
        />
      )}
      </OnboardingTarget>

      <ApplySheet
        visible={!!approvingApp}
        onClose={() => setApprovingApp(null)}
        onSend={msg => approvingApp ? approvePermApp(approvingApp, msg) : undefined}
        title="Одобрить кандидата"
        info={approveInfo}
        chips={PERM_APPROVE_SUGGESTIONS}
        label="Напишите кандидату первым"
        placeholder="Например: здравствуйте! Готовы вас взять, когда сможете выйти?"
        sendLabel="Одобрить и отправить"
        hint="Кандидат ждёт вашего слова — без сообщения переписка так и останется пустой"
      />
    </SafeAreaView>
  );
}

export default function MatchesScreen() {
  const { currentUser } = useApp();
  if (!currentUser) return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;
  if (currentUser.isGuest) return <GuestGate title="Отклики — после регистрации" subtitle="Зарегистрируйтесь, чтобы откликаться на вакансии и видеть, кто ответил вам." />;
  return currentUser.role === 'worker' ? <WorkerMatches /> : <EmployerMatches />;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    paddingHorizontal: rs(16), paddingTop: rs(16), paddingBottom: rs(12),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  title: { fontSize: rf(22), fontWeight: '800', color: Colors.textPrimary, flex: 1 },
  urgentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: rs(4),
    backgroundColor: '#FEF3C7', borderRadius: rs(100),
    paddingHorizontal: rs(10), paddingVertical: rs(4),
    borderWidth: 1, borderColor: '#F59E0B',
  },
  urgentBadgeTxt: { color: '#92400E', fontSize: rf(12), fontWeight: '700' },
  tabStrip: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.divider },
  tabItem: { flex: 1, paddingVertical: rs(12), paddingHorizontal: rs(4) },
  // Подпись всегда в одну строку. Активная вкладка становится жирной и шире —
  // «Завершённые (4)» переставало влезать и переносилось на вторую строку,
  // отчего вся полоса подпрыгивала при переключении. Теперь вместо переноса
  // текст чуть ужимается, и строка стоит на месте при любой ширине экрана и
  // любом системном размере шрифта.
  tabLabel: {
    fontSize: rf(13), fontWeight: '500', color: Colors.textMuted,
    // Ширина во всю вкладку, иначе ужимать текст не во что: раньше он просто
    // обрезался многоточием и счётчик пропадал.
    alignSelf: 'stretch', textAlign: 'center',
  },
  tabLabelActive: { fontWeight: '700', color: Colors.textPrimary },
  tabUnderline: {
    position: 'absolute', bottom: 0, left: '20%', right: '20%',
    height: 2, backgroundColor: Colors.primary, borderRadius: rs(1),
  },
  list: { padding: rs(16), gap: rs(12) },
  // Рамка карточки говорит о её состоянии, и правило одно на все три вида
  // карточек — смены у работника, смены у работодателя, отклики на постоянные:
  //   ждёт решения        — без рамки
  //   в работе            — зелёная
  //   в архиве            — синяя и приглушённая
  // Отклик на постоянную вакансию про архив не знал, и завершённая карточка
  // стояла в «Завершённых» без рамки рядом с обрамлёнными сменами.
  card: { backgroundColor: Colors.bg, borderRadius: Radius.lg, padding: rs(16), ...Shadow.card, gap: rs(10) },
  matchedCard: { borderWidth: 1.5, borderColor: Colors.green },
  completedCard: { borderWidth: 1.5, borderColor: Colors.blue, opacity: 0.8 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: rs(5),
    borderRadius: rs(8), paddingHorizontal: rs(10), paddingVertical: rs(6), alignSelf: 'flex-start',
  },
  statusTxt: { fontSize: rf(13), fontWeight: '700' },
  jobTitle: { fontSize: rf(17), fontWeight: '800', color: Colors.textPrimary, lineHeight: rf(22) },
  subText: { fontSize: rf(13), color: Colors.textMuted, marginTop: rs(2) },
  metroRow: { flexDirection: 'row', alignItems: 'center', marginTop: rs(2) },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: rs(2) },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(6) },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: rs(10) },
  detailsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: rs(3),
    backgroundColor: Colors.primaryLight,
    borderWidth: 1, borderColor: Colors.primaryBorder,
    borderRadius: rs(100), paddingLeft: rs(12), paddingRight: rs(9), paddingVertical: rs(7),
    marginTop: rs(2),
  },
  detailsBtnTxt: { fontSize: rf(12.5), fontWeight: '700', color: Colors.primary },
  addressRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: rs(6),
    backgroundColor: '#FFFBEB', borderRadius: rs(10), paddingHorizontal: rs(10), paddingVertical: rs(8),
  },
  addressTxt: { flex: 1, fontSize: rf(12.5), color: '#92400E', lineHeight: rf(17) },
  profileRow: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    backgroundColor: Colors.surface, borderRadius: rs(12), padding: rs(10),
  },
  profileAvatar: { width: rs(36), height: rs(36), borderRadius: rs(18) },
  profileAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  profileAvatarInitials: { color: '#fff', fontSize: rf(13), fontWeight: '700' },
  profileName: { fontSize: rf(14), fontWeight: '700', color: Colors.textPrimary },
  profileSub: { fontSize: rf(12), color: Colors.textMuted, marginTop: rs(1) },
  profileArrow: { fontSize: rf(12), color: Colors.primary, fontWeight: '600' },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: rs(10) },
  avatar: { width: rs(44), height: rs(44), borderRadius: rs(22) },
  avatarTxt: { color: '#fff', fontSize: rf(16), fontWeight: '700' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: rs(6) },
  workerName: { fontSize: rf(15), fontWeight: '700', color: Colors.textPrimary },
  phoneTag: {
    backgroundColor: Colors.primaryLight, borderRadius: rs(8),
    paddingHorizontal: rs(10), paddingVertical: rs(6),
  },
  phoneTxt: { color: Colors.primary, fontSize: rf(12), fontWeight: '700' },
  hiddenPhone: {
    backgroundColor: Colors.surface, borderRadius: rs(8),
    paddingHorizontal: rs(10), paddingVertical: rs(6),
  },
  hiddenPhoneTxt: { color: Colors.textMuted, fontSize: rf(13) },
  vacLabel: { fontSize: rf(13), color: Colors.textMuted },
  actionRow: { flexDirection: 'row', gap: rs(10), marginTop: rs(4) },
  rejectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(5),
    borderWidth: 1.5, borderColor: Colors.red,
    borderRadius: rs(100), paddingVertical: rs(11),
  },
  rejectBtnTxt: { color: Colors.red, fontSize: rf(14), fontWeight: '600' },
  acceptBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(5),
    backgroundColor: Colors.primary,
    borderRadius: rs(100), paddingVertical: rs(11),
  },
  acceptBtnTxt: { color: '#fff', fontSize: rf(14), fontWeight: '700' },
  chatBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(6),
    backgroundColor: Colors.blue,
    borderRadius: rs(100), paddingVertical: rs(11),
  },
  chatBtnTxt: { color: '#fff', fontSize: rf(14), fontWeight: '700' },
  finishBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(5),
    borderWidth: 1.5, borderColor: Colors.green,
    borderRadius: rs(100), paddingVertical: rs(11),
  },
  finishBtnTxt: { color: Colors.green, fontSize: rf(14), fontWeight: '700' },
  rateBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(5),
    backgroundColor: '#FBBF24',
    borderRadius: rs(100), paddingVertical: rs(11),
  },
  rateBtnTxt: { color: '#fff', fontSize: rf(14), fontWeight: '700' },
  waitBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(5),
    backgroundColor: Colors.surface,
    borderRadius: rs(100), paddingVertical: rs(11),
    borderWidth: 1, borderColor: Colors.inputBorder,
  },
  waitBtnTxt: { color: Colors.textMuted, fontSize: rf(13), fontWeight: '500' },
  confirmBanner: {
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    backgroundColor: '#FEF3C7', borderRadius: rs(12), padding: rs(12),
    borderWidth: 1, borderColor: '#F59E0B',
  },
  confirmBannerTitle: { fontSize: rf(13), fontWeight: '700', color: '#92400E' },
  confirmBannerSub: { fontSize: rf(11), color: '#B45309', marginTop: rs(2) },
  confirmBannerBtn: {
    flexDirection: 'row', gap: rs(3), height: rs(32), borderRadius: rs(16),
    paddingHorizontal: rs(9), backgroundColor: Colors.green,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmBannerActions: { alignItems: 'stretch', gap: rs(5) },
  confirmBannerBtnTxt: { color: '#fff', fontSize: rf(10.5), fontWeight: '700' },
  cancelShiftBtn: {
    minHeight: rs(28), paddingHorizontal: rs(8), borderRadius: rs(14),
    borderWidth: 1, borderColor: Colors.red, alignItems: 'center', justifyContent: 'center',
  },
  cancelShiftBtnTxt: { color: Colors.red, fontSize: rf(10.5), fontWeight: '700' },
  // Варианты ответа списком, а не двумя кнопками в ряд: их три-четыре, и в
  // ряд они не помещаются, а подпись под каждым нужна — без неё «отказался»
  // и «не вышел» на вид одно и то же.
  choices: { gap: rs(8), marginTop: rs(4) },
  choiceRow: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    backgroundColor: Colors.surface, borderRadius: rs(12),
    paddingVertical: rs(9), paddingHorizontal: rs(12),
    borderWidth: 1, borderColor: Colors.inputBorder,
  },
  choiceTitle: { fontSize: rf(14), fontWeight: '700', color: Colors.textPrimary },
  choiceSub: { fontSize: rf(11.5), color: Colors.textMuted, marginTop: rs(1), lineHeight: rf(15) },
  dialogOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100,
    alignItems: 'center', justifyContent: 'flex-end', padding: rs(12),
  },
  dialogCard: {
    backgroundColor: Colors.bg, borderRadius: Radius.xl,
    padding: rs(16), width: '100%', gap: rs(8),
  },
  dialogTitle: { fontSize: rf(16), fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  dialogBody: { fontSize: rf(12.5), color: Colors.textSecondary, textAlign: 'center', lineHeight: rf(17) },
  dialogBtns: { flexDirection: 'row', gap: rs(10), marginTop: rs(4) },
  // Кнопкам нужны боковые поля и центрирование по обеим осям: без них
  // длинная подпись («Отменить смену») вылезала за пределы овала.
  dialogCancelBtn: {
    flex: 1, borderWidth: 1.5, borderColor: Colors.inputBorder,
    borderRadius: rs(100), paddingVertical: rs(12), paddingHorizontal: rs(10),
    minHeight: rs(44), alignItems: 'center', justifyContent: 'center',
  },
  dialogCancelTxt: { fontSize: rf(14), fontWeight: '600', color: Colors.textSecondary, textAlign: 'center' },
  dialogConfirmBtn: {
    flex: 1, backgroundColor: Colors.green,
    borderRadius: rs(100), paddingVertical: rs(12), paddingHorizontal: rs(10),
    minHeight: rs(44), alignItems: 'center', justifyContent: 'center',
  },
  dialogConfirmTxt: { fontSize: rf(14), fontWeight: '700', color: '#fff', textAlign: 'center' },
  dialogDangerBtn: {
    flex: 1, backgroundColor: Colors.red,
    borderRadius: rs(100), paddingVertical: rs(12), paddingHorizontal: rs(10),
    minHeight: rs(44), alignItems: 'center', justifyContent: 'center',
  },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: rs(32), paddingBottom: rs(80),
  },
  emptyTitle: { fontSize: rf(18), fontWeight: '700', color: Colors.textPrimary, marginTop: rs(12) },
  emptySub: { fontSize: rf(14), color: Colors.textMuted, textAlign: 'center', marginTop: rs(6), lineHeight: rf(20) },
});
