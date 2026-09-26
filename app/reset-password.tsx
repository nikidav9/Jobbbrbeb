/**
 * Восстановление пароля по коду из письма (решение владельца 25.09.2026).
 *
 * Почта → код → новый пароль. Сервер гасит все прежние сессии и тут же
 * выдаёт новую — человек сразу оказывается внутри, заново входить не нужно.
 * Старый аккаунт без почты так не восстановить: для него — поддержка.
 */
import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform,
  ActivityIndicator, Linking, ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/theme';
import { AppInput } from '@/components/ui/AppInput';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { PasswordRules } from '@/components/ui/PasswordRules';
import { EmailCodeStep } from '@/components/feature/EmailCodeStep';
import { firstUnmetRule } from '@/constants/passwordRules';
import { dbAuthResetPassword } from '@/services/db';
import { useApp } from '@/hooks/useApp';
import { rs, rf } from '@/constants/scale';

const SUPPORT_EMAIL = 'support@jobtoo.ru';

export default function ResetPassword() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { signInAs, showToast } = useApp();

  const [ticket, setTicket] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const unmet = firstUnmetRule(password);
    if (unmet) { setError(`Пароль не подходит: ${unmet.label.toLowerCase()}`); return; }
    if (password !== confirm) { setError('Пароли не совпадают'); return; }
    setSaving(true);
    setError('');
    try {
      const user = await dbAuthResetPassword(ticket, password);
      await signInAs(user);
      showToast('Пароль изменён. Добро пожаловать! 👋', 'success');
      router.replace(returnTo ? `/${returnTo}` : '/(tabs)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось сменить пароль';
      setError(msg);
      // Квитанция устарела — начинаем с почты заново.
      if (/устарел|заново/i.test(msg)) setTicket('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.sheet}>
            <Text style={styles.title}>Восстановить пароль</Text>

            {!ticket ? (
              <>
                <Text style={styles.subtitle}>Пришлём код на почту, указанную в аккаунте</Text>
                <EmailCodeStep purpose="reset" onVerified={(_e, t) => { setTicket(t); setError(''); }} />
                <TouchableOpacity
                  onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Восстановление пароля JobToo`)}
                  accessibilityRole="button"
                >
                  <Text style={styles.hint}>
                    Регистрировались по номеру и не указывали почту?{' '}
                    <Text style={styles.hintLink}>Напишите на {SUPPORT_EMAIL}</Text>
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.subtitle}>Почта подтверждена. Придумайте новый пароль</Text>
                <AppInput
                  label="Новый пароль"
                  value={password}
                  onChangeText={v => { setPassword(v); setError(''); }}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  placeholder="Придумайте пароль"
                  autoFocus
                />
                <PasswordRules password={password} />
                <AppInput
                  label="Повторите пароль"
                  value={confirm}
                  onChangeText={v => { setConfirm(v); setError(''); }}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  placeholder="Повторите пароль"
                  error={error}
                />
                <View style={styles.btn}>
                  {saving
                    ? <ActivityIndicator color={Colors.primary} />
                    : <PrimaryButton label="Сохранить и войти →" onPress={save} disabled={!password || !confirm} />}
                </View>
              </>
            )}

            <TouchableOpacity style={styles.cancel} onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))} accessibilityRole="button">
              <Text style={styles.cancelText}>Отмена</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: rs(16) },
  sheet: {
    backgroundColor: Colors.bg,
    borderRadius: rs(24),
    marginHorizontal: rs(16),
    padding: rs(24),
    gap: rs(14),
  },
  title: { fontSize: rf(22), fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: rf(14), color: Colors.textMuted, marginTop: rs(-6), lineHeight: rf(20) },
  hint: { fontSize: rf(13), color: Colors.textSecondary, lineHeight: rf(18) },
  hintLink: { color: Colors.primary, fontWeight: '600' },
  btn: { minHeight: rs(48), justifyContent: 'center' },
  cancel: { alignItems: 'center', marginTop: rs(4) },
  cancelText: { fontSize: rf(15), color: Colors.textMuted, fontWeight: '500' },
});
