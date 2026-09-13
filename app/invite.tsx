import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Share, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Colors, Radius } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { dbGetMyReferral, MyReferral } from '@/services/db';
import { rs, rf } from '@/constants/scale';

/**
 * Пригласить друга.
 *
 * Склад — среда с плотными связями: люди зовут знакомых на смены и без нас.
 * Экран не создаёт это поведение, а делает его видимым и вознаграждаемым.
 *
 * Два решения, которые здесь стоит заметить.
 *
 * Первое: вознаграждение начисляется, когда друг ВЫХОДИТ НА ПЕРВУЮ СМЕНУ, а не
 * когда регистрируется. Это прямой урок Jobr из разбора конкурентов — там
 * платили за каждый отклик, к партнёрам полетели пустые заявки, и партнёры
 * отключились. Поэтому на экране два числа, а не одно: «позвал» и «вышли». Вид
 * разрыва между ними честнее, чем одно бодрое число.
 *
 * Второе: суммы может не быть. Её назначает владелец, и до тех пор экран
 * просто не называет её — вместо того чтобы обещать неизвестное. Позвать
 * знакомого на нормальную смену человек может и без обещания денег, а обещание
 * без числа читается как обман.
 */
export default function InviteScreen() {
  const router = useRouter();
  const { currentUser, showToast } = useApp();

  const [data, setData] = useState<MyReferral | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!currentUser?.id) return;
    setLoading(true);
    setFailed(false);
    try {
      setData(await dbGetMyReferral(currentUser.id));
    } catch {
      // Молча пустой экран хуже ошибки: человек решит, что программы нет.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => { void load(); }, [load]);

  const link = data ? `https://t.me/JobToo_bot/app?startapp=ref_${data.code}` : '';

  const share = async () => {
    if (!link) return;
    const message = [
      'Подработка и работа в Москве — смены рядом с домом.',
      'Регистрируйся по моей ссылке:',
      link,
    ].join('\n');
    try {
      // На iOS ссылка идёт отдельным полем, иначе она уезжает в текст и часть
      // приложений её не распознаёт как ссылку.
      await Share.share(
        Platform.OS === 'ios'
          ? { message: message.replace(`\n${link}`, ''), url: link }
          : { message },
      );
    } catch {
      // Отмена системного окна «Поделиться» — не ошибка.
    }
  };

  const copy = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    showToast('Ссылка скопирована', 'success');
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.back}>← Назад</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Пригласить друга</Text>
        <View style={{ width: rs(70) }} />
      </View>

      <ScrollView contentContainerStyle={s.body}>
        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: rs(40) }} />
        ) : failed || !data ? (
          <View style={s.card}>
            <Text style={s.failTitle}>Не получилось загрузить</Text>
            <Text style={s.failText}>Проверьте связь и попробуйте ещё раз.</Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => void load()} activeOpacity={0.85}>
              <Text style={s.primaryBtnTxt}>Повторить</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={s.card}>
              <Text style={s.lead}>
                Позовите знакомого, которому нужна работа. Когда он выйдет на
                первую смену, {data.rewardRub ? 'мы начислим вам' : 'вам начислится'}
                {data.rewardRub ? ` ${data.rewardRub.toLocaleString('ru-RU')} ₽` : ' вознаграждение'}.
              </Text>

              <Text style={s.codeLabel}>Ваш код</Text>
              <Text style={s.code} selectable>{data.code}</Text>

              <TouchableOpacity style={s.primaryBtn} onPress={() => void share()} activeOpacity={0.85}>
                <Ionicons name="share-outline" size={rf(17)} color="#fff" />
                <Text style={s.primaryBtnTxt}>Поделиться ссылкой</Text>
              </TouchableOpacity>

              <TouchableOpacity style={s.secondaryBtn} onPress={() => void copy()} activeOpacity={0.7}>
                <Ionicons name="copy-outline" size={rf(16)} color={Colors.textSecondary} />
                <Text style={s.secondaryBtnTxt}>Скопировать ссылку</Text>
              </TouchableOpacity>
            </View>

            {/* Два числа, а не одно: разрыв между ними и есть смысл правила
                «платим за выход». Одно бодрое число скрывало бы его. */}
            <View style={s.stats}>
              <View style={s.stat}>
                <Text style={s.statNum}>{data.invited}</Text>
                <Text style={s.statLabel}>зарегистрировались</Text>
              </View>
              <View style={s.statDivider} />
              <View style={s.stat}>
                <Text style={[s.statNum, { color: Colors.green }]}>{data.rewarded}</Text>
                <Text style={s.statLabel}>вышли на смену</Text>
              </View>
            </View>

            <View style={s.note}>
              <Ionicons name="information-circle-outline" size={rf(16)} color={Colors.textMuted} />
              <Text style={s.noteTxt}>
                Вознаграждение — за выход на смену, а не за регистрацию. Так
                работодатели получают тех, кто действительно приходит.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.outerBg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingVertical: rs(12),
    borderBottomWidth: 1, borderBottomColor: Colors.divider, backgroundColor: Colors.bg,
  },
  back: { fontSize: rf(15), color: Colors.primary, fontWeight: '600', width: rs(70) },
  headerTitle: { fontSize: rf(17), fontWeight: '700', color: Colors.textPrimary },

  body: { padding: rs(16), gap: rs(12) },

  card: {
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    padding: rs(16), gap: rs(10),
  },
  lead: { fontSize: rf(15), lineHeight: rf(21), color: Colors.textPrimary },

  codeLabel: { fontSize: rf(12), color: Colors.textMuted, marginTop: rs(6) },
  code: {
    fontSize: rf(26), fontWeight: '800', letterSpacing: rs(3),
    color: Colors.primary, marginBottom: rs(4),
  },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(8),
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: rs(13),
  },
  primaryBtnTxt: { color: '#fff', fontSize: rf(15), fontWeight: '700' },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(8),
    paddingVertical: rs(11),
  },
  secondaryBtnTxt: { color: Colors.textSecondary, fontSize: rf(14), fontWeight: '600' },

  stats: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: Radius.lg, paddingVertical: rs(16),
  },
  stat: { flex: 1, alignItems: 'center', gap: rs(2) },
  statNum: { fontSize: rf(24), fontWeight: '800', color: Colors.textPrimary },
  statLabel: { fontSize: rf(12), color: Colors.textSecondary },
  statDivider: { width: 1, height: rs(34), backgroundColor: Colors.divider },

  note: { flexDirection: 'row', gap: rs(8), paddingHorizontal: rs(4) },
  noteTxt: { flex: 1, fontSize: rf(12), lineHeight: rf(17), color: Colors.textMuted },

  failTitle: { fontSize: rf(15), fontWeight: '700', color: Colors.textPrimary },
  failText: { fontSize: rf(13), color: Colors.textSecondary },
});
