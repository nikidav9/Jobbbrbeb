import React, { useState, useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View, Text, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/theme';
import { EmailCodeStep } from '@/components/feature/EmailCodeStep';
import { useApp } from '@/hooks/useApp';
import { uid, nowISO } from '@/services/storage';
import { dbWarmup } from '@/services/db';

import { rs, rf } from '@/constants/scale';
import { BackButton } from '@/components/ui/BackButton';
import { JTProgress, JTLink, jtBackStyle } from '@/components/ui/jt';
import { ConsentChecks } from '@/components/feature/ConsentChecks';
import { JT, JT_FONT } from '@/constants/jt';

// Регистрация — «почта → код → сразу лента» (решение владельца 27.09.2026,
// как у getmatch): один экран — почта и согласия, второй шаг EmailCodeStep —
// код. Пароля и телефона нет (решение владельца 03.10.2026: вход только по
// коду из письма). Имя и резюме спросит окно первого отклика.
const TOTAL = 2;

export default function RegisterWorker() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { registerUser, showToast } = useApp();

  // Код отправлен — второй (свой) шаг EmailCodeStep. Только для прогресса в
  // шапке: сам переход между «почта» и «код» держит компонент у себя.
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  // Растёт при ошибке квитанции — пересоздаёт EmailCodeStep, возвращая его
  // внутреннюю фазу на «почта» (снаружи её не сбросить иначе).
  const [emailStepKey, setEmailStepKey] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [pdAgreed, setPdAgreed] = useState(false);
  // Реклама — отдельная необязательная галочка, по умолчанию снята (38-ФЗ, ст. 18).
  const [adsAgreed, setAdsAgreed] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => { dbWarmup(); }, []);

  // Открыт по прямой ссылке: истории нет, router.back() молчит.
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  // Код подтверждён — регистрируем минимальный профиль: без пароля и без имени.
  const finishByEmail = async (verifiedEmail: string, ticket: string) => {
    if (finishing) return;
    setFinishing(true);
    try {
      const user = {
        id: uid(),
        role: 'worker' as const,
        phone: '',
        email: verifiedEmail,
        emailVerifiedAt: nowISO(),
        lastName: '',
        firstName: '',
        createdAt: nowISO(),
      };
      await registerUser(user, ticket, { marketing: adsAgreed });
      showToast('Добро пожаловать!', 'success');
      router.replace(returnTo ? `/${returnTo}` : '/(tabs)');
    } catch (e) {
      console.error('[RegisterWorker] finishByEmail error', e);
      const msg = e instanceof Error && e.message ? e.message : 'Ошибка регистрации. Попробуйте ещё раз.';
      showToast(msg, 'error');
      // Квитанция устарела или почту успели занять — вернуть на шаг почты:
      // EmailCodeStep сам такого не умеет, поэтому пересоздаём его через key.
      if (/почт/i.test(msg)) { setEmailCodeSent(false); setEmailStepKey(k => k + 1); }
      setFinishing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <BackButton onPress={back} style={jtBackStyle} />
        <JTProgress step={emailCodeSent ? 2 : 1} total={TOTAL} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={[styles.stepContent, styles.grow]}>
            {!emailCodeSent ? (
              <>
                <Text style={styles.title}>Регистрация по{' '}почте</Text>
                <Text style={styles.subtitle}>{finishing ? 'Создаём аккаунт…' : 'Пришлём код — пароль не нужен'}</Text>
              </>
            ) : null}
            {finishing ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <EmailCodeStep
                key={emailStepKey}
                purpose="register"
                hero
                pinButton
                onPhaseChange={p => setEmailCodeSent(p === 'code')}
                disabled={!agreed || !pdAgreed}
                belowEmail={(
                  <ConsentChecks
                    agreed={agreed} onAgreed={() => setAgreed(v => !v)}
                    pdAgreed={pdAgreed} onPdAgreed={() => setPdAgreed(v => !v)}
                    adsAgreed={adsAgreed} onAdsAgreed={() => setAdsAgreed(v => !v)}
                  />
                )}
                onSendAttempt={ok => { if (ok) setEmailCodeSent(true); }}
                onVerified={(e, t) => { void finishByEmail(e, t); }}
              />
            )}
            {!emailCodeSent ? (
              <Text style={styles.loginHintTxt}>
                Уже есть аккаунт? <JTLink onPress={() => router.push('/login')}>Войти</JTLink>
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: JT.background },
  grow: { flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: rs(14), paddingHorizontal: rs(24), paddingTop: rs(12), height: rs(56) },
  body: { paddingHorizontal: rs(24), paddingTop: rs(26), paddingBottom: rs(28), flexGrow: 1 },
  stepContent: { gap: rs(16) },
  title: { fontFamily: JT_FONT.head, fontSize: rf(27), lineHeight: rf(31), letterSpacing: -0.3, color: JT.ink },
  subtitle: { fontFamily: JT_FONT.medium, fontSize: rf(16), color: JT.textSecondary, marginTop: rs(-6), lineHeight: rf(23) },
  loginHintTxt: { fontFamily: JT_FONT.medium, fontSize: rf(15), color: JT.ink, textAlign: 'center', marginTop: rs(4) },
});
