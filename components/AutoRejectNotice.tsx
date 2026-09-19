import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Radius } from '@/constants/theme';

import { rs, rf } from '@/constants/scale';

/**
 * Памятка директору в формах создания смены/вакансии:
 * отклики без ответа закрываются автоматически через 2 дня.
 *
 * Почему двое суток, а не неделя, как было раньше: из 65 чатов, где директор
 * ответил, 49 ответов пришли в первый час, 56 — за сутки и лишь 9 позже.
 * То есть неделя ожидания ничего не добавляла к шансам, а человек всё это
 * время сидел без ответа и уходил.
 */
export function AutoRejectNotice() {
  return (
    <View style={st.box}>
      <Ionicons name="time-outline" size={18} color="#92400E" />
      <Text style={st.txt}>
        Отвечайте на отклики в течение <Text style={st.bold}>2 дней</Text> — потом заявка закрывается
        автоматически, и кандидат уходит к другим. Три четверти директоров отвечают в первый час:
        одобрить или отклонить — один тап в разделе «Отклики».
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'flex-start', gap: rs(8),
    backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA',
    borderRadius: Radius.lg, padding: rs(12), marginBottom: rs(14),
  },
  txt: { flex: 1, fontSize: rf(12), color: '#92400E', lineHeight: rf(17) },
  bold: { fontWeight: '800' },
});
