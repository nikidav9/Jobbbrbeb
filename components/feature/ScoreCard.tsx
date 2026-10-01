import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';
import { User } from '@/constants/types';

import { JT_FONT } from '@/constants/jt';
/**
 * JobToo Score — то, что в презентации нарисовано кружком с числом.
 *
 * Показываем не только итог, но и оси, из которых он сложился. Одно число
 * без расшифровки — это приговор без объяснения: работник не понимает, за
 * что ему 62, а работодатель не понимает, чему в этих 62 верить. Оси стоят
 * ровно столько же места и снимают оба вопроса.
 *
 * Ось, по которой данных нет, не рисуем вовсе. Заполнять пробел нулём или
 * серединой — значит сообщить о человеке то, чего мы не знаем.
 */

const цвет = (v: number) =>
  v >= 85 ? Colors.green : v >= 65 ? '#F59E0B' : Colors.red;

function Axis({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const pct = Math.round(value * 100);
  return (
    <View style={s.axis}>
      <View style={s.axisTop}>
        <Text style={s.axisLabel}>{label}</Text>
        <Text style={s.axisValue}>{pct}%</Text>
      </View>
      <View style={s.bar}>
        <View style={[s.barFill, { width: `${Math.max(2, pct)}%`, backgroundColor: цвет(pct) }]} />
      </View>
      {hint ? <Text style={s.axisHint}>{hint}</Text> : null}
    </View>
  );
}

/** Компактная плашка для списков: только число. */
export function ScoreBadge({ user }: { user: User | null | undefined }) {
  const n = user?.role === 'employer' ? user?.empScore : user?.score;
  const enoughReviews = (user?.ratingCount ?? 0) >= 3 && (user?.avgRating ?? 0) > 0;
  if (!user || (n == null && !enoughReviews)) return null;
  const value = n ?? Number((user.avgRating ?? 0).toFixed(1));
  const badgeColor = n == null ? '#F59E0B' : цвет(n);
  return (
    <View style={[s.badge, { borderColor: badgeColor }]}>
      <Ionicons name={n == null ? 'star' : 'shield-checkmark'} size={rf(11)} color={badgeColor} />
      <Text style={[s.badgeTxt, { color: badgeColor }]}>{value}</Text>
    </View>
  );
}

/** Склонение «смена/смены/смен». */
function смены(n: number): string {
  const d = n % 10, s = n % 100;
  if (d === 1 && s !== 11) return 'смена';
  if (d >= 2 && d <= 4 && (s < 12 || s > 14)) return 'смены';
  return 'смен';
}

export function ScoreCard({ user, own = false }: { user: User; own?: boolean }) {
  const работодатель = user.role === 'employer';
  const итог = работодатель ? user.empScore : user.score;
  const смен = (работодатель ? user.empScoreShifts : user.scoreShifts) ?? 0;
  const достаточноОценок = (user.ratingCount ?? 0) >= 3 && (user.avgRating ?? 0) > 0;

  // Меньше трёх смен — числа нет. Объясняем, почему, и сколько осталось:
  // «нет рейтинга» без объяснения читается как «плохой рейтинг».
  if (итог == null) {
    if (достаточноОценок) {
      return (
        <View style={s.card}>
          <View style={s.header}>
            <View style={[s.circle, { borderColor: '#F59E0B' }]}>
              <Text style={[s.circleNum, { color: '#F59E0B' }]}>
                {(user.avgRating ?? 0).toFixed(1)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Общий рейтинг</Text>
              <Text style={s.sub}>На основании {user.ratingCount} оценок</Text>
            </View>
          </View>
        </View>
      );
    }
    return (
      <View style={s.card}>
        <View style={s.header}>
          <View style={[s.circle, { borderColor: Colors.divider }]}>
            <Ionicons name="hourglass-outline" size={rf(20)} color={Colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Рейтинг ещё не считается</Text>
            <Text style={s.sub}>
              {работодатель
                ? 'Рейтинг компании появится после первых оценок работников.'
                : own
                ? 'Рейтинг появится после первых оценок работодателей.'
                : 'Оценок от работодателей пока нет.'}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={s.card}>
      <View style={s.header}>
        <View style={[s.circle, { borderColor: цвет(итог) }]}>
          <Text style={[s.circleNum, { color: цвет(итог) }]}>{итог}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{работодатель ? 'Рейтинг компании' : 'JobToo Score'}</Text>
          <Text style={s.sub}>
            {смен} {смены(смен)}
            {!работодатель && (user.scoreEmployers ?? 0) > 0
              ? ` · ${user.scoreEmployers} работодат.` : ''}
          </Text>
        </View>
      </View>

      <View style={s.axes}>
        {работодатель ? (
          <>
            {user.empScoreKept != null ? (
              <Axis label="Не отменяет смены" value={user.empScoreKept}
                hint="считается по самим сменам, а не по отзывам" />
            ) : null}
            {user.empScorePay != null ? (
              <Axis label="Платит вовремя" value={user.empScorePay} />
            ) : null}
            {user.empScoreDesc != null ? (
              <Axis label="Работа совпадает с описанием" value={user.empScoreDesc} />
            ) : null}
            {user.empScoreAttitude != null ? (
              <Axis label="Отношение к людям" value={user.empScoreAttitude} />
            ) : null}
            {(user.ratingCount ?? 0) > 0 ? (
              <Axis label="Общая оценка" value={(user.avgRating ?? 0) / 5}
                hint={`${(user.avgRating ?? 0).toFixed(1)} из 5 · отзывов: ${user.ratingCount}`} />
            ) : null}
          </>
        ) : (
          <>
            {user.scoreReliability != null ? (
              <Axis label="Выходит на смены" value={user.scoreReliability} />
            ) : null}
            {user.scorePunctuality != null ? (
              <Axis label="Приходит вовремя" value={user.scorePunctuality} />
            ) : null}
            {(user.ratingCount ?? 0) > 0 ? (
              <Axis label="Оценки работодателей" value={(user.avgRating ?? 0) / 5}
                hint={`${(user.avgRating ?? 0).toFixed(1)} из 5 · отзывов: ${user.ratingCount}`} />
            ) : null}
            {user.scoreQuality != null ? (
              <Axis label="Качество работы" value={user.scoreQuality} />
            ) : null}
            {user.scoreSpeed != null ? (
              <Axis label="Скорость" value={user.scoreSpeed} />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.card, borderRadius: rs(14), padding: rs(16),
    borderWidth: 1, borderColor: Colors.divider,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: rs(14) },
  circle: {
    width: rs(58), height: rs(58), borderRadius: rs(29),
    borderWidth: rs(3), alignItems: 'center', justifyContent: 'center',
  },
  circleNum: { fontSize: rf(21), fontFamily: JT_FONT.heavy },
  title: { fontSize: rf(16), fontFamily: JT_FONT.heavy, color: Colors.textPrimary },
  sub: { fontFamily: JT_FONT.medium, fontSize: rf(12.5), color: Colors.textMuted, marginTop: rs(3), lineHeight: rf(17) },

  axes: { marginTop: rs(16), gap: rs(12) },
  axis: {},
  axisTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  axisLabel: { fontSize: rf(13), color: Colors.textSecondary, fontFamily: JT_FONT.medium },
  axisValue: { fontSize: rf(13), color: Colors.textPrimary, fontFamily: JT_FONT.bold },
  bar: {
    height: rs(6), borderRadius: rs(3), backgroundColor: Colors.surface,
    marginTop: rs(5), overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: rs(3) },
  axisHint: { fontFamily: JT_FONT.medium, fontSize: rf(11.5), color: Colors.textMuted, marginTop: rs(3) },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: rs(3),
    paddingHorizontal: rs(7), paddingVertical: rs(2),
    borderRadius: rs(100), borderWidth: 1.5,
  },
  badgeTxt: { fontSize: rf(11.5), fontFamily: JT_FONT.heavy },
});
