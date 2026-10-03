import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View, Text, Image, StyleSheet, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EmailCodeStep } from '@/components/feature/EmailCodeStep';
import { BackButton } from '@/components/ui/BackButton';
import { JTLink, jtBackStyle } from '@/components/ui/jt';
import { JT, JT_FONT } from '@/constants/jt';
import { dbAuthLoginByCode } from '@/services/db';
import { useApp } from '@/hooks/useApp';

import { rs, rf } from '@/constants/scale';

// Вход — только по коду из письма (решение владельца 03.10.2026: пароля в
// JobToo нет вовсе). Вид — макет «JT-auth-and-details» 01-login (27.09.2026):
// полный экран, иллюстрация «дверь», на шаге кода её сменяет «письмо» из
// EmailCodeStep.
export default function Login() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { signInAs, showToast } = useApp();
  // Шаг кода рисует свою шапку («Введите код»), наша на нём прячется.
  const [codePhase, setCodePhase] = useState(false);

  const goInside = () => {
    showToast('Добро пожаловать!', 'success');
    router.replace(returnTo ? `/${returnTo}` : '/(tabs)');
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const toRegister = () => router.push('/register-worker');
  const showHead = !codePhase;

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
              <Text style={styles.subtitle}>Пришлём код на почту — пароль не нужен</Text>
            </>
          ) : null}

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
          </View>

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
  bottomTxt: { fontFamily: JT_FONT.medium, fontSize: rf(15), color: JT.ink, textAlign: 'center', marginTop: rs(24) },
  docs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(6), marginTop: rs(16), minHeight: rs(32) },
  docsTxt: { fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT.textTertiary },
});
