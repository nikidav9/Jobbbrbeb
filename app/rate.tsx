import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors, Radius } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { dbSubmitRatingAndMaybeDelete } from '@/services/db';

import { rs, rf } from '@/constants/scale';

export default function RateScreen() {
  const router = useRouter();
  const { likeId, toUserId, toName, vacancyId, role } = useLocalSearchParams<{
    likeId: string;
    toUserId: string;
    toName: string;
    vacancyId: string;
    role: 'worker' | 'employer';
  }>();
  const { currentUser, refreshAll, showToast } = useApp();
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [loading, setLoading] = useState(false);
  // Качество и скорость спрашиваем только у работодателя и только про
  // работника: они идут в его рейтинг. Обязательными не делаем — обязательный
  // вопрос люди не отвечают, а прокликивают, и в базу ложится ровный ряд
  // пятёрок, из которого ничего не посчитаешь.
  const [quality, setQuality] = useState(0);
  const [speed, setSpeed] = useState(0);
  // Про работодателя спрашиваем три из четырёх осей презентации. Четвёртая,
  // отмены смен, не спрашивается вовсе: она уже записана — с августа у
  // каждой несостоявшейся смены есть причина. Спрашивать о том, что лежит в
  // базе, значит получить ответ хуже и форму длиннее.
  const [matchedDesc, setMatchedDesc] = useState(0);
  const [attitude, setAttitude] = useState(0);
  const [paidOnTime, setPaidOnTime] = useState(0);
  const оцениваетРаботника = role === 'employer';

  const доп: [string, number, (n: number) => void][] = оцениваетРаботника
    ? [['Качество работы', quality, setQuality], ['Скорость', speed, setSpeed]]
    : [
        ['Работа совпала с описанием', matchedDesc, setMatchedDesc],
        ['Отношение к людям', attitude, setAttitude],
        ['Заплатили вовремя', paidOnTime, setPaidOnTime],
      ];

  const ratingLabel =
    rating === 0 ? 'Нажмите на звезду' :
    rating === 1 ? '😞 Очень плохо' :
    rating === 2 ? '😐 Плохо' :
    rating === 3 ? '😊 Нормально' :
    rating === 4 ? '😃 Хорошо' : '🤩 Отлично!';

  const submit = async () => {
    if (!rating || !currentUser) return;
    setLoading(true);
    try {
      const { bothRated } = await dbSubmitRatingAndMaybeDelete({
        likeId,
        fromUserId: currentUser.id,
        toUserId,
        vacancyId,
        rating,
        role,
        reviewText: review.trim() || undefined,
        quality: оцениваетРаботника && quality > 0 ? quality : undefined,
        speed: оцениваетРаботника && speed > 0 ? speed : undefined,
        matchedDesc: !оцениваетРаботника && matchedDesc > 0 ? matchedDesc : undefined,
        attitude: !оцениваетРаботника && attitude > 0 ? attitude : undefined,
        paidOnTime: !оцениваетРаботника && paidOnTime > 0 ? paidOnTime : undefined,
      });

      // Запись оценки уже подтверждена сервером. Обновление общего кэша —
      // только синхронизация экрана: его сетевой сбой не должен превращать
      // успешную запись в «Ошибка при сохранении» и провоцировать повторную
      // отправку той же оценки.
      try {
        await refreshAll();
      } catch {
        // Следующий обычный refresh подтянет уже сохранённое состояние.
      }

      if (bothRated) {
        showToast('Оценки выставлены. Мэтч завершён! 🏁', 'success');
      } else {
        showToast('Оценка сохранена! Спасибо 🌟', 'success');
      }
      router.replace('/(tabs)');
    } catch {
      showToast('Ошибка при сохранении', 'error');
    } finally {
      setLoading(false);
    }
  };

  const skip = () => router.replace('/(tabs)');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={skip}>
          <Text style={styles.skipTxt}>Пропустить</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Оценить</Text>
        <View style={{ width: 80 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.emoji}>⭐</Text>
          <Text style={styles.title}>Как прошла смена?</Text>
          <Text style={styles.sub}>
            Оцените {role === 'worker' ? 'работодателя' : 'работника'}:
          </Text>
          <Text style={styles.name}>{toName}</Text>

          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map(s => (
              <TouchableOpacity key={s} onPress={() => setRating(s)} activeOpacity={0.7}>
                <Text style={[styles.star, rating >= s && styles.starActive]}>★</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.ratingLabel}>{ratingLabel}</Text>

          {rating > 0 ? (
            <View style={styles.extraBlock}>
              <Text style={styles.extraTitle}>Подробнее — по желанию</Text>
              <Text style={styles.extraSub}>
                {оцениваетРаботника
                  ? 'Эти оценки идут в рейтинг работника: по ним его находят другие работодатели.'
                  : 'Эти оценки видят другие работники, когда решают, идти ли к этой компании.'}
              </Text>
              {доп.map(([label, value, set]) => (
                <View key={label} style={styles.extraRow}>
                  <Text style={styles.extraLabel}>{label}</Text>
                  <View style={styles.extraStars}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <TouchableOpacity
                        key={n}
                        onPress={() => set(value === n ? 0 : n)}
                        activeOpacity={0.7}
                        hitSlop={4}
                      >
                        <Text style={[styles.smallStar, value >= n && styles.starActive]}>★</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {rating > 0 ? (
            <View style={styles.reviewBlock}>
              <Text style={styles.reviewTitle}>Короткий отзыв (необязательно)</Text>
              <TextInput
                style={styles.reviewInput}
                value={review}
                onChangeText={setReview}
                placeholder="Напишите пару слов о смене..."
                placeholderTextColor={Colors.textMuted}
                multiline
                maxLength={300}
                textAlignVertical="top"
              />
            </View>
          ) : null}

          <Text style={styles.note}>
            После того как обе стороны выставят оценку, мэтч будет автоматически завершён.
          </Text>

          <TouchableOpacity
            style={[styles.submitBtn, (!rating || loading) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={!rating || loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitBtnTxt}>Отправить оценку</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingVertical: rs(14),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  skipTxt: { fontSize: rf(14), color: Colors.textMuted, fontWeight: '500', width: rs(80) },
  headerTitle: { fontSize: rf(16), fontWeight: '700', color: Colors.textPrimary },
  content: { alignItems: 'center', paddingHorizontal: rs(32), paddingVertical: rs(32), gap: rs(12), flexGrow: 1 },
  emoji: { fontSize: rf(56) },
  title: { fontSize: rf(24), fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  sub: { fontSize: rf(15), color: Colors.textMuted, textAlign: 'center' },
  name: { fontSize: rf(18), fontWeight: '700', color: Colors.primary, textAlign: 'center' },
  stars: { flexDirection: 'row', gap: rs(8), marginVertical: rs(12) },
  star: { fontSize: rf(44), color: Colors.divider },
  starActive: { color: '#FBBF24' },
  ratingLabel: { fontSize: rf(16), color: Colors.textSecondary, fontWeight: '500', height: rs(24) },
  extraBlock: {
    width: '100%', marginTop: rs(8), padding: rs(14),
    backgroundColor: Colors.surface, borderRadius: rs(12),
    borderWidth: 1, borderColor: Colors.inputBorder,
  },
  extraTitle: { fontSize: rf(14), fontWeight: '700', color: Colors.textPrimary },
  extraSub: { fontSize: rf(12.5), color: Colors.textMuted, marginTop: rs(2), lineHeight: rf(17) },
  extraRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: rs(12),
  },
  extraLabel: { fontSize: rf(14), color: Colors.textSecondary, fontWeight: '500' },
  extraStars: { flexDirection: 'row', gap: rs(4) },
  smallStar: { fontSize: rf(24), color: Colors.divider },
  reviewBlock: { width: '100%', gap: rs(8), marginTop: rs(8) },
  reviewTitle: { fontSize: rf(14), fontWeight: '600', color: Colors.textPrimary },
  reviewInput: {
    backgroundColor: Colors.surface, borderRadius: rs(12), padding: rs(14),
    fontSize: rf(14), color: Colors.textPrimary, minHeight: rs(80),
    borderWidth: 1, borderColor: Colors.inputBorder,
  },
  note: { fontSize: rf(13), color: Colors.textMuted, textAlign: 'center', lineHeight: rf(18), marginTop: rs(8) },
  submitBtn: {
    marginTop: rs(20), backgroundColor: Colors.primary, borderRadius: rs(100),
    paddingHorizontal: rs(40), paddingVertical: rs(16), width: '100%', alignItems: 'center',
  },
  submitBtnTxt: { color: '#fff', fontSize: rf(16), fontWeight: '700' },
});
