import React, { useState, useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Platform, Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScoreCard } from '@/components/feature/ScoreCard';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { METRO_LINES } from '@/constants/metro';
import { nameColorFromString, getInitials } from '@/services/storage';
import { dbGetRatingsForUser, dbGetUserById, dbUserStats, UserRating, UserStats } from '@/services/db';
import { lastSeenLabel, replySpeedLabel, replyRateLabel } from '@/services/presence';
import { getSupabaseClient } from '@/template';

import { rs, rf } from '@/constants/scale';

function StarRow({ rating, count }: { rating: number; count: number }) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map(s => (
        <Text key={s} style={[styles.star, rating >= s - 0.4 ? styles.starOn : styles.starOff]}>★</Text>
      ))}
      <Text style={styles.ratingText}>
        {count > 0 ? `${rating.toFixed(1)} · ${count} отзывов` : 'Нет оценок'}
      </Text>
    </View>
  );
}

function StarsMini({ rating }: { rating: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(s => (
        <Text key={s} style={{ fontSize: rf(13), color: rating >= s ? '#FBBF24' : '#E5E7EB' }}>★</Text>
      ))}
    </View>
  );
}

function RatingCard({ r }: { r: UserRating }) {
  const date = new Date(r.createdAt);
  const dateStr = `${date.getDate().toString().padStart(2,'0')}.${(date.getMonth()+1).toString().padStart(2,'0')}.${date.getFullYear()}`;
  const roleLabel = r.role === 'worker' ? 'Работник' : 'Работодатель';
  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewTop}>
        <StarsMini rating={r.rating} />
        <Text style={styles.reviewRole}>{roleLabel}</Text>
        <Text style={styles.reviewDate}>{dateStr}</Text>
      </View>
      {r.reviewText ? (
        <Text style={styles.reviewText}>{r.reviewText}</Text>
      ) : (
        <Text style={styles.reviewEmpty}>Без комментария</Text>
      )}
    </View>
  );
}

type Tab = 'info' | 'reviews';

export default function UserProfileScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { users, currentUser, likes, permApplications, showToast } = useApp();

  const [tab, setTab] = useState<Tab>('info');
  const [ratings, setRatings] = useState<UserRating[]>([]);
  const [loadingRatings, setLoadingRatings] = useState(false);
  const [ratingsLoadFailed, setRatingsLoadFailed] = useState(false);
  const [fetchedUser, setFetchedUser] = useState<import('@/constants/types').User | null>(null);
  const [fetchingUser, setFetchingUser] = useState(false);
  const [userLoadFailed, setUserLoadFailed] = useState(false);
  const [userRetry, setUserRetry] = useState(0);
  const [stats, setStats] = useState<UserStats | null>(null);

  const contextUser = users.find(u => u.id === userId);
  const user = contextUser ?? fetchedUser;

  useEffect(() => {
    if (!userId || contextUser) return;
    setFetchingUser(true);
    setUserLoadFailed(false);
    dbGetUserById(userId)
      .then(u => setFetchedUser(u))
      .catch(() => setUserLoadFailed(true))
      .finally(() => setFetchingUser(false));
  }, [userId, contextUser, userRetry]);

  const fetchRatings = (id: string) => {
    setLoadingRatings(true);
    setRatingsLoadFailed(false);
    dbGetRatingsForUser(id)
      .then(setRatings)
      .catch(() => setRatingsLoadFailed(true))
      .finally(() => setLoadingRatings(false));
  };

  useEffect(() => {
    if (!userId) return;
    fetchRatings(userId);
  }, [userId]);

  // Отзывчивость считает сервер: сообщения всех чатов на клиент не грузятся.
  useEffect(() => {
    if (!userId) return;
    dbUserStats(userId).then(setStats).catch(() => {});
  }, [userId]);

  // Real-time: refresh ratings list when a new rating is submitted for this user (web only)
  useEffect(() => {
    if (!userId) return;
    if (Platform.OS !== 'web') return;
    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null;
    try {
      const sb = getSupabaseClient();
      channel = sb
        .channel(`ratings:${userId}`)
        // Сигнал от сервера вместо подписки на таблицу: к таблицам доступ
        // закрыт, а канал трансляции их не касается.
        .on('broadcast', { event: 'refresh' }, () => {
          fetchRatings(userId);
        })
        .subscribe();
    } catch (e) {
      console.warn('[user-profile] realtime subscription failed:', e);
    }
    return () => {
      try { channel?.unsubscribe(); } catch {}
    };
  }, [userId]);

  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backText}>← Назад</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          {fetchingUser ? (
            <ActivityIndicator size="large" color="#6C63FF" />
          ) : userLoadFailed ? (
            <>
              <Text style={styles.errorText}>Не удалось загрузить профиль</Text>
              <Text style={styles.emptyReviewsSub}>Проверьте связь и попробуйте ещё раз.</Text>
              <TouchableOpacity
                onPress={() => setUserRetry(x => x + 1)}
                style={{ marginTop: rs(8), backgroundColor: Colors.primary, borderRadius: rs(100), paddingHorizontal: rs(22), paddingVertical: rs(11) }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Повторить</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.errorText}>Пользователь не найден</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const isWorker = user.role === 'worker';
  const color = nameColorFromString(user.id);
  const initials = getInitials(`${user.firstName} ${user.lastName}`);
  const line = METRO_LINES.find(l => l.id === user.metroLineId);

  /**
   * Телефон показываем только тому, кто уже договорился с этим человеком:
   * взаимный отклик на смену либо одобренная заявка на постоянную работу.
   * До этого момента номер — лишняя возможность обойти приложение, а после
   * него — необходимость: перед сменой созваниваются все.
   */
  const canCall = !!currentUser && currentUser.role === 'employer' && isWorker && (
    likes.some((l: any) => l.workerId === user.id && l.employerId === currentUser.id && l.isMatch)
    || permApplications.some((a: any) => a.workerId === user.id && a.employerId === currentUser.id
        && (a.status === 'approved' || a.status === 'hired'))
  );

  const callWorker = () => {
    const digits = (user.phone ?? '').replace(/\D/g, '');
    if (!digits) return;
    Linking.openURL(`tel:+${digits}`).catch(() =>
      showToast('Не удалось открыть звонок — номер скопируйте вручную', 'error'));
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Профиль</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Avatar card */}
        <View style={styles.topCard}>
          {user.avatarUrl ? (
            <Image
              source={{ uri: user.avatarUrl }}
              style={styles.avatar}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: color }]}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}

          <Text style={styles.name}>{user.firstName} {user.lastName}</Text>

          <View style={[styles.roleBadge, { backgroundColor: isWorker ? Colors.primaryLight : '#FEF3C7' }]}>
            <Text style={[styles.roleText, { color: isWorker ? Colors.primary : '#92400E' }]}>
              {isWorker ? '👤 Работник' : '🏢 Работодатель'}
            </Text>
          </View>

          <StarRow rating={user.avgRating ?? 0} count={user.ratingCount ?? 0} />

          {/* Поручительство — здесь же, у имени, а не в анкете ниже: это
              такой же ответ на вопрос «можно ли ему доверять», как звёзды, и
              спрятанное под вкладку оно на решение не влияет. */}
          {(user.referralWorked ?? 0) > 0 ? (
            <Text style={styles.vouchLine}>
              🤝 Привёл на смену: {user.referralWorked}
            </Text>
          ) : null}
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity style={styles.tabItem} onPress={() => setTab('info')} activeOpacity={0.8}>
            <Text style={[styles.tabLabel, tab === 'info' && styles.tabLabelActive]}>Профиль</Text>
            {tab === 'info' ? <View style={styles.tabLine} /> : null}
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={() => setTab('reviews')} activeOpacity={0.8}>
            <Text style={[styles.tabLabel, tab === 'reviews' && styles.tabLabelActive]}>
              Отзывы{ratings.length > 0 ? ` (${ratings.length})` : ''}
            </Text>
            {tab === 'reviews' ? <View style={styles.tabLine} /> : null}
          </TouchableOpacity>
        </View>

        {tab === 'info' ? (
          <>
            {/* Рейтинг — первым, до анкеты: за ним сюда и заходят, а не за
                станцией метро. У работодателя он свой: не отменяет ли смены,
                платит ли вовремя, совпадает ли работа с описанием. */}
            <View style={styles.scoreWrap}>
              <ScoreCard user={user} />
            </View>

            {/* Info block */}
            <View style={styles.infoCard}>
              <Text style={styles.sectionTitle}>Основная информация</Text>

              {isWorker ? (
                <>
                  {user.metroStation ? (
                    <InfoRow label="Метро" value={
                      <View style={styles.metroVal}>
                        {line ? <View style={[styles.lineDot, { backgroundColor: line.color }]} /> : null}
                        <Text style={styles.valText}>{user.metroStation}</Text>
                      </View>
                    } />
                  ) : null}
                  {user.age ? <InfoRow label="Возраст" value={<Text style={styles.valText}>{user.age} лет</Text>} /> : null}
                  <InfoRow label="Специализация" value={<Text style={styles.valText}>📦 Кладовщик</Text>} />
                  {/* Телефон — только после мэтча, и сразу звонком.
                      До сих пор номер жил единственной строкой в «Мэтчах»:
                      директор, зашедший в профиль, чтобы посмотреть человека
                      перед сменой, звонить оттуда не мог и уходил искать. */}
                  {canCall && user.phone ? (
                    <InfoRow label="Телефон" value={
                      <TouchableOpacity onPress={callWorker} activeOpacity={0.7}>
                        <Text style={styles.phoneLink}>{formatPhoneRu(user.phone)}</Text>
                      </TouchableOpacity>
                    } />
                  ) : null}
                </>
              ) : (
                <>
                  {user.company ? <InfoRow label="Компания" value={<Text style={styles.valText}>{user.company}</Text>} /> : null}
                </>
              )}
            </View>

            {/* Активность: был в сети и как отвечает.
                Пока переписок меньше двух, про отзывчивость молчим — по одному
                чату вывод делать нельзя, а выглядел бы он как приговор. */}
            {(() => {
              const seen = lastSeenLabel(user.lastSeenAt);
              const enough = stats?.enough === true ? stats : null;
              const speed = enough ? replySpeedLabel(enough.medianSeconds) : null;
              const rate = enough ? replyRateLabel(enough.answered, enough.chats) : null;
              if (!seen && !speed && !rate) return null;
              return (
                <View style={styles.infoCard}>
                  <Text style={styles.sectionTitle}>Активность</Text>
                  {seen ? (
                    <InfoRow label="В сети" value={<Text style={styles.valText}>{seen}</Text>} />
                  ) : null}
                  {rate ? (
                    <InfoRow label="Отвечает" value={<Text style={styles.valText}>{rate}</Text>} />
                  ) : null}
                  {speed ? (
                    <InfoRow label="Скорость" value={<Text style={styles.valText}>{speed}</Text>} />
                  ) : null}
                </View>
              );
            })()}

            {/* Bio */}
            {user.bio ? (
              <View style={styles.infoCard}>
                <Text style={styles.sectionTitle}>{isWorker ? 'О себе' : 'О компании'}</Text>
                <Text style={styles.bioText}>{user.bio}</Text>
              </View>
            ) : (
              <View style={[styles.infoCard, styles.emptyBio]}>
                <Text style={styles.emptyBioText}>
                  {isWorker ? '📝 Работник пока не добавил информацию о себе' : '📝 Компания пока не добавила описание'}
                </Text>
              </View>
            )}
          </>
        ) : (
          /* Reviews tab */
          loadingRatings ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : ratingsLoadFailed && ratings.length === 0 ? (
            <View style={styles.emptyReviews}>
              <Text style={styles.emptyReviewsTitle}>Не удалось загрузить отзывы</Text>
              <Text style={styles.emptyReviewsSub}>Проверьте связь — уже загруженные отзывы не удаляются.</Text>
              <TouchableOpacity onPress={() => fetchRatings(userId)} activeOpacity={0.8}>
                <Text style={{ color: Colors.primary, fontWeight: '700', marginTop: rs(6) }}>Повторить</Text>
              </TouchableOpacity>
            </View>
          ) : ratings.length === 0 ? (
            <View style={styles.emptyReviews}>
              <Text style={{ fontSize: rf(40) }}>📭</Text>
              <Text style={styles.emptyReviewsTitle}>Пока нет отзывов</Text>
              <Text style={styles.emptyReviewsSub}>Отзывы появятся после завершения смен</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {ratings.map(r => <RatingCard key={r.id} r={r} />)}
            </View>
          )
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Номер в человеческом виде: +7 916 587-08-77. В базе он лежит цифрами,
 * и читать его строкой из одиннадцати знаков, чтобы сверить с записью в
 * телефоне, — занятие на пустом месте.
 */
function formatPhoneRu(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length !== 11) return raw;
  return `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.infoRow}>
      {/* Подпись не сжимаем, значение переносим внутри своей колонки: без
          этого длинная строка наползала на подпись — «отвечает примерно в 7
          случаях из 10» ложилось прямо поверх слова «Отвечает». */}
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={styles.infoValue}>{value}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingVertical: rs(12),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  backText: { fontSize: rf(15), color: Colors.textSecondary, fontWeight: '500', width: rs(70) },
  headerTitle: { fontSize: rf(16), fontWeight: '700', color: Colors.textPrimary },
  scroll: { padding: rs(16), gap: rs(12) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: rs(40) },
  errorText: { fontSize: rf(16), color: Colors.textMuted },
  topCard: {
    backgroundColor: Colors.bg, borderRadius: Radius.xl, padding: rs(24),
    alignItems: 'center', gap: rs(8), ...Shadow.card,
  },
  avatar: { width: rs(96), height: rs(96), borderRadius: rs(48) },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: '#fff', fontSize: rf(34), fontWeight: '800' },
  name: { fontSize: rf(22), fontWeight: '800', color: Colors.textPrimary, textAlign: 'center', marginTop: rs(4) },
  roleBadge: { borderRadius: rs(100), paddingHorizontal: rs(16), paddingVertical: rs(5) },
  roleText: { fontSize: rf(13), fontWeight: '600' },
  vouchLine: { fontSize: rf(13), color: Colors.green, fontWeight: '600', marginTop: rs(6) },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: rs(3), marginTop: rs(4) },
  star: { fontSize: rf(20) },
  starOn: { color: '#FBBF24' },
  starOff: { color: '#E5E7EB' },
  ratingText: { fontSize: rf(13), color: Colors.textMuted, marginLeft: rs(6) },
  // Tabs
  tabs: {
    flexDirection: 'row', backgroundColor: Colors.bg, borderRadius: Radius.lg,
    ...Shadow.card, overflow: 'hidden',
  },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: rs(12) },
  tabLabel: { fontSize: rf(14), fontWeight: '500', color: Colors.textMuted },
  tabLabelActive: { fontWeight: '700', color: Colors.textPrimary },
  tabLine: { position: 'absolute', bottom: 0, left: '15%', right: '15%', height: 2, backgroundColor: Colors.primary, borderRadius: rs(1) },
  scoreWrap: { marginBottom: rs(12) },
  infoCard: {
    backgroundColor: Colors.bg, borderRadius: Radius.lg, padding: rs(16),
    gap: rs(10), ...Shadow.card,
  },
  sectionTitle: { fontSize: rf(13), fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: rs(2) },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: rs(12), paddingVertical: rs(8), borderTopWidth: 1, borderTopColor: Colors.divider },
  infoLabel: { fontSize: rf(14), color: Colors.textMuted, flexShrink: 0 },
  infoValue: { flex: 1, alignItems: 'flex-end' },
  phoneLink: {
    fontSize: rf(15), fontWeight: '700', color: Colors.primary,
    textDecorationLine: 'underline',
  },
  valText: { fontSize: rf(14), fontWeight: '600', color: Colors.textPrimary, textAlign: 'right' },
  metroVal: { flexDirection: 'row', alignItems: 'center', gap: rs(6) },
  lineDot: { width: rs(10), height: rs(10), borderRadius: rs(5) },
  bioText: { fontSize: rf(15), color: Colors.textPrimary, lineHeight: rf(22) },
  emptyBio: { backgroundColor: Colors.surface },
  emptyBioText: { fontSize: rf(14), color: Colors.textMuted, textAlign: 'center', lineHeight: rf(20), paddingVertical: rs(8) },
  // Reviews
  reviewCard: {
    backgroundColor: Colors.bg, borderRadius: Radius.lg, padding: rs(14),
    gap: rs(8), ...Shadow.card,
  },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: rs(8) },
  reviewRole: { fontSize: rf(12), color: Colors.textMuted, fontWeight: '500', flex: 1 },
  reviewDate: { fontSize: rf(12), color: Colors.textMuted },
  reviewText: { fontSize: rf(14), color: Colors.textPrimary, lineHeight: rf(20) },
  reviewEmpty: { fontSize: rf(13), color: Colors.textMuted, fontStyle: 'italic' },
  emptyReviews: { alignItems: 'center', paddingVertical: rs(48), gap: rs(8) },
  emptyReviewsTitle: { fontSize: rf(17), fontWeight: '700', color: Colors.textPrimary },
  emptyReviewsSub: { fontSize: rf(14), color: Colors.textMuted, textAlign: 'center' },
});

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.backText} />
      </View>
      <View style={[styles.center, { padding: 24 }]}>
        <Text style={{ fontSize: rf(40), marginBottom: 12 }}>😕</Text>
        <Text style={{ fontSize: rf(16), fontWeight: '700', color: Colors.textPrimary, textAlign: 'center', marginBottom: 8 }}>
          Не удалось загрузить профиль
        </Text>
        <Text style={{ fontSize: rf(13), color: Colors.textMuted, textAlign: 'center', marginBottom: 24 }}>
          {error.message}
        </Text>
        <TouchableOpacity
          onPress={retry}
          style={{ backgroundColor: Colors.primary, borderRadius: 100, paddingHorizontal: 24, paddingVertical: 12 }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: rf(15) }}>Попробовать снова</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
