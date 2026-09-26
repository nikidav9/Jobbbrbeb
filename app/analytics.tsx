import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BarChart, LineChart, PieChart } from 'react-native-chart-kit';
import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import { useApp } from '@/hooks/useApp';

import { rs, rf } from '@/constants/scale';
import { BackButton, BACK_BUTTON_SIZE } from '@/components/ui/BackButton';

const ADMIN_PHONE = '89933431523';
const sb = () => getSupabaseClient();

const WORK_TYPE_LABELS: Record<string, string> = {
  stocker: 'Кладовщик',
  cook: 'Повар',
  shift_supervisor: 'Менеджер',
  picker: 'Комплектовщик',
};

const CHART_COLORS = [
  '#FF6B1A', '#2563EB', '#16A34A', '#7C3AED',
  '#D97706', '#DC2626', '#0891B2', '#059669',
];

// ─── helpers ────────────────────────────────────────────────────────────────

function last30Days(): string[] {
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function toDateKey(iso: string) {
  return iso.slice(0, 10);
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function monthLabel(dateKey: string): string {
  const [, , dd] = dateKey.split('-');
  return dd;
}

// ─── custom chart helpers ───────────────────────────────────────────────────

function everyNth<T>(arr: T[], n: number): T[] {
  return arr.filter((_, i) => i % n === 0 || i === arr.length - 1);
}

// ─── interfaces ──────────────────────────────────────────────────────────────

interface DayCount {
  date: string;
  count: number;
}

interface KV {
  key: string;
  count: number;
}

interface AnalyticsData {
  totalWorkers: number;
  totalEmployers: number;
  newUsersWeek: number;
  totalTempVac: number;
  totalPermVac: number;
  openTempVac: number;
  openPermVac: number;
  totalMatches: number;
  newMatchesWeek: number;
  totalChats: number;
  totalRatings: number;
  avgRating: number;
  totalComplaints: number;
  totalApplications: number;
  // Активация и удержание — из jm_users.last_seen_at (обновляется при каждом
  // запуске/возврате из фона). Отвечает на «сколько установивших реально
  // пользуются», чего в тоталах не видно.
  activationReturned: number;   // вернулись хотя бы раз (last_seen ≥ рег + сутки)
  activationRate: number;       // их доля, %
  active7: number;              // заходили за 7 дней
  active30: number;             // заходили за 30 дней
  dormant: number;              // не заходили 30+ дней или ни разу
  medianLifespanDays: number;   // медиана «от регистрации до последнего визита»
  // Активация в разрезе роли: приложение показывает два разных мира —
  // соискателю (worker) и работодателю (employer). Важно понимать, в какой
  // роли человек «залипает», а в какой отваливается сразу.
  activationByRole: {
    role: 'worker' | 'employer';
    total: number;
    returned: number;
    rate: number;
    active7: number;
  }[];
  activationCohorts: { label: string; total: number; returned: number }[];
  // Воронка «открыл приложение» (Фаза 1b), за 30 дней. Пусто, пока событие не
  // накопится на сервере — тогда показываем подсказку вместо цифр.
  openHasData: boolean;
  openEvents: number;         // всего запусков
  openDevices: number;        // уникальных устройств
  openRegistered: number;     // из них с аккаунтом
  openGuests: number;         // открыли, но аккаунта нет ни разу
  openByRole: { worker: number; employer: number; guest: number }; // устройства по роли
  userGrowthDays: DayCount[];
  workerGrowthDays: DayCount[];
  employerGrowthDays: DayCount[];
  vacGrowthDays: DayCount[];
  matchGrowthDays: DayCount[];
  workTypeDist: KV[];
  metroTop: KV[];
  ratingDist: KV[];
  appStatusDist: KV[];
}

// ─── data fetching ───────────────────────────────────────────────────────────

async function fetchAnalytics(): Promise<AnalyticsData> {
  const cutoff30 = new Date();
  cutoff30.setDate(cutoff30.getDate() - 30);
  const cutoff30Iso = cutoff30.toISOString();

  const cutoff7 = new Date();
  cutoff7.setDate(cutoff7.getDate() - 7);
  const cutoff7Iso = cutoff7.toISOString();

  const [
    { data: users },
    { data: tempVacs },
    { data: permVacs },
    { data: likes },
    { data: chats },
    { data: ratings },
    { data: complaints },
    { data: applications },
    { data: recentUsers },
    { data: recentTempVacs },
    { data: recentMatches },
    { data: appOpens },
  ] = await Promise.all([
    sb().from('jm_users').select('id,role,created_at,last_seen_at'),
    sb().from('jm_vacancies').select('id,status,work_type,created_at'),
    sb().from('jm_perm_vacancies').select('id,status,created_at'),
    sb().from('jm_likes').select('id,is_match,matched_at'),
    sb().from('jm_chats').select('id'),
    sb().from('jm_ratings').select('id,rating'),
    sb().from('jm_complaints').select('id'),
    sb().from('jm_perm_applications').select('id,status'),
    sb().from('jm_users').select('role,created_at').gte('created_at', cutoff30Iso),
    sb().from('jm_vacancies').select('created_at').gte('created_at', cutoff30Iso),
    sb()
      .from('jm_likes')
      .select('matched_at')
      .eq('is_match', true)
      .not('matched_at', 'is', null)
      .gte('matched_at', cutoff30Iso),
    // Событие «открыл приложение» (Фаза 1b). Таблица может ещё не существовать
    // на сервере — тогда вернётся ошибка и data=null, что мы гасим через ?? [].
    sb().from('jm_app_opens').select('anon_id,user_id,role,opened_at').gte('opened_at', cutoff30Iso),
  ]);

  const allUsers = users ?? [];
  const allTempVacs = tempVacs ?? [];
  const allPermVacs = permVacs ?? [];
  const allLikes = likes ?? [];
  const allRatings = ratings ?? [];

  const workers = allUsers.filter((u: any) => u.role === 'worker');
  const employers = allUsers.filter((u: any) => u.role === 'employer');

  const newUsersWeek = allUsers.filter(
    (u: any) => new Date(u.created_at) >= new Date(cutoff7Iso)
  ).length;

  const matches = allLikes.filter((l: any) => l.is_match);
  const newMatchesWeek = matches.filter(
    (l: any) => l.matched_at && new Date(l.matched_at) >= new Date(cutoff7Iso)
  ).length;

  const avgRating =
    allRatings.length > 0
      ? allRatings.reduce((s: number, r: any) => s + Number(r.rating), 0) / allRatings.length
      : 0;

  // 30-day growth arrays
  const days = last30Days();

  function buildDayCounts(items: any[], dateField: string): DayCount[] {
    const map: Record<string, number> = {};
    for (const item of items) {
      const key = toDateKey(item[dateField] ?? '');
      if (key) map[key] = (map[key] ?? 0) + 1;
    }
    return days.map(d => ({ date: d, count: map[d] ?? 0 }));
  }

  const recentUsersArr = recentUsers ?? [];
  const recentTempVacsArr = recentTempVacs ?? [];
  const recentMatchesArr = recentMatches ?? [];

  const userGrowthDays = buildDayCounts(recentUsersArr, 'created_at');
  const workerGrowthDays = buildDayCounts(
    recentUsersArr.filter((u: any) => u.role === 'worker'),
    'created_at'
  );
  const employerGrowthDays = buildDayCounts(
    recentUsersArr.filter((u: any) => u.role === 'employer'),
    'created_at'
  );
  const vacGrowthDays = buildDayCounts(recentTempVacsArr, 'created_at');
  const matchGrowthDays = buildDayCounts(recentMatchesArr, 'matched_at');

  // work type distribution
  const wtMap: Record<string, number> = {};
  for (const v of allTempVacs) {
    const wt = (v as any).work_type ?? 'other';
    wtMap[wt] = (wtMap[wt] ?? 0) + 1;
  }
  const workTypeDist: KV[] = Object.entries(wtMap)
    .map(([key, count]) => ({ key: WORK_TYPE_LABELS[key] ?? key, count }))
    .sort((a, b) => b.count - a.count);

  // metro top (from users — need separate query)
  const { data: metroUsers } = await sb()
    .from('jm_users')
    .select('metro_station')
    .not('metro_station', 'is', null);

  const metroMap: Record<string, number> = {};
  for (const u of metroUsers ?? []) {
    const s = (u as any).metro_station;
    if (s) metroMap[s] = (metroMap[s] ?? 0) + 1;
  }
  const metroTop: KV[] = Object.entries(metroMap)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // rating distribution
  const ratingMap: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const r of allRatings) {
    const v = String(Math.round(Number((r as any).rating)));
    if (ratingMap[v] !== undefined) ratingMap[v]++;
  }
  const ratingDist: KV[] = Object.entries(ratingMap).map(([key, count]) => ({
    key: '★'.repeat(Number(key)),
    count,
  }));

  // application status
  const appMap: Record<string, number> = {};
  for (const a of applications ?? []) {
    const s = (a as any).status ?? 'unknown';
    appMap[s] = (appMap[s] ?? 0) + 1;
  }
  const appStatusLabels: Record<string, string> = {
    pending: 'Ожидает',
    approved: 'Одобрено',
    rejected: 'Отклонено',
  };
  const appStatusDist: KV[] = Object.entries(appMap).map(([key, count]) => ({
    key: appStatusLabels[key] ?? key,
    count,
  }));

  // ── Активация и удержание ────────────────────────────────────────────────
  // «Вернулся хоть раз» = последний визит хотя бы через сутки после регистрации.
  // Это лучший из доступных без нового трекинга признак «реально пользуется»:
  // те, у кого last_seen ≈ момент регистрации, зашли один раз и пропали.
  const nowMs = Date.now();
  const DAY = 86_400_000;
  const seenMs = (u: any) => (u.last_seen_at ? new Date(u.last_seen_at).getTime() : NaN);
  const bornMs = (u: any) => new Date(u.created_at).getTime();

  const activationReturned = allUsers.filter(
    (u: any) => u.last_seen_at && seenMs(u) - bornMs(u) >= DAY
  ).length;
  const activationRate = allUsers.length
    ? Math.round((activationReturned / allUsers.length) * 100)
    : 0;
  const active7 = allUsers.filter((u: any) => u.last_seen_at && nowMs - seenMs(u) <= 7 * DAY).length;
  const active30 = allUsers.filter((u: any) => u.last_seen_at && nowMs - seenMs(u) <= 30 * DAY).length;
  const dormant = allUsers.length - active30;

  const spans = allUsers
    .filter((u: any) => u.last_seen_at)
    .map((u: any) => (seenMs(u) - bornMs(u)) / DAY)
    .sort((a: number, b: number) => a - b);
  const medianLifespanDays = spans.length
    ? Math.round(spans[Math.floor(spans.length / 2)] * 10) / 10
    : 0;

  // Активация по роли (worker/employer) — тот же признак «вернулся хоть раз»,
  // но отдельно по каждому миру приложения.
  const roleStat = (role: 'worker' | 'employer') => {
    const arr = allUsers.filter((u: any) => u.role === role);
    const returned = arr.filter(
      (u: any) => u.last_seen_at && seenMs(u) - bornMs(u) >= DAY
    ).length;
    const a7 = arr.filter((u: any) => u.last_seen_at && nowMs - seenMs(u) <= 7 * DAY).length;
    return {
      role,
      total: arr.length,
      returned,
      rate: arr.length ? Math.round((returned / arr.length) * 100) : 0,
      active7: a7,
    };
  };
  const activationByRole = [roleStat('worker'), roleStat('employer')];

  // Когорты активации по неделям регистрации (последние 6 недель): из каждой
  // недели — сколько зарегистрировавшихся вернулись хотя бы раз.
  const WEEK = 7 * DAY;
  const activationCohorts: { label: string; total: number; returned: number }[] = [];
  for (let w = 5; w >= 0; w--) {
    const start = nowMs - (w + 1) * WEEK;
    const end = nowMs - w * WEEK;
    const inWk = allUsers.filter((u: any) => {
      const t = bornMs(u);
      return t >= start && t < end;
    });
    const ret = inWk.filter((u: any) => u.last_seen_at && seenMs(u) - bornMs(u) >= DAY).length;
    const d0 = new Date(start);
    const label = `${String(d0.getDate()).padStart(2, '0')}.${String(d0.getMonth() + 1).padStart(2, '0')}`;
    activationCohorts.push({ label, total: inWk.length, returned: ret });
  }

  // ── Воронка «открыл приложение» (Фаза 1b) ────────────────────────────────
  const opens = appOpens ?? [];
  const openHasData = opens.length > 0;
  // сводим по устройству (anon_id): зарегистрировано ли оно и в какой роли
  // человека видели последний раз (последнее событие устройства).
  const byDevice = new Map<string, { registered: boolean; role: string | null; t: number }>();
  for (const o of opens as any[]) {
    const key = o.anon_id || o.user_id || '?';
    const t = o.opened_at ? new Date(o.opened_at).getTime() : 0;
    const prev = byDevice.get(key);
    const registered = (prev?.registered ?? false) || !!o.user_id;
    // роль берём из самого свежего события устройства
    const role = !prev || t >= prev.t ? (o.role ?? null) : prev.role;
    byDevice.set(key, { registered, role, t: Math.max(t, prev?.t ?? 0) });
  }
  const openEvents = opens.length;
  const openDevices = byDevice.size;
  let openRegistered = 0;
  const openByRole = { worker: 0, employer: 0, guest: 0 };
  byDevice.forEach((d) => {
    if (d.registered) openRegistered++;
    if (d.role === 'worker') openByRole.worker++;
    else if (d.role === 'employer') openByRole.employer++;
    else openByRole.guest++;
  });
  const openGuests = openDevices - openRegistered;

  return {
    totalWorkers: workers.length,
    totalEmployers: employers.length,
    newUsersWeek,
    totalTempVac: allTempVacs.length,
    totalPermVac: allPermVacs.length,
    openTempVac: allTempVacs.filter((v: any) => v.status === 'open').length,
    openPermVac: allPermVacs.filter((v: any) => v.status === 'open').length,
    totalMatches: matches.length,
    newMatchesWeek,
    totalChats: (chats ?? []).length,
    totalRatings: allRatings.length,
    avgRating,
    totalComplaints: (complaints ?? []).length,
    totalApplications: (applications ?? []).length,
    activationReturned,
    activationRate,
    active7,
    active30,
    dormant,
    medianLifespanDays,
    activationByRole,
    activationCohorts,
    openHasData,
    openEvents,
    openDevices,
    openRegistered,
    openGuests,
    openByRole,
    userGrowthDays,
    workerGrowthDays,
    employerGrowthDays,
    vacGrowthDays,
    matchGrowthDays,
    workTypeDist,
    metroTop,
    ratingDist,
    appStatusDist,
  };
}

// ─── sub-components ──────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  color = Colors.primary,
  wide = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  wide?: boolean;
}) {
  return (
    <View style={[s.kpiCard, wide && s.kpiWide, { borderTopColor: color, borderTopWidth: 3 }]}>
      <Text style={[s.kpiValue, { color }]}>{fmtNum(Number(value))}</Text>
      <Text style={s.kpiLabel}>{label}</Text>
      {sub ? <Text style={s.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

function SectionTitle({ title, icon }: { title: string; icon: string }) {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionIcon}>{icon}</Text>
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

function ChartCard({
  title,
  children,
  half = false,
}: {
  title: string;
  children: React.ReactNode;
  half?: boolean;
}) {
  return (
    <View style={[s.chartCard, half && s.chartHalf]}>
      <Text style={s.chartTitle}>{title}</Text>
      {children}
    </View>
  );
}

function MiniBarChart({ data, labels, color }: { data: number[]; labels: string[]; color: string }) {
  const max = Math.max(...data, 1);
  return (
    <View style={s.miniBarWrap}>
      {data.map((v, i) => (
        <View key={i} style={s.miniBarCol}>
          <View
            style={[
              s.miniBarFill,
              {
                height: Math.max(4, (v / max) * 80),
                backgroundColor: color,
                opacity: v === 0 ? 0.2 : 1,
              },
            ]}
          />
          <Text style={s.miniBarLabel}>{labels[i]}</Text>
        </View>
      ))}
    </View>
  );
}

function HorizBarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <View style={s.horizRow}>
      <Text style={s.horizLabel} numberOfLines={1}>{label}</Text>
      <View style={s.horizTrack}>
        <View style={[s.horizFill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={s.horizCount}>{value}</Text>
    </View>
  );
}

// ─── main screen ─────────────────────────────────────────────────────────────

const CHART_CFG = {
  backgroundGradientFrom: '#fff',
  backgroundGradientTo: '#fff',
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(255, 107, 26, ${opacity})`,
  labelColor: () => Colors.textSecondary,
  propsForDots: { r: '3', strokeWidth: '1', stroke: Colors.primary },
  propsForBackgroundLines: { stroke: Colors.divider },
};

const W = Math.min(Dimensions.get('window').width, 1100);
const CARD_W = (W - 48 - 12) / 2; // two-column chart width

export default function AnalyticsScreen() {
  const { currentUser } = useApp();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');

  const isAdmin = currentUser?.phone === ADMIN_PHONE;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await fetchAnalytics();
      setData(d);
      setLastUpdated(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  if (!isAdmin) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <BackButton />
          <Text style={s.headerTitle}>Аналитика</Text>
          <View style={{ width: BACK_BUTTON_SIZE }} />
        </View>
        <View style={s.center}>
          <Text style={{ fontSize: rf(48) }}>🔒</Text>
          <Text style={s.accessDenied}>Доступ запрещён</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading || !data) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <BackButton />
          <Text style={s.headerTitle}>Аналитика</Text>
          <View style={{ width: BACK_BUTTON_SIZE }} />
        </View>
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={s.loadingTxt}>Загружаем данные…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── chart datasets ──────────────────────────────────────────────────────

  const days30 = data.userGrowthDays.map(d => d.date);
  // show every 5th label to avoid crowding
  const dayLabels = days30.map((d, i) => (i % 5 === 0 || i === 29 ? monthLabel(d) : ''));

  const userLineData = {
    labels: dayLabels,
    datasets: [
      {
        data: data.workerGrowthDays.map(d => d.count),
        color: (op = 1) => `rgba(255,107,26,${op})`,
        strokeWidth: 2,
      },
      {
        data: data.employerGrowthDays.map(d => d.count),
        color: (op = 1) => `rgba(37,99,235,${op})`,
        strokeWidth: 2,
      },
    ],
    legend: ['Работники', 'Работодатели'],
  };

  const vacLineData = {
    labels: dayLabels,
    datasets: [
      {
        data: data.vacGrowthDays.map(d => d.count),
        color: (op = 1) => `rgba(22,163,74,${op})`,
        strokeWidth: 2,
      },
    ],
    legend: ['Вакансии'],
  };

  const matchLineData = {
    labels: dayLabels,
    datasets: [
      {
        data: data.matchGrowthDays.map(d => d.count),
        color: (op = 1) => `rgba(124,58,237,${op})`,
        strokeWidth: 2,
      },
    ],
    legend: ['Совпадения'],
  };

  const workTypePieData = data.workTypeDist.slice(0, 4).map((d, i) => ({
    name: d.key,
    population: d.count || 0,
    color: CHART_COLORS[i],
    legendFontColor: Colors.textSecondary,
    legendFontSize: 12,
  }));

  const metroMax = data.metroTop[0]?.count ?? 1;
  const ratingMax = Math.max(...data.ratingDist.map(d => d.count), 1);

  // ── render ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.safe}>
      {/* header */}
      <View style={s.header}>
        <BackButton />
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>📊 Аналитика</Text>
          {lastUpdated ? (
            <Text style={s.headerSub}>обновлено в {lastUpdated}</Text>
          ) : null}
        </View>
        <TouchableOpacity style={s.refreshBtn} onPress={() => load()}>
          <Text style={s.refreshTxt}>↺ Обновить</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        showsVerticalScrollIndicator={false}
      >

        {/* ── KPI: пользователи ── */}
        <SectionTitle title="Пользователи" icon="👥" />
        <View style={s.kpiRow}>
          <KpiCard
            label="Всего пользователей"
            value={data.totalWorkers + data.totalEmployers}
            sub={`+${data.newUsersWeek} за 7 дней`}
            color={Colors.primary}
          />
          <KpiCard label="Работники" value={data.totalWorkers} color={Colors.primary} />
          <KpiCard label="Работодатели" value={data.totalEmployers} color={Colors.blue} />
          <KpiCard label="Жалоб" value={data.totalComplaints} color={Colors.red} />
        </View>

        {/* ── Активация и удержание ── */}
        <SectionTitle title="Активация и удержание" icon="🔁" />
        <View style={s.kpiRow}>
          <KpiCard
            label="Вернулись хоть раз"
            value={data.activationReturned}
            sub={`${data.activationRate}% от всех — остальные зашли раз и пропали`}
            color={Colors.primary}
            wide
          />
          <KpiCard label="Активны за 7 дней" value={data.active7} color="#16A34A" />
          <KpiCard label="Активны за 30 дней" value={data.active30} color={Colors.blue} />
          <KpiCard label="Спят 30+ дней" value={data.dormant} color={Colors.red} />
          <KpiCard label="Медиана «прожил», дней" value={data.medianLifespanDays} color={Colors.textSecondary} />
        </View>
        <ChartCard title="Активация по роли — в каком «мире» залипают">
          {data.activationByRole.map((r) => (
            <HorizBarRow
              key={r.role}
              label={`${r.role === 'worker' ? 'Соискатели' : 'Работодатели'} · ${r.total} рег. · верн. ${r.rate}% · за 7 дн. ${r.active7}`}
              value={r.returned}
              max={r.total}
              color={r.role === 'worker' ? Colors.primary : Colors.blue}
            />
          ))}
          <Text style={{ color: Colors.textSecondary, fontSize: rf(11.5), marginTop: 10, lineHeight: rf(16) }}>
            Приложение — это два разных продукта под одним входом. Если у одной роли «вернулись» заметно ниже — первый экран именно этой роли не удерживает.
          </Text>
        </ChartCard>
        <ChartCard title="Активация по неделям регистрации — сколько вернулись">
          {data.activationCohorts.map((c, i) => (
            <HorizBarRow
              key={i}
              label={`${c.label} · ${c.total} рег.`}
              value={c.returned}
              max={c.total}
              color={Colors.primary}
            />
          ))}
          <Text style={{ color: Colors.textSecondary, fontSize: rf(11.5), marginTop: 10, lineHeight: rf(16) }}>
            «Вернулись» = последний визит хотя бы через сутки после регистрации.
          </Text>
        </ChartCard>

        {/* ── Воронка запусков (Фаза 1b) ── */}
        <ChartCard title="Открыли приложение — за 30 дней">
          {data.openHasData ? (
            <>
              <View style={s.kpiRow}>
                <KpiCard label="Запусков" value={data.openEvents} color={Colors.primary} />
                <KpiCard label="Устройств" value={data.openDevices} color={Colors.blue} />
                <KpiCard
                  label="С аккаунтом"
                  value={data.openRegistered}
                  sub={data.openDevices ? `${Math.round((data.openRegistered / data.openDevices) * 100)}% дошли до регистрации` : undefined}
                  color="#16A34A"
                />
                <KpiCard
                  label="Ушли гостями"
                  value={data.openGuests}
                  sub="открыли, но не завели аккаунт"
                  color={Colors.red}
                />
              </View>
              <Text style={{ color: Colors.textSecondary, fontSize: rf(12), fontWeight: '600', marginTop: 6, marginBottom: 2 }}>
                В какой роли открывали (по устройствам)
              </Text>
              <HorizBarRow label="Соискатель" value={data.openByRole.worker} max={data.openDevices} color={Colors.primary} />
              <HorizBarRow label="Работодатель" value={data.openByRole.employer} max={data.openDevices} color={Colors.blue} />
              <HorizBarRow label="Ещё не выбрал (гость)" value={data.openByRole.guest} max={data.openDevices} color={Colors.textSecondary} />
            </>
          ) : (
            <Text style={{ color: Colors.textSecondary, fontSize: rf(12.5), lineHeight: rf(18) }}>
              Событие «открыл приложение» только что включено. Цифры появятся, как только пользователи начнут открывать приложение: тогда станут видны установил → открыл → зарегистрировался и в какой роли люди заходят.
            </Text>
          )}
        </ChartCard>

        {/* ── KPI: вакансии и матчи ── */}
        <SectionTitle title="Вакансии и подборки" icon="💼" />
        <View style={s.kpiRow}>
          <KpiCard
            label="Врем. вакансий"
            value={data.totalTempVac}
            sub={`${data.openTempVac} открыто`}
            color={Colors.green}
          />
          <KpiCard
            label="Пост. вакансий"
            value={data.totalPermVac}
            sub={`${data.openPermVac} открыто`}
            color={Colors.green}
          />
          <KpiCard
            label="Совпадений"
            value={data.totalMatches}
            sub={`+${data.newMatchesWeek} за 7 дней`}
            color={Colors.purple}
          />
          <KpiCard label="Чатов" value={data.totalChats} color={Colors.blue} />
        </View>

        {/* ── KPI: рейтинги и заявки ── */}
        <View style={s.kpiRow}>
          <KpiCard label="Оценок" value={data.totalRatings} color={Colors.primary} />
          <KpiCard
            label="Средний рейтинг"
            value={data.avgRating.toFixed(2)}
            color={data.avgRating >= 4 ? Colors.green : Colors.primary}
          />
          <KpiCard label="Заявок на пост." value={data.totalApplications} color={Colors.blue} />
          <View style={[s.kpiCard, { opacity: 0 }]} />
        </View>

        {/* ── рост пользователей ── */}
        <SectionTitle title="Рост пользователей (30 дней)" icon="📈" />
        <View style={s.chartsRow}>
          <ChartCard title="Новые пользователи по дням" half>
            <LineChart
              data={userLineData}
              width={CARD_W - 32}
              height={180}
              chartConfig={{
                ...CHART_CFG,
                color: (op = 1) => `rgba(255,107,26,${op})`,
              }}
              bezier
              withDots={false}
              withInnerLines
              withOuterLines={false}
              style={{ borderRadius: Radius.sm }}
            />
          </ChartCard>

          <ChartCard title="Новые вакансии по дням" half>
            <LineChart
              data={vacLineData}
              width={CARD_W - 32}
              height={180}
              chartConfig={{
                ...CHART_CFG,
                color: (op = 1) => `rgba(22,163,74,${op})`,
              }}
              bezier
              withDots={false}
              withInnerLines
              withOuterLines={false}
              style={{ borderRadius: Radius.sm }}
            />
          </ChartCard>
        </View>

        {/* ── совпадения ── */}
        <SectionTitle title="Активность совпадений (30 дней)" icon="🤝" />
        <View style={s.chartsRow}>
          <ChartCard title="Совпадения по дням" half>
            <LineChart
              data={matchLineData}
              width={CARD_W - 32}
              height={180}
              chartConfig={{
                ...CHART_CFG,
                color: (op = 1) => `rgba(124,58,237,${op})`,
              }}
              bezier
              withDots={false}
              withInnerLines
              withOuterLines={false}
              style={{ borderRadius: Radius.sm }}
            />
          </ChartCard>

          {/* Типы работ */}
          <ChartCard title="Распределение по типам работ" half>
            {workTypePieData.length > 0 ? (
              <PieChart
                data={workTypePieData}
                width={CARD_W - 32}
                height={180}
                chartConfig={CHART_CFG}
                accessor="population"
                backgroundColor="transparent"
                paddingLeft="8"
                hasLegend
              />
            ) : (
              <View style={s.emptyChart}>
                <Text style={s.emptyChartTxt}>Нет данных</Text>
              </View>
            )}
          </ChartCard>
        </View>

        {/* ── топ метро ── */}
        <SectionTitle title="Топ станций метро" icon="🚇" />
        <View style={s.fullCard}>
          {data.metroTop.length > 0 ? (
            data.metroTop.map((m, i) => (
              <HorizBarRow
                key={m.key}
                label={m.key}
                value={m.count}
                max={metroMax}
                color={CHART_COLORS[i % CHART_COLORS.length]}
              />
            ))
          ) : (
            <Text style={s.emptyChartTxt}>Нет данных о метро</Text>
          )}
        </View>

        {/* ── рейтинги + заявки ── */}
        <SectionTitle title="Оценки и заявки" icon="⭐" />
        <View style={s.chartsRow}>
          <ChartCard title="Распределение оценок" half>
            {data.ratingDist.some(d => d.count > 0) ? (
              <>
                {data.ratingDist.map((r, i) => (
                  <HorizBarRow
                    key={r.key}
                    label={r.key}
                    value={r.count}
                    max={ratingMax}
                    color={Colors.primary}
                  />
                ))}
              </>
            ) : (
              <View style={s.emptyChart}>
                <Text style={s.emptyChartTxt}>Нет оценок</Text>
              </View>
            )}
          </ChartCard>

          <ChartCard title="Заявки на постоянные вакансии" half>
            {data.appStatusDist.length > 0 ? (
              <>
                {data.appStatusDist.map((a, i) => (
                  <HorizBarRow
                    key={a.key}
                    label={a.key}
                    value={a.count}
                    max={Math.max(...data.appStatusDist.map(d => d.count), 1)}
                    color={CHART_COLORS[i + 2]}
                  />
                ))}
              </>
            ) : (
              <View style={s.emptyChart}>
                <Text style={s.emptyChartTxt}>Нет заявок</Text>
              </View>
            )}
          </ChartCard>
        </View>

        {/* ── mini bar: last 30 days matches ── */}
        <SectionTitle title="Динамика совпадений (бар)" icon="📊" />
        <View style={s.fullCard}>
          <MiniBarChart
            data={data.matchGrowthDays.map(d => d.count)}
            labels={data.matchGrowthDays.map((d, i) => (i % 5 === 0 ? monthLabel(d.date) : ''))}
            color={Colors.purple}
          />
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.outerBg },
  scroll: { flex: 1 },
  scrollContent: { padding: rs(16), maxWidth: rs(1100), alignSelf: 'center', width: '100%' },

  // header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: rs(16),
    paddingVertical: rs(12),
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    ...Shadow.card,
  },
  headerCenter: { alignItems: 'center' },
  headerTitle: { fontSize: rf(17), fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: rf(11), color: Colors.textMuted, marginTop: rs(1) },
  refreshBtn: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: rs(12),
    paddingVertical: rs(6),
    borderRadius: Radius.full,
  },
  refreshTxt: { fontSize: rf(13), color: Colors.primary, fontWeight: '600' },

  // states
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: rs(12) },
  accessDenied: { fontSize: rf(18), fontWeight: '700', color: Colors.textPrimary, marginTop: rs(12) },
  loadingTxt: { fontSize: rf(14), color: Colors.textSecondary, marginTop: rs(8) },

  // sections
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(6),
    marginTop: rs(20),
    marginBottom: rs(10),
  },
  sectionIcon: { fontSize: rf(16) },
  sectionTitle: { fontSize: rf(15), fontWeight: '700', color: Colors.textPrimary },

  // kpi cards
  kpiRow: {
    flexDirection: 'row',
    gap: rs(10),
    flexWrap: 'wrap',
    marginBottom: rs(4),
  },
  kpiCard: {
    flex: 1,
    minWidth: rs(140),
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    padding: rs(14),
    ...Shadow.card,
  },
  kpiWide: { minWidth: rs(200) },
  kpiValue: { fontSize: rf(28), fontWeight: '800', lineHeight: rf(32) },
  kpiLabel: { fontSize: rf(12), color: Colors.textSecondary, marginTop: rs(4), fontWeight: '500' },
  kpiSub: { fontSize: rf(11), color: Colors.textMuted, marginTop: rs(2) },

  // chart cards
  chartsRow: {
    flexDirection: 'row',
    gap: rs(12),
    flexWrap: 'wrap',
    marginBottom: rs(4),
  },
  chartCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    padding: rs(16),
    ...Shadow.card,
    flex: 1,
    minWidth: rs(280),
  },
  chartHalf: { flex: 1 },
  chartTitle: { fontSize: rf(13), fontWeight: '700', color: Colors.textPrimary, marginBottom: rs(12) },

  fullCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    padding: rs(16),
    ...Shadow.card,
    marginBottom: rs(4),
  },

  // empty
  emptyChart: { height: rs(120), alignItems: 'center', justifyContent: 'center' },
  emptyChartTxt: { color: Colors.textMuted, fontSize: rf(13) },

  // horiz bar
  horizRow: { flexDirection: 'row', alignItems: 'center', marginBottom: rs(10), gap: rs(8) },
  horizLabel: { width: rs(100), fontSize: rf(12), color: Colors.textSecondary, fontWeight: '500' },
  horizTrack: {
    flex: 1,
    height: rs(8),
    backgroundColor: Colors.divider,
    borderRadius: rs(4),
    overflow: 'hidden',
  },
  horizFill: { height: rs(8), borderRadius: rs(4) },
  horizCount: { width: rs(32), fontSize: rf(12), color: Colors.textPrimary, fontWeight: '600', textAlign: 'right' },

  // mini bar
  miniBarWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: rs(100),
    gap: rs(3),
  },
  miniBarCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  miniBarFill: { width: '100%', borderRadius: rs(2), minHeight: rs(4) },
  miniBarLabel: { fontSize: rf(9), color: Colors.textMuted, marginTop: rs(3) },
});
