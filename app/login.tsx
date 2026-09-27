import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View, Text, Image, StyleSheet, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EmailCodeStep } from '@/components/feature/EmailCodeStep';
import { BackButton } from '@/components/ui/BackButton';
import { JTButton, JTInput, JTLink, jtBackStyle } from '@/components/ui/jt';
import { JT, JT_FONT } from '@/constants/jt';
import { dbAuthLoginByCode } from '@/services/db';
import { useApp } from '@/hooks/useApp';

import { rs, rf } from '@/constants/scale';

// Вход — по коду из письма, пароль остаётся запасным (решение владельца
// 27.09.2026). Старые аккаунты, заведённые по телефону, кода не получают —
// им годится только вход по паролю, поэтому ссылка на него остаётся всегда.
// Вид — макет «JT-auth-and-details» 01-login (27.09.2026): полный экран,
// иллюстрация «дверь», на шаге кода её сменяет «письмо» из EmailCodeStep.
const looksLikeLogin = (v: string) => /@/.test(v) ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) : v.replace(/\D/g, '').length >= 10;

export default function Login() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { loginUser, signInAs, showToast, emailAuthReady } = useApp();

  // null — режим не выбирали руками, он следует за готовностью почты:
  // не готова — только пароль; станет готова — сама подхватит код.
  const [manualMode, setManualMode] = useState<'code' | 'password' | null>(null);
  const mode = manualMode ?? (emailAuthReady ? 'code' : 'password');

  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [passError, setPassError] = useState('');
  const [loading, setLoading] = useState(false);
  // Шаг кода рисует свою шапку («Введите код»), наша на нём прячется.
  const [codePhase, setCodePhase] = useState(false);

  const goInside = () => {
    showToast('Добро пожаловать! 👋', 'success');
    router.replace(returnTo ? `/${returnTo}` : '/(tabs)');
  };

  const handleLogin = async () => {
    setPhoneError('');
    setPassError('');

    if (!password.trim()) {
      setPassError('Введите пароль');
      return;
    }

    setLoading(true);

    // Regular user check first — DB is the source of truth
    let user = null;
    try {
      user = await loginUser(login, password);
    } catch (e) {
      console.error('[Login] loginUser error', e);
      setPhoneError('Ошибка входа. Проверьте соединение и попробуйте ещё раз.');
      setLoading(false);
      return;
    }

    if (user) {
      goInside();
      setLoading(false);
      return;
    }

    setPhoneError('Неверная почта (телефон) или пароль');
    setLoading(false);
  };

  const openReset = () => {
    // Почта ещё не готова (SMTP у хостинга закрыт) — восстановление, как
    // раньше, через поддержку: код всё равно не дойдёт.
    if (!emailAuthReady) {
      Linking.openURL('mailto:support@jobtoo.ru?subject=Восстановление пароля JobToo');
      return;
    }
    router.push(returnTo ? { pathname: '/reset-password', params: { returnTo } } : '/reset-password');
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const toRegister = () => router.push('/register-worker');
  const showHead = mode === 'password' || !codePhase;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.topRow}>
            <BackButton onPress={close} style={jtBackStyle} />
          </View>

          {showHead ? (
            <>
              <Image
                source={require('@/assets/images/auth-login-door.png')}
                style={styles.hero}
                resizeMode="contain"
                accessibilityLabel="Открытая дверь и карточка профиля"
              />
              <Text style={styles.title}>Вход</Text>
              <Text style={styles.subtitle}>
                {mode === 'code'
                  ? 'Пришлём код на почту — пароль не нужен'
                  : 'Почта и пароль. Регистрировались по номеру — введите номер'}
              </Text>
            </>
          ) : null}

          {mode === 'code' ? (
            <View testID="login-code-mode" style={[styles.form, codePhase && styles.grow]}>
              <EmailCodeStep
                purpose="login"
                hero
                onPhaseChange={p => setCodePhase(p === 'code')}
                onVerified={() => {}}
                verify={async (email, code) => {
                  const user = await dbAuthLoginByCode(email, code);
                  await signInAs(user);
                  goInside();
                }}
              />
              {!codePhase ? (
                <Text style={styles.switchRow}>
                  <JTLink testID="login-password-link" onPress={() => setManualMode('password')}>Войти по паролю</JTLink>
                </Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.form}>
              <JTInput
                label="Почта или телефон"
                value={login}
                onChangeText={v => { setLogin(v); setPhoneError(''); }}
                placeholder="name@mail.ru"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                textContentType="username"
                accessibilityLabel="Почта или телефон"
                error={phoneError}
              />
              <JTInput
                label="Пароль"
                value={password}
                onChangeText={v => { setPassword(v); setPassError(''); }}
                secureTextEntry
                placeholder="Ваш пароль"
                accessibilityLabel="Пароль"
                error={passError}
                onSubmitEditing={handleLogin}
              />
              <JTButton
                label="Войти"
                onPress={handleLogin}
                busy={loading}
                disabled={!looksLikeLogin(login) || !password.trim()}
              />
              <Text style={styles.switchRow}>
                Забыли пароль?{' '}
                <JTLink onPress={openReset}>{emailAuthReady ? 'Восстановить по почте' : 'Напишите на support@jobtoo.ru'}</JTLink>
              </Text>
              {emailAuthReady && (
                <Text style={styles.switchRow}>
                  <JTLink testID="login-code-link" onPress={() => setManualMode('code')}>Войти по коду из письма</JTLink>
                </Text>
              )}
            </View>
          )}

          {showHead ? (
            <>
              <View style={styles.grow} />
              <Text style={styles.bottomTxt}>
                Нет аккаунта? <JTLink onPress={toRegister}>Зарегистрироваться</JTLink>
              </Text>
              <TouchableOpacity style={styles.docs} onPress={() => router.push('/legal')} accessibilityRole="link">
                <Ionicons name="document-outline" size={rs(16)} color={JT.textTertiary} />
                <Text style={styles.docsTxt}>Все документы</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: JT.background },
  body: { flexGrow: 1, paddingHorizontal: rs(24), paddingTop: rs(12), paddingBottom: rs(28) },
  grow: { flexGrow: 1 },
  topRow: { height: rs(44), flexDirection: 'row', alignItems: 'center' },
  hero: { width: rs(230), height: rs(200), alignSelf: 'center', marginTop: rs(4) },
  title: {
    fontFamily: JT_FONT.head, fontSize: rf(31), lineHeight: rf(35), letterSpacing: -0.3,
    color: JT.ink, textAlign: 'center', marginTop: rs(20),
  },
  subtitle: {
    fontFamily: JT_FONT.medium, fontSize: rf(16), lineHeight: rf(23),
    color: JT.textSecondary, textAlign: 'center', marginTop: rs(10),
  },
  form: { marginTop: rs(26), gap: rs(14) },
  switchRow: {
    fontFamily: JT_FONT.bold, fontSize: rf(15), color: JT.ink, textAlign: 'center', marginTop: rs(6),
  },
  bottomTxt: { fontFamily: JT_FONT.medium, fontSize: rf(15), color: JT.ink, textAlign: 'center', marginTop: rs(24) },
  docs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(6), marginTop: rs(16), minHeight: rs(32) },
  docsTxt: { fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT.textTertiary },
});
