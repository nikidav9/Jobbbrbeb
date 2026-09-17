import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';
import { useApp } from '@/hooks/useApp';
import { PermVacancy } from '@/constants/types';
import { getInitials, nameColorFromString } from '@/services/storage';
import { plural } from '@/services/time';
import { dbGetPermSavedDetailed, dbRemovePermSaved } from '@/services/db';
import { dayKey, dayShort, groupByDay } from '@/services/dayGroups';

/**
 * Избранные вакансии.
 *
 * Отдельным экраном, а не разделом внутри «Откликов»: избранное — это свой
 * список со своей историей, и открывается он с кнопкой «назад», как на макете.
 *
 * Группировка по дню СОХРАНЕНИЯ, а не публикации. Ради этого пришлось завести
 * dbGetPermSavedDetailed: обычный dbGetPermSaved отдаёт голые id. Дата
 * публикации тут была бы враньём — человек помнит, когда он сохранял, а не
 * когда работодатель разместил.
 */
export default function SavedScreen() {
  const router = useRouter();
  const { currentUser, permVacancies, permSavedIds, optimisticRemovePermSaved, showToast } = useApp();
  const [dates, setDates] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const userId = currentUser?.id ?? '';

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const rows = await dbGetPermSavedDetailed(userId);
      const map: Record<string, string | null> = {};
      for (const r of rows) map[r.vacancyId] = r.savedAt;
      setDates(map);
      setLoadFailed(false);
    } catch {
      // Сбой загрузки дат — не пустое избранное. Список покажем и без
      // группировки, а плашку про связь поставим отдельно.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  const unsave = async (vacancyId: string) => {
    if (!userId) return;
    try {
      // Сервер подтверждает до правки UI: иначе обрыв связи выглядит как
      // удаление, и человек решит, что вакансия пропала.
      await dbRemovePermSaved(userId, vacancyId);
      optimisticRemovePermSaved(vacancyId);
      setDates(d => { const n = { ...d }; delete n[vacancyId]; return n; });
    } catch {
      showToast('Не удалось удалить из избранного', 'error');
    }
  };

  const saved: PermVacancy[] = permVacancies.filter((v: PermVacancy) => permSavedIds.includes(v.id));
  // Свежие сверху. У вакансии без даты (сохранена до того, как мы начали их
  // читать) ключ пустой — такие уходят в конец отдельной группой.
  const sorted = [...saved].sort((a, b) => (dates[b.id] ?? '').localeCompare(dates[a.id] ?? ''));

  const groups = groupByDay(sorted, v => dates[v.id]);

  const renderRow = (v: PermVacancy, last: boolean) => {
    const closed = v.status !== 'open';
    const at = dates[v.id];
    return (
      <View key={v.id} style={[sv.row, !last && sv.rowDivider]}>
        <TouchableOpacity
          style={sv.rowTap}
          activeOpacity={0.85}
          onPress={() => router.push({ pathname: '/perm-vacancy-detail', params: { vacancyId: v.id } })}
        >
          <View style={[sv.logo, { backgroundColor: nameColorFromString(v.company) }]}>
            <Text style={sv.logoTxt}>{getInitials(v.company)}</Text>
          </View>
          <View style={sv.rowBody}>
            <Text style={sv.rowTitle} numberOfLines={2}>{v.title}</Text>
            <Text style={sv.rowCompany} numberOfLines={1}>{v.company}</Text>
          </View>
          <View style={sv.rowRight}>
            <View style={[sv.pill, closed ? sv.pillClosed : sv.pillSaved]}>
              <Text style={[sv.pillTxt, closed ? sv.pillTxtClosed : sv.pillTxtSaved]}>
                {closed ? 'ЗАКРЫТА' : 'СОХРАНЕНО'}
              </Text>
            </View>
            {at ? <Text style={sv.rowDate}>{dayShort(dayKey(at))}</Text> : null}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={sv.unsave}
          onPress={() => unsave(v.id)}
          hitSlop={8}
          accessibilityLabel={`Удалить из избранного: ${v.title}`}
        >
          <Ionicons name="bookmark" size={20} color={Colors.primary} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={sv.safe} edges={['top', 'left', 'right']}>
      <View style={sv.header}>
        <TouchableOpacity
          style={sv.back}
          onPress={() => router.back()}
          activeOpacity={0.8}
          accessibilityLabel="Назад"
        >
          <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={sv.title}>Избранное</Text>
        {/* Пустая колонка той же ширины, что кнопка: иначе заголовок встаёт
            не по центру экрана, а по центру остатка. Именно колонка, а не
            копия кнопки — с её фоном и тенью это читалось как вторая, зачем-то
            пустая кнопка. */}
        <View style={sv.backSpacer} pointerEvents="none" />
      </View>

      <ScrollView
        contentContainerStyle={sv.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />
        }
      >
        {loadFailed ? (
          <View style={sv.offlineBar}>
            <Ionicons name="cloud-offline-outline" size={14} color="#92400E" />
            <Text style={sv.offlineTxt}>Даты сохранения не загрузились — дело в связи. Сам список на месте.</Text>
          </View>
        ) : null}

        {loading && saved.length === 0 ? (
          <View style={sv.empty}><ActivityIndicator color={Colors.primary} /></View>
        ) : saved.length === 0 ? (
          <View style={sv.empty}>
            <Ionicons name="bookmark-outline" size={56} color={Colors.textMuted} />
            <Text style={sv.emptyTitle}>В избранном пусто</Text>
            <Text style={sv.emptySub}>Нажмите закладку на карточке вакансии — она сохранится здесь</Text>
          </View>
        ) : groups.map(g => (
          <View key={g.key || 'earlier'}>
            <Text style={sv.dayHead}>
              {g.label} · {g.items.length} {plural(g.items.length, 'вакансия', 'вакансии', 'вакансий')}
            </Text>
            <View style={sv.group}>
              {g.items.map((v, i) => renderRow(v, i === g.items.length - 1))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const sv = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.outerBg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingTop: rs(6), paddingBottom: rs(12),
  },
  back: {
    width: rs(44), height: rs(44), borderRadius: rs(22),
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', ...Shadow.card,
  },
  backSpacer: { width: rs(44), height: rs(44) },
  title: { fontSize: rf(20), fontWeight: '800', color: Colors.textPrimary },

  list: { paddingHorizontal: rs(16), paddingBottom: rs(32) },
  dayHead: {
    fontSize: rf(12), fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 0.4, paddingTop: rs(14), paddingBottom: rs(8),
  },
  group: { backgroundColor: '#FFFFFF', borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.card },

  row: { flexDirection: 'row', alignItems: 'center' },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: Colors.divider },
  rowTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: rs(12), padding: rs(14), paddingRight: rs(4) },
  logo: {
    width: rs(44), height: rs(44), borderRadius: rs(12),
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  logoTxt: { color: '#FFFFFF', fontSize: rf(15), fontWeight: '800' },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: rf(15.5), fontWeight: '700', color: Colors.textPrimary, lineHeight: rf(20) },
  rowCompany: { fontSize: rf(13.5), color: Colors.textMuted, marginTop: rs(2) },
  rowRight: { alignItems: 'flex-end', gap: rs(4), flexShrink: 0 },
  pill: { borderRadius: rs(8), paddingHorizontal: rs(8), paddingVertical: rs(4) },
  pillSaved: { backgroundColor: '#EEF0F4' },
  pillClosed: { backgroundColor: '#FEE2E2' },
  pillTxt: { fontSize: rf(10), fontWeight: '800', letterSpacing: 0.3 },
  pillTxtSaved: { color: Colors.textSecondary },
  pillTxtClosed: { color: Colors.red },
  rowDate: { fontSize: rf(12), color: Colors.textMuted },
  unsave: { padding: rs(12), flexShrink: 0 },

  offlineBar: {
    flexDirection: 'row', alignItems: 'center', gap: rs(6), marginTop: rs(10),
    backgroundColor: '#FEF3C7', borderRadius: rs(12), paddingHorizontal: rs(12), paddingVertical: rs(8),
  },
  offlineTxt: { flex: 1, fontSize: rf(12), color: '#92400E', lineHeight: rf(16) },

  empty: { alignItems: 'center', paddingTop: rs(80), paddingHorizontal: rs(24), gap: rs(8) },
  emptyTitle: { fontSize: rf(18), fontWeight: '800', color: Colors.textPrimary, marginTop: rs(6) },
  emptySub: { fontSize: rf(14), color: Colors.textMuted, textAlign: 'center', lineHeight: rf(20) },
});
