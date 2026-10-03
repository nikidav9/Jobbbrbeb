import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';

import { JT, JT_FONT } from '@/constants/jt';
type Contact =
  /** Партнёрская вакансия: показываем домен источника, ведём на саму вакансию. */
  | { kind: 'source'; domain: string; onOpen: () => void }
  /**
   * Своя вакансия: внешней ссылки нет, связь идёт через чат.
   *
   * actionLabel разный не для красоты. У смены чат открывается сразу, а у
   * постоянной вакансии — только после того, как работодатель одобрил отклик.
   * Написать «Написать в чате» там, где чата ещё нет, значит обмануть.
   */
  | { kind: 'chat'; company: string; actionLabel?: string; onOpen: () => void };

interface Props {
  contact: Contact;
  /** Гость: контакты скрыты до входа. */
  locked: boolean;
  onLogin: () => void;
}

/**
 * Раздел «Контакты» на экране вакансии.
 *
 * Две вещи, которые здесь важнее вёрстки.
 *
 * Первая: до входа контактов не видно. Это не приём ради регистраций, а
 * граница — открытая лента показывает, что за работа есть, но не отдаёт
 * способ связи тем, кого мы не знаем.
 *
 * Вторая: у партнёрской вакансии показывается только домен, а не весь адрес.
 * Полный адрес у источников — это сотня символов с идентификаторами и метками
 * перехода; источник в нём не прочитать. Человеку нужно понимать, куда он
 * попадёт, а не видеть строку целиком.
 *
 * Телефона работодателя здесь нет и быть не должно: у нас телефон — это его
 * логин и его персональные данные. Показывать их каждому вошедшему работнику
 * без отдельного согласия нельзя, поэтому у своих вакансий контакт — переход
 * в чат.
 */
export function VacancyContacts({ contact, locked, onLogin }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.head}>Контакты</Text>

      {locked ? (
        <>
          {/* Заглушка вместо контактов: видно, что здесь что-то есть, но не
              видно что. Полосками, а не размытием, — размытый текст на части
              устройств остаётся читаемым, и это была бы не защита, а её вид. */}
          <View style={styles.skeletonRow}>
            <View style={[styles.skeleton, { width: rs(22) }]} />
            <View style={[styles.skeleton, { flex: 1, maxWidth: rs(150) }]} />
          </View>
          <Text style={styles.lockedNote}>Войдите, чтобы увидеть контакты и откликнуться</Text>
          <TouchableOpacity style={styles.loginBtn} activeOpacity={0.8} onPress={onLogin}>
            <Text style={styles.loginTxt}>Войти</Text>
          </TouchableOpacity>
        </>
      ) : contact.kind === 'source' ? (
        <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={contact.onOpen}>
          <Ionicons name="globe-outline" size={18} color={Colors.primary} />
          <Text style={styles.link}>{contact.domain || 'Сайт источника'}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={contact.onOpen}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.company} numberOfLines={1}>{contact.company}</Text>
            <Text style={styles.link}>{contact.actionLabel ?? 'Написать в чате'}</Text>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: rs(8) },
  head: { fontSize: rf(17), fontFamily: JT_FONT.heavy, color: Colors.textPrimary },
  row: { flexDirection: 'row', alignItems: 'center', gap: rs(10) },
  link: { fontSize: rf(15), fontFamily: JT_FONT.semi, color: Colors.primary },
  company: { fontSize: rf(14), fontFamily: JT_FONT.bold, color: Colors.textPrimary },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: rs(10) },
  skeleton: { height: rs(16), borderRadius: rs(8), backgroundColor: Colors.divider },
  lockedNote: { fontFamily: JT_FONT.medium, fontSize: rf(13.5), color: JT.textSecondary },
  loginBtn: {
    alignSelf: 'flex-start', paddingHorizontal: rs(20), paddingVertical: rs(9),
    borderRadius: rs(20), borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.accent,
  },
  loginTxt: { fontSize: rf(14), fontFamily: JT_FONT.bold, color: JT.ink },
});
