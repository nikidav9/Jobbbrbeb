import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { replySpeedLabel } from '@/services/presence';
import type { Responsiveness } from '@/services/db';
import { rs, rf } from '@/constants/scale';

/**
 * «Отвечает в 8 из 10 переписок · около часа» — подпись на карточке вакансии.
 *
 * Зачем на карточке, а не только в профиле: директор не отвечает в 45% чатов,
 * а узнаёт об этом человек через двое суток, когда отклик закроется сам. В
 * профиль перед откликом заходят единицы, поэтому предупреждать надо там, где
 * принимается решение.
 *
 * Ничего не рисуем, если данных мало: по одной переписке вывод делать нельзя,
 * а выглядел бы он как приговор.
 */

type Props = { stats?: Responsiveness | null };

/**
 * Будет ли плашка нарисована. Нужно тому, кто её оборачивает: обёртка с
 * отступами вокруг пустоты оставляет в карточке дыру, а у нового работодателя
 * переписок нет вовсе — то есть дыра у большинства свежих вакансий.
 *
 * Отдельной функцией, а не повторённым `chats < 2` на стороне вызова: порог
 * должен меняться в одном месте, иначе однажды он разъедется с отрисовкой.
 *
 * Предикат типа, а не просто boolean: иначе внутри самой плашки после проверки
 * пришлось бы ещё раз убеждаться, что stats не пустой.
 */
export function hasReplyBadge(stats?: Responsiveness | null): stats is Responsiveness {
  return !!stats && stats.chats >= 2;
}

export function ReplyBadge({ stats }: Props) {
  if (!hasReplyBadge(stats)) return null;

  const { chats, answered } = stats;
  const speed = replySpeedLabel(stats.medianSeconds);

  // Три состояния, потому что «2 из 10» и «9 из 10» — это разные советы
  // человеку, а не разные оттенки одного.
  const tone = answered === 0 ? 'bad' : answered * 2 >= chats ? 'good' : 'meh';
  const text =
    answered === 0
      ? `Не отвечал в ${chats} последних переписках`
      : `Отвечает в ${answered} из ${chats}` + (speed ? ` · ${speed}` : '');

  const style = tone === 'good' ? st.good : tone === 'meh' ? st.meh : st.bad;
  const color = tone === 'good' ? '#15803D' : tone === 'meh' ? '#B45309' : '#B91C1C';
  const icon = tone === 'good' ? 'chatbubble-ellipses-outline' : tone === 'meh' ? 'time-outline' : 'alert-circle-outline';

  return (
    <View style={[st.box, style]}>
      <Ionicons name={icon} size={rs(13)} color={color} />
      <Text style={[st.txt, { color }]} numberOfLines={2}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(8),
    borderRadius: rs(13), borderWidth: 1,
    paddingHorizontal: rs(13), paddingVertical: rs(8),
    alignSelf: 'stretch', maxWidth: '100%',
  },
  txt: {
    fontSize: rf(12), lineHeight: rf(16), fontWeight: '600', flexShrink: 1,
    textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false,
  },
  good: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  meh: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },
  bad: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
});
