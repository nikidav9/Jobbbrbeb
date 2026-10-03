/**
 * Компаниям — вместо регистрации работодателя (решение владельца 03.10.2026).
 * Работодательских аккаунтов в приложении больше нет: компания пишет в
 * поддержку, мы связываемся и сами подключаем её вакансии к ленте. Маршрут
 * оставлен — на него ведут старые ссылки с сайта и из приложения. Сервер
 * регистрацию с ролью employer отклоняет (dbUpsertUser).
 */
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, ScrollView, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/ui/BackButton';
import { JTButton, jtBackStyle } from '@/components/ui/jt';
import { JT, JT_FONT } from '@/constants/jt';
import { rs, rf } from '@/constants/scale';

const BUSINESS_EMAIL = 'support@jobtoo.ru';
const BUSINESS_SUBJECT = 'Бизнес: добавление вакансий в ленту';
const BUSINESS_BODY = [
  'Здравствуйте!',
  '',
  'Хотим добавить вакансии нашей компании в ленту JobToo.',
  '',
  'Компания:',
  'Сайт с вакансиями:',
  'Контактное лицо и телефон:',
].join('\n');

function businessMailto(): string {
  return `mailto:${BUSINESS_EMAIL}?subject=${encodeURIComponent(BUSINESS_SUBJECT)}&body=${encodeURIComponent(BUSINESS_BODY)}`;
}

const POINTS: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }[] = [
  { icon: 'mail-outline', text: 'Напишите нам — письмо уже готово, осталось заполнить три строки' },
  { icon: 'link-outline', text: 'Мы свяжемся и подключим ваш карьерный сайт к ленте' },
  { icon: 'people-outline', text: 'Кандидаты из ленты откликаются на вакансии прямо у вас на сайте' },
];

export default function ForBusiness() {
  const router = useRouter();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView style={st.safe}>
      <View style={st.header}>
        <BackButton onPress={back} style={jtBackStyle} />
      </View>
      <ScrollView contentContainerStyle={st.body}>
        <Text style={st.kicker}>Компаниям</Text>
        <Text style={st.title}>Ищете сотрудников?</Text>
        <Text style={st.subtitle}>
          Подключим ваши вакансии к ленте JobToo. Регистрироваться не нужно — достаточно письма.
        </Text>
        <View style={st.points}>
          {POINTS.map(p => (
            <View key={p.icon} style={st.point}>
              <View style={st.pointIcon}><Ionicons name={p.icon} size={rs(18)} color={JT.ink} /></View>
              <Text style={st.pointText}>{p.text}</Text>
            </View>
          ))}
        </View>
        <JTButton label="Написать нам" onPress={() => { void Linking.openURL(businessMailto()); }} testID="business-mail" />
        <Text style={st.email} selectable>{BUSINESS_EMAIL}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: JT.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: rs(24), paddingTop: rs(12), height: rs(56) },
  body: { paddingHorizontal: rs(24), paddingTop: rs(26), paddingBottom: rs(28), gap: rs(16), maxWidth: 560, width: '100%', alignSelf: 'center' },
  kicker: { fontFamily: JT_FONT.heavy, fontSize: rf(13), letterSpacing: 0.6, textTransform: 'uppercase', color: JT.textSecondary },
  title: { fontFamily: JT_FONT.head, fontSize: rf(27), lineHeight: rf(31), letterSpacing: -0.3, color: JT.ink, marginTop: rs(-8) },
  subtitle: { fontFamily: JT_FONT.medium, fontSize: rf(16), color: JT.textSecondary, lineHeight: rf(23) },
  points: { gap: rs(12), marginVertical: rs(8) },
  point: { flexDirection: 'row', alignItems: 'center', gap: rs(12) },
  pointIcon: {
    width: rs(36), height: rs(36), borderRadius: rs(12), borderWidth: 2, borderColor: JT.ink,
    backgroundColor: JT.surface, alignItems: 'center', justifyContent: 'center',
  },
  pointText: { flex: 1, fontFamily: JT_FONT.semi, fontSize: rf(15), lineHeight: rf(21), color: JT.ink },
  email: { fontFamily: JT_FONT.bold, fontSize: rf(15), color: JT.ink, textAlign: 'center' },
});
