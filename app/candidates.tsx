import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScoreBadge } from '@/components/feature/ScoreCard';
import { rankCandidate } from '@/services/matching';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { dbUpsertLike, dbCheckAndCreateMatch } from '@/services/db';
import { getInitials, nameColorFromString } from '@/services/storage';

import { rs, rf } from '@/constants/scale';

export default function CandidatesScreen() {
  const router = useRouter();
  const { vacancyId } = useLocalSearchParams<{ vacancyId: string }>();
  const { currentUser, users, vacancies, likes, refreshAll, showToast } = useApp();
  const [tab, setTab] = useState<'want' | 'matched'>('want');

  const vacancy = vacancies.find(v => v.id === vacancyId);
  if (!vacancy || !currentUser) return null;

  const vacLikes = likes.filter(l => l.vacancyId === vacancyId);
  const getWorker = (workerId: string) => users.find(u => u.id === workerId);

  /**
   * Кандидаты по порядку, а не по времени отклика.
   *
   * Раньше первым шёл тот, кто раньше нажал. При двадцати откликах это
   * значит, что смотрят первых пятерых, а лучший может быть двенадцатым.
   * Теперь наверху те, у кого выше рейтинг, подтверждён навык, кто живёт
   * рядом и кто уже работал у этой компании, — и под именем написано,
   * почему он там: подбор, который молча меняет порядок, работодатель
   * либо не заметит, либо не поверит.
   */
  const ranked = (ls: typeof vacLikes) => ls
    .map(l => {
      const w = getWorker(l.workerId);
      return { like: l, rank: w ? rankCandidate(w, vacancy, likes) : { score: -1, reasons: [] } };
    })
    .sort((a, b) => b.rank.score - a.rank.score);

  const wantLikes = ranked(vacLikes.filter(l => l.workerLiked && !l.isMatch));
  const matchedLikes = ranked(vacLikes.filter(l => l.isMatch));

  const onDecide = async (workerId: string, decide: 'accept' | 'skip') => {
    const like = vacLikes.find(l => l.workerId === workerId);
    if (!like) return;

    if (decide === 'skip') {
      await dbUpsertLike(vacancyId, workerId, currentUser.id, { employerLiked: false });
      await refreshAll();
      showToast('Отклонено', 'success');
      return;
    }

    await dbUpsertLike(vacancyId, workerId, currentUser.id, { employerLiked: true });
    const result = await dbCheckAndCreateMatch(vacancyId, workerId);
    await refreshAll();

    if (result.matched) {
      const worker = getWorker(workerId);
      // О мэтче извещает СЕРВЕР при его создании (jt_notify_match): текст
      // собирает тот, кто записал событие, и только другой стороне.
      showToast(`🎉 Мэтч с ${worker?.firstName ?? 'работником'}! Чат открыт`, 'match');
    } else {
      showToast('Отклик одобрен. Ждём подтверждения работника.', 'success');
    }
  };

  const shown = tab === 'want' ? wantLikes : matchedLikes;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{vacancy.title}</Text>
          <Text style={styles.headerSub}>🚇 {vacancy.metroStation}</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {([
          { key: 'want', label: `Хотят (${wantLikes.length})` },
          { key: 'matched', label: `Мэтчи (${matchedLikes.length})` },
        ] as const).map(t => (
          <TouchableOpacity key={t.key} style={styles.tabItem} onPress={() => setTab(t.key)} activeOpacity={0.8}>
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
            {tab === t.key ? <View style={styles.tabLine} /> : null}
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={shown}
        keyExtractor={x => x.like.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ fontSize: rf(40) }}>{tab === 'want' ? '👀' : '🤝'}</Text>
            <Text style={styles.emptyTitle}>{tab === 'want' ? 'Нет откликов' : 'Нет мэтчей'}</Text>
            <Text style={styles.emptySub}>{tab === 'want' ? 'Работники ещё не откликались' : 'Подтвердите кандидатов во вкладке Хотят'}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const like = item.like;
          const reasons = item.rank.reasons;
          const worker = getWorker(like.workerId);
          if (!worker) return null;
          const isMatch = like.isMatch;
          const workerColor = nameColorFromString(worker.id);
          const initials = getInitials(`${worker.firstName} ${worker.lastName}`);
          return (
            <View style={styles.card}>
              {/* Tappable worker profile row */}
              <TouchableOpacity
                style={styles.cardTop}
                onPress={() => router.push({ pathname: '/user-profile', params: { userId: worker.id } })}
                activeOpacity={0.8}
              >
                {worker.avatarUrl ? (
                  <Image source={{ uri: worker.avatarUrl }} style={styles.avatar} contentFit="cover" transition={150} />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: workerColor }]}>
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.workerName} numberOfLines={1}>{worker.firstName} {worker.lastName}</Text>
                    <ScoreBadge user={worker} />
                  </View>
                  {reasons.length ? (
                    <Text style={styles.reasons} numberOfLines={1}>{reasons.join(' · ')}</Text>
                  ) : null}
                  <Text style={styles.workerMeta}>
                    🚇 {worker.metroStation ?? '—'}
                    {worker.age ? `  ·  ${worker.age} лет` : ''}
                  </Text>
                  {(worker.avgRating ?? 0) > 0 ? (
                    <Text style={styles.workerRating}>⭐ {(worker.avgRating ?? 0).toFixed(1)} ({worker.ratingCount} отз.)</Text>
                  ) : null}
                  {/* Поручительство. Ровно ради этой строки программа
                      приглашений и существует: денег мы за приглашение не
                      платим, платит она — тем, что её видно здесь, когда
                      работодатель выбирает из похожих анкет. Двоеточие с
                      числом, а не «привёл N человек»: склонение при любом N
                      здесь ничего не добавляет, а сломаться может. */}
                  {(worker.referralWorked ?? 0) > 0 ? (
                    <Text style={styles.workerVouch}>🤝 Привёл на смену: {worker.referralWorked}</Text>
                  ) : null}
                </View>
                <Text style={styles.profileArrow}>Профиль ›</Text>
              </TouchableOpacity>

              {/* Bio snippet */}
              {worker.bio ? (
                <Text style={styles.bioSnippet} numberOfLines={2}>{worker.bio}</Text>
              ) : null}

              <View style={styles.infoGrid}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Специальность</Text>
                  <View style={styles.infoChip}><Text style={styles.infoChipText}>📦 Кладовщик</Text></View>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Телефон</Text>
                  <Text style={[styles.infoVal, isMatch && { color: Colors.primary }]}>
                    {isMatch ? worker.phone : '••••••'}
                  </Text>
                </View>
              </View>

              {isMatch ? (
                <TouchableOpacity
                  style={styles.chatBtn}
                  onPress={() => router.push({ pathname: '/(tabs)/chats' })}
                  activeOpacity={0.8}
                >
                  <Text style={styles.chatBtnText}>💬 Открыть чат</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.skipBtn} onPress={() => onDecide(like.workerId, 'skip')} activeOpacity={0.8}>
                    <Text style={styles.skipText}>👎 Пропустить</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.acceptBtn} onPress={() => onDecide(like.workerId, 'accept')} activeOpacity={0.8}>
                    <Text style={styles.acceptText}>✅ Взять!</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: rs(10), paddingHorizontal: rs(16), paddingVertical: rs(12), borderBottomWidth: 1, borderBottomColor: Colors.divider },
  backBtn: {},
  backText: { fontSize: rf(15), color: Colors.textSecondary, fontWeight: '500' },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: rf(15), fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: rf(12), color: Colors.textMuted, marginTop: rs(2) },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.divider },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: rs(12) },
  tabLabel: { fontSize: rf(14), fontWeight: '500', color: Colors.textMuted },
  tabLabelActive: { fontWeight: '700', color: Colors.textPrimary },
  tabLine: { position: 'absolute', bottom: 0, left: '15%', right: '15%', height: 2, backgroundColor: Colors.primary, borderRadius: rs(1) },
  list: { padding: rs(16), gap: rs(12), paddingBottom: rs(100) },
  card: { backgroundColor: Colors.bg, borderRadius: Radius.lg, padding: rs(16), ...Shadow.card, gap: rs(12) },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: rs(12) },
  avatar: { width: rs(48), height: rs(48), borderRadius: rs(24), alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: rf(17), fontWeight: '700', color: '#fff' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: rs(6) },
  reasons: { fontSize: rf(12), color: Colors.primary, marginTop: rs(2), fontWeight: '600' },
  workerName: { fontSize: rf(15), fontWeight: '700', color: Colors.textPrimary },
  workerMeta: { fontSize: rf(12), color: Colors.textMuted, marginTop: rs(2) },
  workerRating: { fontSize: rf(12), color: '#FBBF24', fontWeight: '600', marginTop: rs(2) },
  workerVouch: { fontSize: rf(12), color: Colors.green, fontWeight: '600', marginTop: rs(2) },
  profileArrow: { fontSize: rf(12), color: Colors.primary, fontWeight: '600' },
  bioSnippet: { fontSize: rf(13), color: Colors.textSecondary, lineHeight: rf(18), backgroundColor: Colors.surface, borderRadius: rs(8), padding: rs(10) },
  infoGrid: { gap: rs(8), borderTopWidth: 1, borderTopColor: Colors.divider, paddingTop: rs(10) },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoLabel: { fontSize: rf(13), color: Colors.textMuted },
  infoChip: { backgroundColor: Colors.primaryLight, borderRadius: rs(100), paddingHorizontal: rs(10), paddingVertical: rs(3) },
  infoChipText: { fontSize: rf(12), fontWeight: '600', color: Colors.primary },
  infoVal: { fontSize: rf(14), fontWeight: '600', color: Colors.textPrimary },
  actions: { flexDirection: 'row', gap: rs(10) },
  skipBtn: { flex: 1, borderWidth: 1.5, borderColor: Colors.inputBorder, borderRadius: rs(100), paddingVertical: rs(10), alignItems: 'center' },
  skipText: { fontSize: rf(13), fontWeight: '600', color: Colors.textSecondary },
  acceptBtn: { flex: 1, backgroundColor: Colors.primary, borderRadius: rs(100), paddingVertical: rs(10), alignItems: 'center' },
  acceptText: { fontSize: rf(13), fontWeight: '700', color: '#fff' },
  chatBtn: { borderWidth: 1.5, borderColor: Colors.blue, borderRadius: rs(100), paddingVertical: rs(10), alignItems: 'center' },
  chatBtnText: { fontSize: rf(13), fontWeight: '600', color: Colors.blue },
  empty: { alignItems: 'center', paddingTop: rs(60), gap: rs(8) },
  emptyTitle: { fontSize: rf(18), fontWeight: '700', color: Colors.textPrimary },
  emptySub: { fontSize: rf(14), color: Colors.textMuted, textAlign: 'center', paddingHorizontal: rs(32) },
});
