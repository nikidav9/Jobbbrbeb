// Неизвестный адрес. Раньше здесь стояла заготовка шаблона — по-английски,
// с фотоаппаратом и в чужих цветах (аудит 01.10.2026).

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { JT, JT_FONT } from '@/constants/jt';
import { JTButton } from '@/components/ui/jt';
import { rs, rf } from '@/constants/scale';

export default function NotFoundScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.badge}>
          <Ionicons name="compass-outline" size={36} color={JT.ink} />
        </View>
        <Text style={styles.title} accessibilityRole="header">Такой страницы нет</Text>
        <Text style={styles.message}>
          Возможно, ссылка устарела или вакансию уже закрыли.
        </Text>
        <JTButton label="К вакансиям" onPress={() => router.replace('/')} style={styles.button} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: JT.background },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: rs(24) },
  badge: {
    width: rs(72), height: rs(72), borderRadius: rs(36), borderWidth: 2, borderColor: JT.ink,
    backgroundColor: JT.surface, alignItems: 'center', justifyContent: 'center',
  },
  title: {
    marginTop: rs(20), fontFamily: JT_FONT.head, fontSize: rf(22), lineHeight: rf(28),
    color: JT.ink, textAlign: 'center',
  },
  message: {
    marginTop: rs(10), fontFamily: JT_FONT.medium, fontSize: rf(15), lineHeight: rf(21),
    color: JT.textSecondary, textAlign: 'center', maxWidth: 320,
  },
  button: { marginTop: rs(28), alignSelf: 'stretch', maxWidth: 360, width: '100%' },
});
