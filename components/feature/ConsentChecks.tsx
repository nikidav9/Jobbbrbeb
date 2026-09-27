/**
 * Три галочки регистрации — общие у соискателя и работодателя (раньше были
 * двумя одинаковыми копиями в register-worker и register-employer).
 * Обязательные: условия с политиками и отдельное согласие 152-ФЗ; реклама
 * (38-ФЗ, ст. 18) — по желанию, снята по умолчанию, держит её экран.
 *
 * Вид — макет «JT-auth-and-details» 02-register-step1: белая карточка,
 * строки через тонкий разделитель, оранжевая галочка с чёрным контуром.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { JTCheck, JTLink } from '@/components/ui/jt';
import { JT, JT_FONT } from '@/constants/jt';
import { rs, rf } from '@/constants/scale';

type Props = {
  agreed: boolean; onAgreed: () => void;
  pdAgreed: boolean; onPdAgreed: () => void;
  adsAgreed: boolean; onAdsAgreed: () => void;
};

export function ConsentChecks({ agreed, onAgreed, pdAgreed, onPdAgreed, adsAgreed, onAdsAgreed }: Props) {
  const router = useRouter();
  const open = (doc: string) => router.push({ pathname: '/legal', params: { doc } });

  return (
    <View style={s.card}>
      <TouchableOpacity
        style={[s.row, s.rowLine]} onPress={onAgreed} activeOpacity={0.8}
        accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}
      >
        <JTCheck checked={agreed} />
        <Text style={s.label}>
          Я принимаю <JTLink style={s.link} onPress={() => open('terms')}>Пользовательское соглашение</JTLink>
          {' '}и подтверждаю, что ознакомлен(а) с{' '}
          <JTLink style={s.link} onPress={() => open('privacy')}>Политикой конфиденциальности</JTLink>
          {' и '}
          <JTLink style={s.link} onPress={() => open('dataPolicy')}>Политикой обработки персональных данных</JTLink>
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.row, s.rowLine]} onPress={onPdAgreed} activeOpacity={0.8}
        accessibilityRole="checkbox" accessibilityState={{ checked: pdAgreed }}
      >
        <JTCheck checked={pdAgreed} />
        <Text style={s.label}>
          Отдельно даю <JTLink style={s.link} onPress={() => open('consent')}>Согласие на обработку персональных данных</JTLink>
          . Это отдельное действие, не являющееся частью принятия Пользовательского соглашения
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={s.row} onPress={onAdsAgreed} activeOpacity={0.8}
        accessibilityRole="checkbox" accessibilityState={{ checked: adsAgreed }}
      >
        <JTCheck checked={adsAgreed} />
        <Text style={s.label}>
          <Text style={s.optional}> По желанию </Text>
          {' '}Даю <JTLink style={s.link} onPress={() => open('marketing')}>Согласие на получение рекламной рассылки</JTLink>
          {' '}о JobToo на почту и в уведомлениях. Можно отключить в настройках
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: rs(6), paddingVertical: rs(6), paddingHorizontal: rs(16), borderRadius: rs(20), backgroundColor: JT.surface },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: rs(12), paddingVertical: rs(12) },
  rowLine: { borderBottomWidth: 1.5, borderBottomColor: '#EFE7DC' },
  label: { flex: 1, fontFamily: JT_FONT.medium, fontSize: rf(13.5), lineHeight: rf(20), color: JT.ink },
  link: { fontFamily: JT_FONT.bold },
  optional: {
    fontFamily: JT_FONT.heavy, fontSize: rf(11), color: JT.textTertiary,
    backgroundColor: JT.background, borderRadius: rs(6), overflow: 'hidden',
  },
});
