import { Image, StyleSheet, View } from 'react-native';

import { rs } from '@/constants/scale';

// Логотип в шапке вкладок «Вакансии», «Отклики» и «Профиль». Один на всех,
// чтобы при переключении вкладок верх не прыгал (просьба владельца 01.10.2026):
// раньше у ленты стоял 47×30 с полем 20, а у двух других — 40×26 с полем 16
// и на 4 pt ниже. Эталон — лента.
export function TabLogo() {
  return (
    <View style={TAB_TOP.logoWrap} accessibilityLabel="JobToo">
      {/* assets/images/jt-logo-wide.png — логотип макета, 600×387. */}
      <Image source={require('@/assets/images/jt-logo-wide.png')} style={TAB_TOP.logo} resizeMode="contain" />
    </View>
  );
}

// row — ряд шапки: поля и верхний отступ общие для трёх вкладок; высоту
// ряда задаёт logoWrap: 44 — как поиск ленты, но не ниже 40 — круглых кнопок
// «Откликов» и «Профиля», которые не масштабируются. Иначе на узком экране
// (320: rs(44) = 38) кнопки раздвигали бы ряд и логотип съезжал бы на 1 pt.
export const TAB_TOP = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: rs(20), paddingTop: rs(10) },
  logoWrap: { height: Math.max(rs(44), 40), justifyContent: 'center', flexShrink: 0 },
  logo: { width: rs(47), height: rs(30) },
});
