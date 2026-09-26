import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Shadow } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';
import { useApp } from '@/hooks/useApp';
import { CompanyMark } from '@/components/ui/CompanyMark';
import { normalizeCompany } from '@/services/company';
import type { PermVacancy, User } from '@/constants/types';
import { BackButton } from '@/components/ui/BackButton';
import { useHydrated } from '@/hooks/useHydrated';

type CompanyTab = 'overview' | 'jobs';

function weightedCompanyRating(employers: User[]): { value: number; count: number } | null {
  const rated = employers.filter(
    e => typeof e.avgRating === 'number' && (e.ratingCount ?? 0) > 0,
  );
  if (!rated.length) return null;

  const count = rated.reduce((sum, e) => sum + (e.ratingCount ?? 0), 0);
  if (!count) return null;

  const value = rated.reduce(
    (sum, e) => sum + (e.avgRating ?? 0) * (e.ratingCount ?? 0),
    0,
  ) / count;

  return { value, count };
}

function vacancyLocation(v: PermVacancy): string | null {
  if (v.metroStation) return `м. ${v.metroStation}`;
  if (v.address) return v.address;
  return null;
}

export default function CompanyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ company?: string | string[] }>();
  // Параметр — после первого рендера: иначе расхождение со статическим HTML (#418).
  const rawCompany = useHydrated() ? params.company : undefined;
  const tabBarHeight = useBottomTabBarHeight();
  const { users, permVacancies } = useApp();
  const [tab, setTab] = useState<CompanyTab>('overview');

  const company = normalizeCompany(Array.isArray(rawCompany) ? rawCompany[0] : rawCompany);

  const employers = useMemo(
    () => users.filter(u => u.role === 'employer' && normalizeCompany(u.company) === company),
    [users, company],
  );

  const openJobs = useMemo(
    () => permVacancies
      .filter(v => v.status === 'open' && normalizeCompany(v.company) === company)
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [permVacancies, company],
  );

  const rating = useMemo(() => weightedCompanyRating(employers), [employers]);
  const bio = employers.map(e => e.bio?.trim()).find(Boolean) ?? null;
  const locations = useMemo(
    () => Array.from(
      new Set(openJobs.map(v => vacancyLocation(v)).filter((x): x is string => !!x)),
    ).slice(0, 6),
    [openJobs],
  );
  const schedules = useMemo(
    () => Array.from(new Set(openJobs.map(v => v.schedule?.trim()).filter(Boolean))).slice(0, 4),
    [openJobs],
  );

  const shareCompany = () => {
    const message = openJobs.length
      ? `${company} в JobToo · открытых вакансий: ${openJobs.length}`
      : `${company} в JobToo`;
    Share.share({ message }).catch(() => {});
  };

  const openJob = (v: PermVacancy) => {
    router.push({ pathname: '/perm-vacancy-detail', params: { vacancyId: v.id } });
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <BackButton onPress={() => router.navigate('/(tabs)/feed')} />

        <TouchableOpacity
          style={s.roundButton}
          activeOpacity={0.75}
          onPress={shareCompany}
          accessibilityRole="button"
          accessibilityLabel="Поделиться компанией"
        >
          <Ionicons name="share-outline" size={23} color={Colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: tabBarHeight + rs(38) }]}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
      >
        <View style={s.hero}>
          <View style={s.logoShell}>
            <CompanyMark company={company} size={82} />
          </View>
          <Text style={s.companyName}>{company}</Text>
          <Text style={s.companySub}>
            {openJobs.length > 0
              ? `Работодатель · ${openJobs.length} ${openJobs.length === 1 ? 'вакансия' : openJobs.length < 5 ? 'вакансии' : 'вакансий'}`
              : 'Работодатель в JobToo'}
          </Text>

          <View style={s.heroChips}>
            {rating ? (
              <View style={s.heroChip}>
                <Ionicons name="star" size={14} color={Colors.amber} />
                <Text style={s.heroChipText}>{rating.value.toFixed(1)} · {rating.count}</Text>
              </View>
            ) : null}
            {schedules.map(item => (
              <View key={item} style={s.heroChip}>
                <Ionicons name="time-outline" size={14} color={Colors.primary} />
                <Text style={s.heroChipText} numberOfLines={1}>{item}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.tabs}>
          <TouchableOpacity
            style={s.tab}
            activeOpacity={0.8}
            onPress={() => setTab('overview')}
          >
            <Text style={[s.tabText, tab === 'overview' && s.tabTextActive]}>Обзор</Text>
            {tab === 'overview' ? <View style={s.tabLine} /> : null}
          </TouchableOpacity>
          <TouchableOpacity
            style={s.tab}
            activeOpacity={0.8}
            onPress={() => setTab('jobs')}
          >
            <Text style={[s.tabText, tab === 'jobs' && s.tabTextActive]}>
              Вакансии{openJobs.length ? ` (${openJobs.length})` : ''}
            </Text>
            {tab === 'jobs' ? <View style={s.tabLine} /> : null}
          </TouchableOpacity>
        </View>

        {tab === 'overview' ? (
          <View style={s.sectionStack}>
            <View style={s.statsGrid}>
              <View style={s.statCard}>
                <View style={s.statIcon}>
                  <Ionicons name="briefcase-outline" size={19} color={Colors.primary} />
                </View>
                <Text style={s.statLabel}>Открытые вакансии</Text>
                <Text style={s.statValue}>{openJobs.length}</Text>
              </View>

              <View style={s.statCard}>
                <View style={s.statIcon}>
                  <Ionicons name="star-outline" size={19} color={Colors.primary} />
                </View>
                <Text style={s.statLabel}>Рейтинг</Text>
                <Text style={s.statValue}>{rating ? rating.value.toFixed(1) : '—'}</Text>
              </View>
            </View>

            <View style={s.infoCard}>
              <View style={s.sectionHead}>
                <Text style={s.sectionTitle}>О компании</Text>
                <View style={s.sectionIcon}>
                  <Ionicons name="business-outline" size={18} color={Colors.primary} />
                </View>
              </View>
              <Text style={s.bodyText}>
                {bio || 'Компания пока не добавила описание. Здесь будут условия работы, команда и важная информация для соискателей.'}
              </Text>
            </View>

            <View style={s.infoCard}>
              <View style={s.sectionHead}>
                <Text style={s.sectionTitle}>Где работают</Text>
                <View style={s.sectionIcon}>
                  <Ionicons name="location-outline" size={18} color={Colors.primary} />
                </View>
              </View>
              {locations.length ? locations.map((item, index) => (
                <View key={item} style={[s.infoRow, index > 0 && s.infoRowBorder]}>
                  <Ionicons name="location-outline" size={17} color={Colors.textMuted} />
                  <Text style={s.infoRowText}>{item}</Text>
                </View>
              )) : (
                <Text style={s.bodyMuted}>Точки работы появятся вместе с вакансиями.</Text>
              )}
            </View>

            {openJobs.length ? (
              <View style={s.block}>
                <View style={s.blockHeadingRow}>
                  <Text style={s.blockTitle}>Вакансии сейчас</Text>
                  <TouchableOpacity activeOpacity={0.75} onPress={() => setTab('jobs')}>
                    <Text style={s.showAll}>Все {openJobs.length}</Text>
                  </TouchableOpacity>
                </View>
                {openJobs.slice(0, 2).map(v => (
                  <JobRow key={v.id} vacancy={v} onPress={() => openJob(v)} />
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          <View style={s.sectionStack}>
            {openJobs.length ? openJobs.map(v => (
              <JobRow key={v.id} vacancy={v} onPress={() => openJob(v)} />
            )) : (
              <View style={s.emptyCard}>
                <Ionicons name="briefcase-outline" size={34} color={Colors.textMuted} />
                <Text style={s.emptyTitle}>Пока нет открытых вакансий</Text>
                <Text style={s.bodyMuted}>Когда компания опубликует новую вакансию, она появится здесь.</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function JobRow({ vacancy, onPress }: { vacancy: PermVacancy; onPress: () => void }) {
  const location = vacancyLocation(vacancy);
  return (
    <TouchableOpacity style={s.jobCard} activeOpacity={0.82} onPress={onPress}>
      <View style={s.jobTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.jobTitle} numberOfLines={2}>{vacancy.title}</Text>
          {location ? <Text style={s.jobMeta} numberOfLines={1}>{location}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
      </View>
      <View style={s.jobChips}>
        {vacancy.salary > 0 ? (
          <View style={s.salaryChip}>
            <Text style={s.salaryText}>{vacancy.salary.toLocaleString('ru-RU')} ₽/мес</Text>
          </View>
        ) : null}
        {vacancy.schedule ? (
          <View style={s.neutralChip}>
            <Text style={s.neutralChipText}>{vacancy.schedule}</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.outerBg },
  scroll: { flex: 1 },
  content: { paddingTop: rs(2) },

  topBar: {
    height: rs(58),
    paddingHorizontal: rs(18),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.outerBg,
  },
  roundButton: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(22),
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.card,
  },

  hero: {
    alignItems: 'center',
    paddingHorizontal: rs(24),
    paddingTop: rs(10),
    paddingBottom: rs(22),
  },
  logoShell: {
    width: rs(96),
    height: rs(96),
    borderRadius: rs(28),
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ECEDEF',
    ...Shadow.strong,
  },
  companyName: {
    marginTop: rs(16),
    fontSize: rf(26),
    lineHeight: rf(31),
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  companySub: {
    marginTop: rs(5),
    fontSize: rf(13),
    lineHeight: rf(18),
    fontWeight: '600',
    color: Colors.textMuted,
    textAlign: 'center',
  },
  heroChips: {
    marginTop: rs(13),
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: rs(7),
  },
  heroChip: {
    maxWidth: rs(210),
    minHeight: rs(30),
    paddingHorizontal: rs(11),
    borderRadius: rs(100),
    backgroundColor: Colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(6),
    borderWidth: 1,
    borderColor: '#ECEDEF',
  },
  heroChipText: {
    flexShrink: 1,
    fontSize: rf(11.5),
    fontWeight: '700',
    color: Colors.textSecondary,
  },

  tabs: {
    height: rs(54),
    flexDirection: 'row',
    backgroundColor: Colors.outerBg,
    borderBottomWidth: 1,
    borderBottomColor: '#E7E8EB',
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: rf(14), fontWeight: '600', color: Colors.textMuted },
  tabTextActive: { color: Colors.textPrimary, fontWeight: '800' },
  tabLine: {
    position: 'absolute',
    bottom: -1,
    left: rs(22),
    right: rs(22),
    height: 3,
    borderRadius: rs(2),
    backgroundColor: Colors.primary,
  },

  sectionStack: {
    paddingHorizontal: rs(16),
    paddingTop: rs(16),
    gap: rs(12),
  },
  statsGrid: { flexDirection: 'row', gap: rs(10) },
  statCard: {
    flex: 1,
    minHeight: rs(112),
    borderRadius: rs(20),
    backgroundColor: Colors.card,
    padding: rs(15),
    borderWidth: 1,
    borderColor: '#ECEDEF',
    ...Shadow.card,
  },
  statIcon: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(11),
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: rs(10),
  },
  statLabel: { fontSize: rf(11.5), color: Colors.textMuted, fontWeight: '600' },
  statValue: { marginTop: rs(4), fontSize: rf(21), fontWeight: '800', color: Colors.textPrimary },

  infoCard: {
    borderRadius: rs(20),
    backgroundColor: Colors.card,
    padding: rs(17),
    borderWidth: 1,
    borderColor: '#ECEDEF',
    ...Shadow.card,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: rs(12),
  },
  sectionTitle: { fontSize: rf(17), fontWeight: '800', color: Colors.textPrimary },
  sectionIcon: {
    width: rs(32),
    height: rs(32),
    borderRadius: rs(10),
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyText: { fontSize: rf(13.5), lineHeight: rf(20.5), color: Colors.textSecondary },
  bodyMuted: { fontSize: rf(13), lineHeight: rf(19), color: Colors.textMuted },

  infoRow: {
    minHeight: rs(44),
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(10),
  },
  infoRowBorder: { borderTopWidth: 1, borderTopColor: Colors.divider },
  infoRowText: { flex: 1, fontSize: rf(13), fontWeight: '600', color: Colors.textSecondary },

  block: { gap: rs(9) },
  blockHeadingRow: {
    paddingHorizontal: rs(2),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  blockTitle: { fontSize: rf(18), fontWeight: '800', color: Colors.textPrimary },
  showAll: { fontSize: rf(13), fontWeight: '800', color: Colors.primary },

  jobCard: {
    backgroundColor: Colors.card,
    borderRadius: rs(18),
    padding: rs(16),
    borderWidth: 1,
    borderColor: '#ECEDEF',
    ...Shadow.card,
  },
  jobTop: { flexDirection: 'row', alignItems: 'center', gap: rs(10) },
  jobTitle: { fontSize: rf(15.5), lineHeight: rf(20), fontWeight: '800', color: Colors.textPrimary },
  jobMeta: { marginTop: rs(5), fontSize: rf(12), color: Colors.textMuted, fontWeight: '500' },
  jobChips: { marginTop: rs(12), flexDirection: 'row', flexWrap: 'wrap', gap: rs(7) },
  salaryChip: {
    borderRadius: rs(100),
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: rs(11),
    paddingVertical: rs(7),
  },
  salaryText: { fontSize: rf(11.5), fontWeight: '800', color: Colors.primary },
  neutralChip: {
    borderRadius: rs(100),
    backgroundColor: '#F3F4F6',
    paddingHorizontal: rs(11),
    paddingVertical: rs(7),
  },
  neutralChipText: { fontSize: rf(11.5), fontWeight: '600', color: Colors.textSecondary },

  emptyCard: {
    minHeight: rs(190),
    borderRadius: rs(20),
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: rs(28),
    gap: rs(8),
    borderWidth: 1,
    borderColor: '#ECEDEF',
  },
  emptyTitle: { fontSize: rf(16), fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
});
