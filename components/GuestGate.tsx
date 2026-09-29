import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { useWarmSystemBar } from '@/hooks/useWarmSystemBar';
import { JT, JT_FONT } from '@/constants/jt';
import { HardShadowBox } from '@/components/profile/edit/HardShadowBox';
import { rs, rf } from '@/constants/scale';

/**
 * Заглушка для гостевого режима: этот раздел доступен только после регистрации.
 * Показывается вместо откликов/чатов/профиля, пока человек смотрит как гость —
 * там нечего показать без аккаунта, а профиль ещё и писал бы в базу.
 *
 * Стиль — как у остальных экранов JT (28.09.2026): кремовый фон, белая
 * карточка-наклейка с жёсткой тенью, Unbounded в заголовке, оранжевая кнопка
 * с контуром и тенью.
 */
export default function GuestGate({ title, subtitle }: { title: string; subtitle: string }) {
  const router = useRouter();
  const { exitGuest } = useApp();
  useWarmSystemBar();
  const go = () => { exitGuest(); router.replace('/'); };
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.wrap}>
        <HardShadowBox offset={6} radius={rs(28)} style={s.cardBox}>
          <View style={s.card}>
            <View style={s.iconCircle}>
              <Ionicons name="lock-closed" size={rs(28)} color={JT.ink} />
            </View>
            <Text style={s.title}>{title}</Text>
            <Text style={s.sub}>{subtitle}</Text>
            <HardShadowBox offset={4} radius={rs(29)} style={s.btnBox}>
              <TouchableOpacity style={s.btn} activeOpacity={0.85} onPress={go} accessibilityRole="button">
                <Text style={s.btnTxt}>Зарегистрироваться</Text>
              </TouchableOpacity>
            </HardShadowBox>
            <Text style={s.note}>Регистрация бесплатная</Text>
          </View>
        </HardShadowBox>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: JT.background },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: rs(20), paddingBottom: rs(90) },
  cardBox: { width: '100%', maxWidth: 420 },
  card: {
    backgroundColor: JT.surface, borderWidth: 2, borderColor: JT.ink, borderRadius: rs(28),
    paddingHorizontal: rs(24), paddingTop: rs(28), paddingBottom: rs(22), alignItems: 'center',
  },
  iconCircle: {
    width: rs(76), height: rs(76), borderRadius: rs(38),
    backgroundColor: JT.accentSoft, borderWidth: 2, borderColor: JT.ink,
    alignItems: 'center', justifyContent: 'center', marginBottom: rs(18),
  },
  title: {
    fontFamily: JT_FONT.head, fontSize: rf(20), lineHeight: rf(25), color: JT.ink,
    textAlign: 'center', letterSpacing: -0.2,
  },
  sub: {
    marginTop: rs(10), fontFamily: JT_FONT.medium, fontSize: rf(15), lineHeight: rf(22),
    color: JT.textSecondary, textAlign: 'center',
  },
  btnBox: { alignSelf: 'stretch', marginTop: rs(22) },
  btn: {
    height: rs(58), borderRadius: rs(29), backgroundColor: JT.accent,
    borderWidth: 2, borderColor: JT.ink, alignItems: 'center', justifyContent: 'center',
  },
  // Текст на оранжевом — чёрный (README макетов: белый плохо читается).
  btnTxt: { fontFamily: JT_FONT.bold, fontSize: rf(18), color: JT.ink },
  note: { marginTop: rs(14), fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT.textTertiary, textAlign: 'center' },
});
