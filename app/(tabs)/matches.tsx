import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { Like, User, Vacancy, PermApplication, PermVacancy, PartnerApplication, Chat, ReportableOutcome } from '@/constants/types';
import { formatDate, getInitials, nameColorFromString } from '@/services/storage';
import {
  dbUpsertLike, dbCheckAndCreateMatch, dbSetShiftOutcome,
  dbSetPermApplicationStatus, dbCreateChat, dbGetPartnerApplications,
} from '@/services/db';
import { TabHeader } from '@/components/ui/TabHeader';
import GuestGate from '@/components/GuestGate';
import { ScoreBadge } from '@/components/feature/ScoreCard';
import { rankCandidate } from '@/services/matching';
import { useMissingUsers } from '@/hooks/useMissingUsers';
import { workerLikes, workerActive, workerRejected, workerCompleted,
  employerLikes, employerPending, employerMatched, employerCompleted,
  employerPermApps } from '@/services/matchCounts';
import { Chip } from '@/components/ui/Chip';
import { VacancyDetailModal } from '@/components/feature/VacancyDetailModal';
import { ApplySheet } from '@/components/feature/ApplySheet';
import { PERM_APPROVE_SUGGESTIONS } from '@/constants/chatSuggestions';

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
function partnerStatus(status: PartnerApplication['status']): {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  bg: string;
  finished?: boolean;
} {
  if (status === 'accepted' || status === 'booked')
    return { label: 'Работодатель подтвердил', icon: 'checkmark-circle', color: Colors.green, bg: '#D1FAE5' };
  if (status === 'checked_in' || status === 'check_in_pending')
    return { label: 'Выход подтверждается', icon: 'location', color: Colors.blue, bg: Colors.blueLight };
  if (status === 'completed')
    return { label: 'Работа завершена', icon: 'checkmark-done-circle', color: Colors.blue, bg: Colors.blueLight, finished: true };
  if (status === 'rejected')
    return { label: 'Работодатель отказал', icon: 'close-circle', color: Colors.red, bg: '#FEE2E2', finished: true };
  if (status === 'worker_cancelled')
    return { label: 'Вы отменили отклик', icon: 'close-circle-outline', color: Colors.red, bg: '#FEE2E2', finished: true };
  if (status === 'employer_cancelled')
    return { label: 'Работодатель отменил', icon: 'close-circle-outline', color: Colors.red, bg: '#FEE2E2', finished: true };
  if (status === 'no_show')
    return { label: 'Неявка', icon: 'alert-circle', color: Colors.red, bg: '#FEE2E2', finished: true };
  if (status === 'failed')
    return { label: 'Ошибка отправки — повторим', icon: 'refresh-circle', color: '#92400E', bg: '#FEF3C7' };
  if (status === 'disputed')
    return { label: 'Идёт разбирательство', icon: 'help-circle', color: '#92400E', bg: '#FEF3C7' };
  if (status === 'submitted')
    return { label: 'На рассмотрении', icon: 'hourglass-outline', color: '#92400E', bg: '#FFF7ED' };
  return { label: 'Отправляем работодателю', icon: 'paper-plane-outline', color: Colors.primary, bg: Colors.primaryLight };
}

function WorkerMatches() {
  const router = useRouter();
  const { currentUser, likes, vacancies, users, chats, refreshAll, showToast, offline } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const [detailVacancy, setDetailVacancy] = useState<Vacancy | null>(null);
  const [partnerApplications, setPartnerApplications] = useState<PartnerApplication[]>([]);
  const [tab, setTab] = useState<'active' | 'rejected' | 'completed'>('active');
  const tabBarHeight = useBottomTabBarHeight();

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refreshAll(),
      currentUser ? dbGetPartnerApplications(currentUser.id).then(setPartnerApplications) : Promise.resolve(),
    ]);
    setRefreshing(false);
  };

  const currentUserId = currentUser?.id ?? '';
  useEffect(() => {
    if (!currentUserId) return;
    dbGetPartnerApplications(currentUserId).then(setPartnerApplications).catch(() => {});
  }, [currentUserId]);
  const myLikes = workerLikes(likes, currentUserId);

  const getVacancy = (id: string) => vacancies.find(v => v.id === id);
  // Та же история, что и у работодателя: общий список пользователей приходит
  // не сразу, и без этого в карточке вместо работодателя пусто.
  const neededEmployerIds = useMemo<string[]>(
    () => Array.from(new Set(likes.map((l: Like) => l.employerId).filter(Boolean))) as string[],
    [likes],
  );
  const getEmployer = useMissingUsers(users, neededEmployerIds);

  if (!currentUser) return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;

  const activeItems = workerActive(myLikes);
  const rejectedItems = workerRejected(myLikes);
  const completedItems = workerCompleted(myLikes);

  const partnerRejected = partnerApplications.filter(a =>
    ['rejected', 'worker_cancelled', 'employer_cancelled'].includes(a.status));
  const partnerCompleted = partnerApplications.filter(a =>
    ['completed', 'no_show'].includes(a.status));
  const partnerActive = partnerApplications.filter(a =>
    !partnerRejected.includes(a) && !partnerCompleted.includes(a));

  // Признак берётся с того списка, который экран показывает, — с откликов.
  // Общий «сервер недоступен» врал бы в обе стороны: вакансии могут не
  // прийти, когда отклики пришли, и наоборот.
  //
  // Смотрим на весь список, а не на вкладку: пустая вкладка «Отказы» при
  // принесённых откликах — это правда, и «нет связи» поверх неё было бы
  // неправдой. А если список не принесли, пусты все три по одной причине.
  const offlineHere = offline.likes && myLikes.length === 0;

  const shownItems =
    tab === 'active'
      ? [...activeItems.map(like => ({ kind: 'like' as const, like })), ...partnerActive.map(app => ({ kind: 'partner' as const, app }))]
      : tab === 'rejected'
      ? [...rejectedItems.map(like => ({ kind: 'like' as const, like })), ...partnerRejected.map(app => ({ kind: 'partner' as const, app }))]
      : [...completedItems.map(like => ({ kind: 'like' as const, like })), ...partnerCompleted.map(app => ({ kind: 'partner' as const, app }))];

  const renderItem = ({ item }: { item: { kind: 'like'; like: Like } | { kind: 'partner'; app: PartnerApplication } }) => {
    if (item.kind === 'partner') {
      const app = item.app;
      const status = partnerStatus(app.status);
      return (
        <View style={[s.card, status.finished && s.completedCard]}>
          <View style={[s.statusBadge, { backgroundColor: status.bg }]}>
            <Ionicons name={status.icon} size={14} color={status.color} />
            <Text style={[s.statusTxt, { color: status.color }]}>{status.label}</Text>
          </View>
          <Text style={s.jobTitle}>{app.title}</Text>
          <Text style={s.subText}>{app.company ?? 'Компания'} · {app.sourceName ?? 'Партнёр JobToo'}</Text>
          {app.salary != null ? (
            <View style={s.partnerMetaRow}>
              <Ionicons name="wallet-outline" size={15} color={Colors.primary} />
              <Text style={s.partnerMetaTxt}>{app.salary.toLocaleString('ru-RU')} ₽{app.payPeriod === 'month' ? '/мес' : ''}</Text>
            </View>
          ) : null}
          {app.address ? (
            <View style={s.addressRow}>
              <Ionicons name="location-outline" size={14} color="#92400E" />
              <Text style={s.addressTxt}>{app.address}</Text>
            </View>
          ) : null}
          <Text style={s.partnerCaption}>Отклик отправлен внутри JobToo — повторная регистрация не нужна</Text>
        </View>
      );
    }
    const like = item.like;
    const vac = getVacancy(like.vacancyId);
    if (!vac) return null;
    const employer = getEmployer(like.employerId);
    const isMatch = like.isMatch;
    const isCompleted = like.shiftCompleted;
    const isCancelled = like.cancelled;
    const isFinished = isCompleted || isCancelled;
    const canRate = isCompleted && !like.workerRated;

    return (
      <View style={[s.card, isMatch && !isFinished && s.matchedCard, isFinished && s.completedCard]}>
        <MatchStatus like={like} isWorker={true} />

        {/* Что карточку можно раскрыть, по одному заголовку не догадаться —
            справа стоит явная кнопка, нажимается по-прежнему весь блок */}
        <TouchableOpacity activeOpacity={0.8} onPress={() => setDetailVacancy(vac)} style={s.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.jobTitle}>{vac.title}</Text>
            <View style={s.metroRow}>
              <Text style={s.subText}>{vac.company}</Text>
              <Text style={s.subText}> · </Text>
              <Ionicons name="subway-outline" size={13} color={Colors.textMuted} />
              <Text style={s.subText}> {vac.metroStation}</Text>
            </View>
          </View>
          <View style={s.detailsBtn}>
            <Text style={s.detailsBtnTxt}>Подробнее</Text>
            <Ionicons name="chevron-forward" size={13} color={Colors.primary} />
          </View>
        </TouchableOpacity>

        <View style={s.chipsRow}>
          <Chip label={formatDate(vac.date)} variant="date" icon="calendar-outline" />
          <Chip label={`${vac.timeStart}–${vac.timeEnd}`} variant="time" icon="time-outline" />
        </View>

        {/* Адрес — то, ради чего иначе приходится открывать карточку смены */}
        {vac.address ? (
          <View style={s.addressRow}>
            <Ionicons name="location-outline" size={14} color="#92400E" style={{ marginTop: 1 }} />
            <Text style={s.addressTxt}>{vac.address}</Text>
          </View>
        ) : null}

        {employer ? (
          <TouchableOpacity
            style={s.profileRow}
            onPress={() => router.push({ pathname: '/user-profile', params: { userId: employer.id } })}
            activeOpacity={0.8}
          >
            {employer.avatarUrl ? (
              <Image source={{ uri: employer.avatarUrl }} style={s.profileAvatar} contentFit="cover" />
            ) : (
              <View style={[s.profileAvatar, s.profileAvatarFallback, { backgroundColor: nameColorFromString(employer.id) }]}>
                <Text style={s.profileAvatarInitials}>{getInitials(`${employer.firstName} ${employer.lastName}`)}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>{employer.company ?? `${employer.firstName} ${employer.lastName}`}</Text>
              {(employer.avgRating ?? 0) > 0 ? (
                <View style={s.ratingRow}>
                  <Ionicons name="star" size={12} color="#FBBF24" />
                  <Text style={s.profileSub}> {(employer.avgRating ?? 0).toFixed(1)} ({employer.ratingCount} отз.)</Text>
                </View>
              ) : null}
            </View>
            <Text style={s.profileArrow}>Профиль ›</Text>
          </TouchableOpacity>
        ) : null}

        {isMatch ? (
          <View style={s.actionRow}>
            <TouchableOpacity
              style={s.chatBtn}
              onPress={() => {
                const c = chats.find(c => c.employerId === like.employerId && c.workerId === currentUser.id);
                if (c) router.push({ pathname: '/chat-room', params: { chatId: c.id } });
                else router.push({ pathname: '/(tabs)/chats' });
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="chatbubble-outline" size={15} color="#fff" />
              <Text style={s.chatBtnTxt}>Чат</Text>
            </TouchableOpacity>
            {canRate && employer && vac ? (
              <TouchableOpacity
                style={s.rateBtn}
                onPress={() => router.push({
                  pathname: '/rate',
                  params: {
                    likeId: like.id,
                    toUserId: employer.id,
                    toName: employer.company ?? `${employer.firstName} ${employer.lastName}`,
                    vacancyId: vac.id,
                    role: 'worker',
                  },
                })}
                activeOpacity={0.8}
              >
                <Ionicons name="star-outline" size={15} color="#fff" />
                <Text style={s.rateBtnTxt}>Оставить отзыв</Text>
              </TouchableOpacity>
            ) : isCompleted && like.workerRated ? (
              <View style={s.waitBtn}>
                <Ionicons name="checkmark" size={14} color={Colors.textMuted} />
                <Text style={s.waitBtnTxt}>Отзыв оставлен</Text>
              </View>
            ) : isCancelled ? (
              <View style={s.waitBtn}>
                <Ionicons name="close-circle-outline" size={14} color={Colors.red} />
                <Text style={[s.waitBtnTxt, { color: Colors.red }]}>Смена отменена</Text>
              </View>
            ) : !isFinished ? (
              <View style={s.waitBtn}>
                <Ionicons name="time-outline" size={14} color={Colors.textMuted} />
                <Text style={s.waitBtnTxt}>Ждём подтверждения</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  const TABS = [
    { key: 'active',    label: 'Активные',  count: activeItems.length + partnerActive.length },
    { key: 'rejected',  label: 'Отказ',     count: rejectedItems.length + partnerRejected.length },
    { key: 'completed', label: 'Завершено', count: completedItems.length + partnerCompleted.length },
  ] as const;

  const emptyIcon: Record<typeof tab, React.ComponentProps<typeof Ionicons>['name']> = {
    active: 'clipboard-outline',
    rejected: 'happy-outline',
    completed: 'flag-outline',
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <TabHeader title="Мои отклики" />

      <View style={s.tabStrip}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={s.tabItem} onPress={() => setTab(t.key)} activeOpacity={0.8}>
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

      {shownItems.length === 0 ? (
        <View style={s.empty}>
          {/* Обрыв связи и пустой список — разные вещи, и путать их тут
              дороже, чем в ленте. «Нет активных заявок» человек, только что
              откликнувшийся, читает как «мой отклик пропал»: он не узнает, что
              список просто не принесли, и решит, что сервис его потерял. */}
          <Ionicons
            name={offlineHere ? 'cloud-offline-outline' : emptyIcon[tab]}
            size={56}
            color={Colors.textMuted}
          />
          <Text style={s.emptyTitle}>
            {offlineHere
              ? 'Нет связи с сервером'
              : tab === 'active' ? 'Нет активных заявок' : tab === 'rejected' ? 'Нет отказов' : 'Нет завершённых смен'}
          </Text>
          <Text style={s.emptySub}>
            {offlineHere
              ? 'Список не загрузился — дело в связи. Ваши отклики на месте, потяните вниз, чтобы обновить.'
              : tab === 'active'
              ? 'Откликайтесь на вакансии — они появятся здесь'
              : tab === 'rejected'
              ? 'Это хорошо! Продолжайте откликаться'
              : 'Завершённые смены появятся здесь'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={shownItems}
          keyExtractor={item => `${item.kind}:${item.kind === 'like' ? item.like.id : item.app.id}`}
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

      <VacancyDetailModal
        vacancy={detailVacancy}
        visible={!!detailVacancy}
        onClose={() => setDetailVacancy(null)}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────
// EMPLOYER VIEW
// ─────────────────────────────────────────────────
type EmployerMatchItem = { kind: 'like'; like: Like } | { kind: 'permApp'; app: PermApplication };

function EmployerMatches() {
  const router = useRouter();
  const {
    currentUser, likes, vacancies, users, chats, refreshAll, showToast,
    permApplications, permVacancies, refreshPermApplications, refreshChats,
  } = useApp();
  const [actionLoading, setLoading] = useState<string | null>(null);
  const [approvingApp, setApprovingApp] = useState<PermApplication | null>(null);
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
    await refreshAll();
    setRefreshing(false);
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
  const myPermApps: PermApplication[] = employerPermApps(permApplications, currentUserId);
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
      // Уведомление соискателю шлёт сервер тем же запросом: отсюда оно
      // уходило «выстрелил и забыл» и терялось при любом обрыве связи.
      await dbSetPermApplicationStatus(app.id, 'approved');
      const chatId = await dbCreateChat(
        app.workerId,
        currentUser.id,
        app.vacancyId,
        vacancy.title,
        vacancy.company,
        message,
        1,
        0,
        'employer',
      );
      setApprovingApp(null);
      await refreshPermApplications();
      await refreshChats(currentUser);
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
      await refreshPermApplications();
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
      await refreshPermApplications();
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
  if (currentUser.isGuest) return <GuestGate title="Совпадения — после регистрации" subtitle="Зарегистрируйтесь, чтобы откликаться на смены и видеть, кто ответил вам." />;
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
  partnerMetaRow: { flexDirection: 'row', alignItems: 'center', gap: rs(6) },
  partnerMetaTxt: { fontSize: rf(13), fontWeight: '700', color: Colors.textPrimary },
  partnerCaption: { fontSize: rf(12), lineHeight: rf(17), color: Colors.textMuted },
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
